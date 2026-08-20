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
    // Já cabe: envia o original, sem recomprimir. Recomprimir um JPEG que já
    // está no tamanho só degrada a imagem para economizar quase nada.
    if (alvo.largura === img.naturalWidth) return arquivo;

    const canvas = document.createElement("canvas");
    canvas.width = alvo.largura;
    canvas.height = alvo.altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) return arquivo;
    ctx.drawImage(img, 0, 0, alvo.largura, alvo.altura);

    const tipo = arquivo.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((ok) =>
      canvas.toBlob(ok, tipo, tipo === "image/jpeg" ? 0.85 : undefined)
    );
    return blob ?? arquivo;
  } finally {
    URL.revokeObjectURL(url);
  }
}
