// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — a imagem do módulo nas exportações
//
// POR QUE ESTE ARQUIVO EXISTE
//
// As imagens de módulo são geradas por IA, custam crédito do autor e ficam
// gravadas em course_images. O portal do aluno as mostra; o PDF e o PPTX também.
// SCORM, Moodle e Notion não — nenhum dos três lia a tabela. Quem comprava o
// curso por esses canais recebia o material sem as imagens que o autor pagou
// para fazer, e nada no produto acusava a falta.
//
// A parte comum aos três (buscar, indexar por módulo, montar a referência com o
// escape certo) mora aqui. O que muda entre eles é só o destino:
//
//   SCORM  — pacote que roda dentro do LMS, muitas vezes sem internet. A imagem
//            é EMBUTIDA no zip e referenciada por caminho relativo. Uma URL
//            assinada não serviria: ela expira, e o pacote fica quebrado depois.
//   Moodle — backup .mbz. Embutir exigiria entrar no manifesto files.xml com
//            hash de conteúdo; a URL assinada no <img> resolve sem esse risco.
//   Notion — markdown. A importação do Notion busca a imagem remota.
// ═══════════════════════════════════════════════════════════════════════════

export interface ImagemDeModulo {
  url: string;
  altText: string;
}

/** Cliente mínimo que este módulo precisa — evita depender do tipo do supabase-js. */
interface ConsultaImagens {
  from: (tabela: string) => {
    select: (colunas: string) => {
      in: (coluna: string, valores: string[]) => Promise<{
        data: Array<{ module_id: string; url: string; alt_text: string | null }> | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/**
 * Imagens dos módulos, indexadas por module_id.
 *
 * Nunca lança: imagem é enriquecimento e não pode custar a exportação inteira.
 * Uma falha aqui vira log e um mapa vazio — o curso sai sem imagem, como saía
 * antes, em vez de não sair.
 */
export async function buscarImagensDosModulos(
  client: ConsultaImagens,
  moduleIds: string[],
  etiqueta: string,
): Promise<Map<string, ImagemDeModulo>> {
  const mapa = new Map<string, ImagemDeModulo>();
  if (moduleIds.length === 0) return mapa;

  try {
    const { data, error } = await client
      .from("course_images")
      .select("module_id, url, alt_text")
      .in("module_id", moduleIds);

    if (error) {
      console.error(`[${etiqueta}] falha ao consultar course_images:`, error.message);
      return mapa;
    }
    for (const linha of data ?? []) {
      if (linha?.module_id && linha?.url) {
        mapa.set(linha.module_id, {
          url: linha.url,
          altText: (linha.alt_text ?? "").trim() || "Imagem do módulo",
        });
      }
    }
  } catch (err) {
    console.error(`[${etiqueta}] erro ao buscar imagens:`, err);
  }
  return mapa;
}

/**
 * Escape para TEXTO DENTRO DE ATRIBUTO HTML.
 *
 * O escapeHtml que já existia no export-scorm cobre & < > e para por aí. O
 * alt_text vai para dentro de `alt="…"` e é escrito por IA a partir do que o
 * autor digitou — uma aspa ali fecha o atributo e o que vem depois passa a ser
 * lido como marcação. Aspas simples entram junto porque o Moodle serializa o
 * mesmo HTML dentro de XML.
 */
export function escaparAtributo(texto: string): string {
  return (texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `<figure>` com legenda, para SCORM e Moodle. */
export function figuraHtml(src: string, altText: string): string {
  const alt = escaparAtributo(altText);
  return `<figure style="margin:24px 0;text-align:center">` +
    `<img src="${escaparAtributo(src)}" alt="${alt}" ` +
    `style="max-width:100%;height:auto;border-radius:6px">` +
    `<figcaption style="font-size:0.85em;color:#666;margin-top:6px">${alt}</figcaption>` +
    `</figure>`;
}

/**
 * `![alt](url)` para o markdown do Notion.
 *
 * O alt vai sem `[` e `]`, que fechariam o rótulo antes da hora, e a URL vai
 * entre `<>` — a forma que o CommonMark reserva justamente para endereço com
 * caractere que atrapalha. URL assinada carrega `?token=…&v=…`, e um parêntese
 * solto ali cortaria o link no meio.
 */
export function figuraMarkdown(url: string, altText: string): string {
  const alt = (altText ?? "").replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim();
  return `![${alt}](<${(url ?? "").replace(/[<>]/g, "")}>)`;
}

/**
 * Nome do arquivo da imagem dentro do pacote SCORM.
 *
 * A extensão sai do caminho da URL, nunca da query: a URL assinada termina em
 * `?token=…`, e pegar o que vem depois do último ponto devolveria pedaço de
 * token. Formato desconhecido vira .jpg, que é o que o Pexels serve e o que
 * qualquer navegador abre por sniffing mesmo com a extensão errada.
 */
export function nomeDoArquivoNoPacote(url: string, indiceDoModulo: number): string {
  let caminho = url ?? "";
  const corte = caminho.search(/[?#]/);
  if (corte >= 0) caminho = caminho.slice(0, corte);
  const m = /\.([a-zA-Z0-9]{2,4})$/.exec(caminho);
  const ext = m ? m[1].toLowerCase() : "jpg";
  const permitidas = ["jpg", "jpeg", "png", "gif", "webp", "svg"];
  return `assets/modulo-${indiceDoModulo + 1}.${permitidas.includes(ext) ? ext : "jpg"}`;
}

/**
 * Baixa os bytes da imagem para embutir no pacote. Devolve `null` em qualquer
 * problema — de novo, imagem não derruba exportação.
 */
export async function baixarImagem(
  url: string,
  etiqueta: string,
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[${etiqueta}] imagem respondeu ${res.status}`);
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error(`[${etiqueta}] erro ao baixar imagem:`, err);
    return null;
  }
}
