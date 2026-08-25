// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — imagem enviada do computador do autor
//
// Até aqui a imagem do módulo só podia vir do Pexels ou da geração por IA. Nem
// sempre serve: o autor pode ter a foto do próprio evento, o organograma da
// prefeitura, o print da tela do sistema que ele ensina — coisas que nenhum
// banco de imagens tem e nenhuma IA inventa direito.
//
// A regra do produto não muda: a imagem entra em course_images como qualquer
// outra, e daí segue para a apostila, o PPTX, o SCORM, o Moodle e o Notion sem
// que nenhum exportador precise saber de onde ela veio.
//
// AS TRÊS DECISÕES QUE ESTE ARQUIVO IMPLEMENTA
//
// 1) TAMANHO. Foto de celular tem de 4 a 12 MB. Ela vai para dentro do PPTX em
//    base64, e a função de exportação tem limite de tempo e de CPU — foi
//    exatamente isso que obrigou a dividir a geração de curso em invocações
//    independentes. Reduzir no navegador, antes de enviar, resolve na origem.
//
// 2) FORMATO. JPEG e PNG, só. WebP fica de fora de propósito: o jsPDF não o
//    desenha, então a imagem apareceria no PPTX e sumiria da apostila. Defeito
//    que só aparece num dos formatos é o pior tipo de defeito.
//
// 3) TEXTO ALTERNATIVO. A do Pexels vem com descrição e a da IA também. Esta
//    viria vazia, e sem ela o leitor de tela não tem o que ler no SCORM e no
//    Moodle. Pedimos uma frase curta — opcional, com um padrão honesto.
// ═══════════════════════════════════════════════════════════════════════════

/** Tipos que TODOS os formatos de saída sabem desenhar. */
export const TIPOS_ACEITOS = ["image/jpeg", "image/png"] as const;

/** O que o seletor de arquivo oferece ao usuário. */
export const ACCEPT_UPLOAD = ".jpg,.jpeg,.png,image/jpeg,image/png";

/** Teto do arquivo ORIGINAL. Acima disso nem vale tentar reduzir no navegador. */
export const TAMANHO_MAXIMO_MB = 20;

/** Largura máxima depois da redução. Suficiente para slide 16:9 e para A4. */
export const LARGURA_MAXIMA = 1600;

// ═══════════════════════════════════════════════════════════════════════════
// FOTOGRAFIA EM PNG É DESPERDÍCIO QUE SE PAGA EM TODA EXPORTAÇÃO
//
// O upload guardava PNG como PNG. Parece inofensivo até se medir o que isso
// cobra na apostila: o jsPDF não sabe embutir PNG sem decodificar e recomprimir
// em JavaScript. Numa foto real de curso, 940x627:
//
//     PNG,  1105 KB  →  54 ms para embutir, e 1107 KB dentro do PDF
//     JPEG,  163 KB  →   2 ms para embutir, e  166 KB dentro do PDF
//
// Nos logs de um curso de 8 módulos, as imagens consumiram 78% da CPU do
// export — 1165 ms contra 312 ms de TODO o texto. Era isso que limitava o
// produto a nove ou dez módulos, contra o teto de CPU da edge function.
//
// Mas converter tudo seria pior do que não converter. JPEG não tem canal alfa
// (um logotipo com fundo transparente sairia com fundo preto) e borra bordas
// duras (a captura de uma planilha ficaria ilegível). PNG existe para esses
// dois casos, e é neles que ele ganha.
//
// A separação é medível. Contando cores distintas em 4000 pixels amostrados,
// nas seis imagens reais dos cursos e num gráfico de barras:
//
//     fotografias .............. 509, 533, 651, 673, 813, 976
//     gráfico de barras ........ 3
//
// Duas ordens de grandeza. O piso fica em 200 — bem acima de qualquer gráfico e
// com folga de 2,5x abaixo da foto mais pobre que eu medi. O piso é ALTO de
// propósito: errar para cima mantém o PNG, que é o comportamento de hoje;
// errar para baixo borraria o texto de um gráfico, que é dano visível.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A extensão do que SAIU da redução, não do que entrou.
 *
 * `reduzirImagem` pode devolver JPEG onde entrou PNG. Quem grava precisa
 * perguntar ao resultado: derivar do arquivo original faria o caminho terminar
 * em `.png` com bytes de JPEG dentro, e o `contentType` mentiria junto.
 */
export function extensaoDoBlob(blob: Blob, padrao: "jpg" | "png" = "jpg"): "jpg" | "png" {
  if (blob?.type === "image/png") return "png";
  if (blob?.type === "image/jpeg") return "jpg";
  return padrao;
}

/** Cores distintas, em 4000 pixels, abaixo das quais não é fotografia. */
export const CORES_MINIMAS_DE_FOTO = 200;

/** Alfa abaixo disto conta como transparência de verdade, não arredondamento. */
const ALFA_OPACO = 250;

/**
 * Estes pixels são de uma fotografia?
 *
 * Recebe RGBA cru — a mesma coisa que `ctx.getImageData().data` devolve — para
 * poder ser testada sem navegador. Devolve false na dúvida: transparência,
 * poucas cores, ou amostra pequena demais para decidir.
 */
export function pareceFotografia(
  rgba: Uint8ClampedArray | Uint8Array | number[],
  amostrasDesejadas = 4000,
): boolean {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels < 64) return false;

  // Passo primo para varrer a imagem inteira em vez de uma faixa dela: com um
  // passo par, uma imagem listrada poderia cair sempre na mesma coluna.
  const passo = Math.max(1, Math.floor(pixels / amostrasDesejadas)) || 1;
  const cores = new Set<number>();
  for (let i = 0; i < pixels; i += passo) {
    const p = i * 4;
    if (rgba[p + 3] < ALFA_OPACO) return false; // tem transparência: PNG fica
    // Quantiza em 32 níveis por canal: duas fotos do mesmo objeto não precisam
    // ter exatamente os mesmos bytes para contarem como "muitas cores".
    cores.add(
      ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3),
    );
  }
  return cores.size >= CORES_MINIMAS_DE_FOTO;
}

/**
 * Um campo `ok` e os dois complementos opcionais, em vez de união discriminada.
 *
 * O tsconfig do projeto roda com `strict: false`, e sem `strictNullChecks` o
 * TypeScript não estreita união pelo discriminante — `if (!v.ok)` não revelaria
 * o `motivo`. Mudar a configuração do projeto inteiro por causa de um arquivo
 * seria a troca errada; este formato compila em qualquer ajuste.
 */
export interface Verificacao {
  ok: boolean;
  /** Preenchido quando `ok` é false — texto pronto para a tela. */
  motivo?: string;
  /** Preenchido quando `ok` é true. */
  extensao?: "jpg" | "png";
}

/**
 * O arquivo serve? Devolve o motivo em português, para ir direto à tela.
 *
 * O WebP é recusado com explicação, e não com um "formato inválido" genérico:
 * ele é um formato legítimo e comum, e o usuário merece saber por que este
 * produto não o aceita.
 */
export function validarArquivo(
  arquivo: { type?: string; size?: number; name?: string } | null | undefined,
): Verificacao {
  if (!arquivo) return { ok: false, motivo: "Nenhum arquivo selecionado." };

  const tipo = (arquivo.type ?? "").toLowerCase();
  if (tipo === "image/webp") {
    return {
      ok: false,
      motivo:
        "WebP não é aceito porque a apostila em PDF não consegue desenhá-lo — " +
        "a imagem apareceria nos slides e sumiria do PDF. Converta para JPG ou PNG.",
    };
  }
  if (!TIPOS_ACEITOS.includes(tipo as typeof TIPOS_ACEITOS[number])) {
    return { ok: false, motivo: "Envie uma imagem JPG ou PNG." };
  }

  const bytes = arquivo.size ?? 0;
  if (bytes <= 0) return { ok: false, motivo: "O arquivo está vazio." };
  if (bytes > TAMANHO_MAXIMO_MB * 1024 * 1024) {
    return {
      ok: false,
      motivo: `A imagem tem mais de ${TAMANHO_MAXIMO_MB} MB. Reduza antes de enviar.`,
    };
  }

  return { ok: true, extensao: tipo === "image/png" ? "png" : "jpg" };
}

/**
 * Quanto reduzir. Devolve a largura/altura de destino mantendo a proporção.
 *
 * Imagem menor que o teto não é ampliada — esticar não acrescenta detalhe, só
 * peso.
 */
export function medidaReduzida(
  largura: number,
  altura: number,
  tetoLargura = LARGURA_MAXIMA,
): { largura: number; altura: number } {
  if (!(largura > 0) || !(altura > 0)) return { largura: 0, altura: 0 };
  if (largura <= tetoLargura) return { largura: Math.round(largura), altura: Math.round(altura) };
  const escala = tetoLargura / largura;
  return { largura: tetoLargura, altura: Math.max(1, Math.round(altura * escala)) };
}

/**
 * Onde o arquivo mora no bucket.
 *
 * A primeira pasta é o id do usuário porque é EXATAMENTE isso que a política do
 * bucket exige — `auth.uid()::text = (storage.foldername(name))[1]`. Sair desse
 * formato não dá erro de sintaxe: dá "acesso negado" em tempo de execução, ou
 * pior, deixa o arquivo visível para quem não deveria.
 *
 * O caminho é fixo por módulo (e não único por envio) para que reenviar
 * substitua a imagem anterior em vez de acumular lixo no bucket.
 */
export function caminhoDoUpload(
  userId: string,
  escopo: "module" | "cover",
  id: string,
  extensao: "jpg" | "png",
): string {
  const limpo = (s: string) => String(s ?? "").replace(/[^a-zA-Z0-9-]/g, "");
  const prefixo = escopo === "cover" ? "course-cover-upload" : "module-upload";
  return `${limpo(userId)}/${prefixo}-${limpo(id)}.${extensao}`;
}

/**
 * Texto alternativo do que o autor enviou.
 *
 * Sem descrição, o padrão diz o que se sabe de verdade — que é a ilustração
 * daquele módulo — em vez de inventar o que a foto mostra.
 */
export function altDoUpload(descricao: string | null | undefined, tituloDoModulo: string): string {
  const d = (descricao ?? "").replace(/\s+/g, " ").trim();
  if (d) return d.slice(0, 180);
  const t = (tituloDoModulo ?? "").trim();
  return t ? `Ilustração do módulo ${t}` : "Ilustração do módulo";
}

/**
 * Reduz a imagem no navegador e devolve o arquivo pronto para envio.
 *
 * Precisa de DOM (canvas), então vive separada das funções puras acima — que
 * são as que carregam as regras e as que os testes exercitam.
 */
export async function reduzirImagem(
  arquivo: File,
  tetoLargura = LARGURA_MAXIMA,
): Promise<Blob> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => {
      const el = new window.Image();
      el.onload = () => ok(el);
      el.onerror = () => erro(new Error("Não foi possível ler a imagem."));
      el.src = url;
    });
    const alvo = medidaReduzida(img.naturalWidth, img.naturalHeight, tetoLargura);
    const cabe = alvo.largura === img.naturalWidth;
    // Um JPEG que já cabe sai como veio: recomprimir só degrada a imagem para
    // economizar quase nada. Um PNG precisa ser OLHADO mesmo cabendo — a foto
    // que custava 54 ms por exportação tinha 940 px e passava direto por aqui.
    if (cabe && arquivo.type !== "image/png") return arquivo;

    const canvas = document.createElement("canvas");
    canvas.width = alvo.largura;
    canvas.height = alvo.altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) return arquivo;
    ctx.drawImage(img, 0, 0, alvo.largura, alvo.altura);

    let tipo = arquivo.type === "image/png" ? "image/png" : "image/jpeg";
    if (tipo === "image/png") {
      try {
        const { data } = ctx.getImageData(0, 0, alvo.largura, alvo.altura);
        if (pareceFotografia(data)) tipo = "image/jpeg";
      } catch {
        // Sem leitura de pixels não há decisão: fica o PNG, como antes.
      }
    }
    // O PNG que cabia e continua PNG não tem por que ser reescrito.
    if (cabe && tipo === "image/png") return arquivo;

    const blob = await new Promise<Blob | null>((ok) =>
      canvas.toBlob(ok, tipo, tipo === "image/jpeg" ? 0.85 : undefined)
    );
    return blob ?? arquivo;
  } finally {
    URL.revokeObjectURL(url);
  }
}
