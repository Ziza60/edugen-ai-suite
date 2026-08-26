// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o Markdown era o único formato que jogava as imagens fora
//
// O RELATO
//
// "O markdown não tem imagem, como vc vai ver?" A pergunta era sobre mandar o
// arquivo para análise, mas a resposta expôs um defeito do produto: o `.md`
// exportado de um curso com imagens não trazia NEM A URL delas. Zero
// ocorrências de `![` num curso de oito módulos, todos ilustrados.
//
// A CAUSA
//
// A exportação era uma linha só:
//
//     modules.map((m) => `# ${m.title}\n\n${m.content}`).join("\n\n---\n\n")
//
// Ela lê `course_modules` e mais nada. As imagens moram em `course_images`, e
// a capa em `courses.cover_image_url` — o PDF consulta as duas, o PPTX
// consulta, o Notion consulta, o portal do aluno consulta. Só este exportador
// não consultava, e por isso ninguém percebeu: quem exporta `.md` costuma
// querer o texto para reimportar, e não repara na imagem que não veio.
//
// POR QUE MARKDOWN PODE, ONDE O PDF NÃO PODERIA
//
// A imagem do Markdown é uma REFERÊNCIA, não bytes embutidos. O arquivo
// continua com o peso do texto e a imagem é buscada na hora de exibir. É a
// diferença entre um `.md` de 250 KB e um PDF de 3,5 MB do mesmo curso — e é
// por isso que trazer a imagem para cá não recria o problema de tamanho que
// nos obrigou a comprimir o PDF.
//
// A CONTRAPARTIDA, DITA EM VOZ ALTA
//
// Referência quebra quando o alvo some. Se o bucket ficar privado ou o arquivo
// for apagado, o `.md` exportado hoje mostra imagem quebrada amanhã. É o
// comportamento normal de Markdown, é o que o autor espera ao escolher este
// formato, e continua sendo melhor do que a alternativa atual — que é não ter
// imagem nenhuma, hoje e sempre.
// ═══════════════════════════════════════════════════════════════════════════

export interface ModuloParaMarkdown {
  id?: string | null;
  title?: string | null;
  content?: string | null;
}

export interface ImagemDoCurso {
  module_id?: string | null;
  url?: string | null;
  alt_text?: string | null;
}

/**
 * Texto alternativo seguro dentro de `![...]`.
 *
 * Um `]` solto no alt fecha o colchete cedo e o resto do alt vaza como texto
 * literal, levando a URL junto. Alt-text vem de descrição escrita por pessoa e
 * de legenda do Pexels — os dois têm colchete com frequência suficiente para
 * isto não ser hipótese.
 */
function altSeguro(alt: string | null | undefined, padrao: string): string {
  const limpo = String(alt ?? "").replace(/\s+/g, " ").trim();
  const base = limpo || padrao;
  return base.replace(/([[\]\\])/g, "\\$1");
}

/**
 * URL segura dentro de `(...)`.
 *
 * Espaço ou parêntese na URL quebra o link em Markdown. A forma `<url>` é a
 * saída prevista pela própria especificação e é aceita por qualquer leitor.
 */
function urlSegura(url: string): string {
  return /[\s()]/.test(url) ? `<${url}>` : url;
}

/** A linha completa da imagem, ou string vazia se não há URL utilizável. */
export function linhaDeImagem(
  url: string | null | undefined,
  alt: string | null | undefined,
  altPadrao: string,
): string {
  const limpa = String(url ?? "").trim();
  if (!limpa) return "";
  return `![${altSeguro(alt, altPadrao)}](${urlSegura(limpa)})`;
}

export interface EntradaMarkdown {
  modulos: ModuloParaMarkdown[];
  /** Linhas de `course_images`. Ausente ou vazia: sai o texto de antes. */
  imagens?: ImagemDoCurso[] | null;
  /** `courses.cover_image_url`. */
  capaUrl?: string | null;
  tituloDoCurso?: string | null;
  /** Assinatura do plano gratuito, já formatada. */
  rodape?: string;
}

/**
 * Monta o `.md` do curso, agora com as imagens.
 *
 * A ESTRUTURA DO TEXTO NÃO MUDA — `# título`, conteúdo, `---` entre módulos —
 * porque há gente com fluxo montado em cima dela. A imagem ENTRA, ela não
 * reorganiza: logo abaixo do título do módulo, que é onde o PDF a desenha.
 */
export function montarMarkdownDoCurso(e: EntradaMarkdown): string {
  const porModulo = new Map<string, ImagemDoCurso>();
  for (const img of e.imagens ?? []) {
    const id = String(img?.module_id ?? "").trim();
    if (id && String(img?.url ?? "").trim() && !porModulo.has(id)) porModulo.set(id, img);
  }

  const partes = e.modulos.map((m, i) => {
    const titulo = String(m.title ?? "").trim();
    const conteudo = m.content || "";
    const img = porModulo.get(String(m.id ?? "").trim());
    const url = String(img?.url ?? "").trim();

    // Se o conteúdo já referencia esta imagem, não duplicar. Acontece com
    // módulo editado à mão, e ver a mesma figura duas vezes é pior do que não
    // vê-la: o leitor procura a diferença entre as duas.
    const jaEsta = !!url && conteudo.includes(url);
    const linha = jaEsta ? "" : linhaDeImagem(url, img?.alt_text, titulo || `Módulo ${i + 1}`);

    return `# ${titulo}\n\n${linha ? `${linha}\n\n` : ""}${conteudo}`;
  });

  const capa = linhaDeImagem(
    e.capaUrl,
    null,
    `Capa do curso${e.tituloDoCurso ? `: ${String(e.tituloDoCurso).trim()}` : ""}`,
  );

  return (capa ? `${capa}\n\n` : "") + partes.join("\n\n---\n\n") + (e.rodape ?? "");
}
