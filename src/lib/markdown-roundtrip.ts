// ═══════════════════════════════════════════════════════════════════════════
// Conversão markdown ↔ HTML para o editor TipTap
//
// POR QUE ISTO SAIU DO BlockEditor
//
// As duas funções viviam dentro do componente e não tinham teste. Medindo o
// ciclo markdown → html → markdown com o conteúdo que o gerador realmente
// produz, quatro construções voltavam diferentes do que entraram:
//
//   tabela ............. as linhas ganhavam uma linha em branco entre si, o que
//                        para o remark-gfm deixa de ser tabela
//   lista numerada ..... "1. 2. 3." voltava como "- - -"
//   callout multilinha . o ">" sumia da segunda linha em diante
//   lista aninhada ..... a indentação era achatada
//
// A tabela é o caso grave: abrir o editor de um módulo e fechá-lo SEM DIGITAR
// NADA já destruía todas as tabelas dele, porque o TipTap emite o conteúdo de
// volta no onUpdate. Perda silenciosa de conteúdo que o aluno veria.
//
// Este módulo corrige as três primeiras na própria conversão e protege a
// quarta categoria — o que o StarterKit não sabe representar — extraindo o
// trecho antes de converter e devolvendo o markdown original no caminho de
// volta, verbatim.
// ═══════════════════════════════════════════════════════════════════════════

// ── Blocos internos de QA ───────────────────────────────────────────────────
//
// O gerador escreve, no meio do módulo, blocos que são instrumentação nossa e
// não conteúdo do curso: a matriz de objetivos, a nota do portão de qualidade,
// as linhas de CRITICAL/WARNING. O autor não deve vê-los no editor.
//
// Este filtro vivia dentro do BlockEditor como `stripInternalBlocksBE` e existia
// só no workspace do Replit — o refactor do editor quase o apagou, porque no
// repositório ele nunca esteve. Está aqui para poder ser testado e para não
// depender de qual cópia do arquivo sobreviver ao próximo merge.

const INTERNAL_HEADING_RES = [
  /^#{1,4}\s+.*Matriz\s+Objetivo/i,
  /^#{1,4}\s+.*Nota\s+de\s+Qualidade\s+EduGen/i,
  /^#{1,4}\s+.*Atividade\s+Pr[áa]tica\s+Avali[áa]vel/i,
  /^#{1,4}\s+.*Cen[áa]rio\s+Ramificado/i,
];

const INTERNAL_LINE_RES = [
  /^-\s+Score\s+do\s+m[óo]dulo\s*:/i,
  /^-\s+(CRITICAL|WARNING|INFO|ERROR)\s*:\s+/i,
  /^\d+\.\s+\*\*.*\*\*\s+[—-]\s+Feedback\s*:/i,
];

/**
 * Tira do markdown os blocos de QA internos.
 *
 * O bloco começa num título da lista acima e vai até o próximo título de nível
 * igual ou superior, ou até uma linha horizontal — o que vier primeiro.
 */
export function stripInternalBlocks(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let skipping = false;
  let skipLevel = 0;

  for (const line of lines) {
    const t = line.trim();
    if (INTERNAL_HEADING_RES.some((re) => re.test(t))) {
      skipping = true;
      const m = t.match(/^(#{1,4})\s/);
      skipLevel = m ? m[1].length : 3;
      continue;
    }
    if (skipping) {
      const hm = t.match(/^(#{1,6})\s/);
      if (hm && hm[1].length <= skipLevel) {
        skipping = false;
      } else if (t === "---" || t === "***" || t === "___") {
        skipping = false;
        continue;
      } else {
        continue;
      }
    }
    if (INTERNAL_LINE_RES.some((re) => re.test(t))) continue;
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Marcador do bloco preservado.
 *
 * Precisa sobreviver ao TipTap intacto, então é texto simples de parágrafo —
 * nada de atributo ou comentário HTML, que o StarterKit descarta. Os delimitadores
 * são caracteres que não aparecem em conteúdo de curso, e o rótulo em português
 * existe para que o autor entenda o que está vendo em vez de achar que é lixo.
 */
const GUARD_OPEN = "⟦";  // ⟦
const GUARD_CLOSE = "⟧"; // ⟧
const GUARD_RE = /⟦([a-z]+) preservad[ao] (\d+)⟧/g;

export interface ProtectedBlock {
  token: string;
  kind: "tabela";
  markdown: string;
}

/** O marcador de um bloco preservado, dado o número dele (1-based). */
export function protectedToken(index: number): string {
  return `${GUARD_OPEN}tabela preservada ${index}${GUARD_CLOSE}`;
}

export interface MarkdownToHtmlResult {
  html: string;
  /** Blocos retirados antes da conversão, para restaurar no caminho de volta. */
  protectedBlocks: ProtectedBlock[];
}

/** Uma linha de tabela markdown: começa e termina com "|". */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}

/** A linha separadora do cabeçalho: |---|:--:|. É ela que faz da tabela uma tabela. */
function isTableDivider(line: string): boolean {
  const t = line.trim();
  return isTableRow(t) && /^\|[\s:|-]+\|$/.test(t) && t.includes("-");
}

/**
 * Retira do markdown os blocos que o TipTap não consegue devolver iguais.
 *
 * Hoje é só a tabela: o StarterKit não traz a extensão Table, então uma tabela
 * vira uma sequência de parágrafos e a estrutura se perde. Extrair é melhor que
 * converter mal — o conteúdo volta exatamente como estava.
 */
export function extractProtectedBlocks(
  markdown: string,
  /** Deslocamento da numeração, para que blocos vindos de uma segunda conversão
   *  (o texto que a IA devolveu, por exemplo) não colidam com os já existentes. */
  startIndex = 0,
): { markdown: string; blocks: ProtectedBlock[] } {
  const linhas = markdown.replace(/\r\n/g, "\n").split("\n");
  const saida: string[] = [];
  const blocks: ProtectedBlock[] = [];
  let emCodigo = false;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (/^\s*```/.test(linha)) {
      emCodigo = !emCodigo;
      saida.push(linha);
      continue;
    }
    // Dentro de bloco de código, "|" é conteúdo, não tabela.
    if (emCodigo) {
      saida.push(linha);
      continue;
    }
    // Uma tabela é cabeçalho + separador + pelo menos uma linha de dados. Sem o
    // separador é só texto com barras, e aí não há o que proteger.
    if (isTableRow(linha) && i + 1 < linhas.length && isTableDivider(linhas[i + 1])) {
      const bloco: string[] = [linha, linhas[i + 1]];
      let j = i + 2;
      while (j < linhas.length && isTableRow(linhas[j])) {
        bloco.push(linhas[j]);
        j++;
      }
      const token = protectedToken(startIndex + blocks.length + 1);
      blocks.push({ token, kind: "tabela", markdown: bloco.join("\n") });
      saida.push(token);
      i = j - 1;
      continue;
    }
    saida.push(linha);
  }

  return { markdown: saida.join("\n"), blocks };
}

/** Devolve os blocos protegidos ao markdown, no lugar dos marcadores. */
export function restoreProtectedBlocks(
  markdown: string,
  blocks: ProtectedBlock[],
): string {
  if (!blocks.length) return markdown;
  let out = markdown;
  for (const b of blocks) {
    // O marcador pode ter sido envolvido pelo editor; casamos pelo índice para
    // aguentar espaços em volta.
    const re = new RegExp(
      `[^\\S\\n]*${b.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\S\\n]*`,
      "g",
    );
    out = out.replace(re, `\n${b.markdown}\n`);
  }
  // Se o autor apagou o marcador, o bloco simplesmente não volta — foi uma
  // escolha explícita dele, e não uma perda silenciosa nossa.
  return out.replace(/\n{3,}/g, "\n\n");
}

export interface ReconcileResult {
  /** Markdown com marcadores no lugar das tabelas. */
  markdown: string;
  /** Blocos referenciados por esses marcadores, na ordem em que aparecem. */
  blocks: ProtectedBlock[];
}

/**
 * Concilia o texto que a IA devolveu com as tabelas que existiam no trecho.
 *
 * O que a IA recebe é o markdown de verdade da tabela — nunca o marcador, que
 * para ela seria texto solto sem sentido e que ela reescreveria ou apagaria.
 * Mas o que a IA devolve NÃO é aceito como tabela: um modelo com limite de
 * tokens trunca linhas, troca separadores e às vezes simplesmente omite a
 * tabela inteira, e nada disso é visível numa leitura rápida do diff.
 *
 * A regra aqui é: a n-ésima tabela do texto novo volta a ser, byte a byte, a
 * n-ésima tabela do texto original. Tabela original que a IA não devolveu volta
 * no fim do trecho, para que a edição nunca apague conteúdo. Tabela a mais que a
 * IA tenha criado é mantida como ela escreveu, porque aí é conteúdo novo e não
 * há original com que compará-la.
 */
export function reconcileProtectedTables(
  aiMarkdown: string,
  originais: ProtectedBlock[],
  startIndex = 0,
): ReconcileResult {
  // Se o modelo alucinou um marcador, ele não pode virar texto literal no
  // documento do autor — nem apontar para um bloco que não é o dele.
  GUARD_RE.lastIndex = 0;
  const limpo = aiMarkdown.replace(GUARD_RE, "");

  const { markdown, blocks } = extractProtectedBlocks(limpo, startIndex);

  for (let i = 0; i < blocks.length && i < originais.length; i++) {
    blocks[i] = { ...blocks[i], markdown: originais[i].markdown };
  }

  let saida = markdown;
  for (let i = blocks.length; i < originais.length; i++) {
    const bloco: ProtectedBlock = {
      token: protectedToken(startIndex + blocks.length + 1),
      kind: "tabela",
      markdown: originais[i].markdown,
    };
    blocks.push(bloco);
    saida = `${saida.replace(/\s+$/, "")}\n\n${bloco.token}`;
  }

  return { markdown: saida, blocks };
}

/** Ainda há marcador de bloco preservado neste texto? */
export function hasGuardTokens(text: string): boolean {
  GUARD_RE.lastIndex = 0;
  return GUARD_RE.test(text);
}

// ── markdown → HTML ─────────────────────────────────────────────────────────

function inlineMarkdownToHtml(texto: string): string {
  let html = texto;
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

/**
 * Converte markdown em HTML para o TipTap.
 *
 * Diferenças em relação à versão anterior, todas para o texto voltar igual:
 *
 *   • listas ordenadas e não ordenadas viram <ol>/<ul> de verdade, com a
 *     profundidade da indentação preservada em <ul> aninhados;
 *   • linhas consecutivas de citação viram UM <blockquote> com vários <p>, e
 *     não vários <blockquote> de um <p>;
 *   • tabelas saem antes, protegidas (ver extractProtectedBlocks).
 */
export function markdownToHtml(md: string, startIndex = 0): MarkdownToHtmlResult {
  const { markdown: semTabelas, blocks } = extractProtectedBlocks(md, startIndex);
  const linhas = semTabelas.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  // As listas são acumuladas e só então serializadas. A tentativa anterior
  // abria a lista aninhada como IRMÃ do <li>, o que é HTML inválido — o TipTap
  // descartava os filhos e a indentação sumia. Em HTML a sublista mora DENTRO
  // do <li> do pai, e para saber onde ela termina é preciso ver o item seguinte;
  // por isso o item só é fechado depois, na serialização.
  interface ItemLista {
    texto: string;
    tag: "ul" | "ol";
    indent: number;
    filhos: ItemLista[];
  }
  let listaAtual: ItemLista[] = [];

  const serializarLista = (itens: ItemLista[]): string => {
    if (!itens.length) return "";
    const tag = itens[0].tag;
    const corpo = itens
      .map((it) => `<li><p>${it.texto}</p>${serializarLista(it.filhos)}</li>`)
      .join("");
    return `<${tag}>${corpo}</${tag}>`;
  };

  /** Insere o item na profundidade certa da árvore em construção. */
  const inserirItem = (item: ItemLista) => {
    if (!listaAtual.length || item.indent <= listaAtual[0].indent) {
      // Mesmo nível da raiz: troca de tipo (ul↔ol) fecha a lista anterior.
      if (listaAtual.length && listaAtual[0].tag !== item.tag) {
        out.push(serializarLista(listaAtual));
        listaAtual = [];
      }
      listaAtual.push(item);
      return;
    }
    let alvo = listaAtual[listaAtual.length - 1];
    while (alvo.filhos.length && item.indent > alvo.filhos[0].indent) {
      alvo = alvo.filhos[alvo.filhos.length - 1];
    }
    if (alvo.filhos.length && alvo.filhos[0].tag !== item.tag) {
      // Tipo diferente no mesmo nível de aninhamento: mantém junto, porque
      // separar criaria uma lista órfã dentro do item.
      item.tag = alvo.filhos[0].tag;
    }
    alvo.filhos.push(item);
  };

  let citacao: string[] | null = null;

  const fecharListas = () => {
    if (listaAtual.length) {
      out.push(serializarLista(listaAtual));
      listaAtual = [];
    }
  };
  const fecharCitacao = () => {
    if (citacao) {
      out.push(`<blockquote>${citacao.map((l) => `<p>${l}</p>`).join("")}</blockquote>`);
      citacao = null;
    }
  };

  for (const bruta of linhas) {
    const linha = bruta;
    const trimmed = linha.trim();

    const mCitacao = linha.match(/^>\s?(.*)$/);
    if (mCitacao) {
      fecharListas();
      // Linha ">" sozinha é separador de parágrafo DENTRO da citação.
      (citacao ??= []).push(inlineMarkdownToHtml(mCitacao[1].trim()));
      continue;
    }
    fecharCitacao();

    const mH = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (mH) {
      fecharListas();
      const n = mH[1].length;
      out.push(`<h${n}>${inlineMarkdownToHtml(mH[2])}</h${n}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      fecharListas();
      out.push("<hr>");
      continue;
    }

    const mUl = linha.match(/^(\s*)[-*+]\s+(.+)$/);
    const mOl = linha.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (mUl || mOl) {
      const m = (mUl ?? mOl)!;
      inserirItem({
        texto: inlineMarkdownToHtml(m[2]),
        tag: mUl ? "ul" : "ol",
        indent: m[1].length,
        filhos: [],
      });
      continue;
    }
    fecharListas();

    if (!trimmed) continue;
    out.push(`<p>${inlineMarkdownToHtml(trimmed)}</p>`);
  }

  fecharCitacao();
  fecharListas();

  return { html: out.join("\n"), protectedBlocks: blocks };
}

// ── HTML → markdown ─────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function inlineHtmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<strong><em>(.*?)<\/em><\/strong>/gi, "***$1***");
  md = md.replace(/<em><strong>(.*?)<\/strong><\/em>/gi, "***$1***");
  md = md.replace(/<(?:strong|b)>(.*?)<\/(?:strong|b)>/gi, "**$1**");
  md = md.replace(/<(?:em|i)>(.*?)<\/(?:em|i)>/gi, "*$1*");
  md = md.replace(/<code>(.*?)<\/code>/gi, "`$1`");
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<[^>]+>/g, "");
  return decodeEntities(md).trim();
}

/**
 * Converte o HTML do TipTap de volta em markdown.
 *
 * Percorre a árvore em vez de aplicar regex sobre a string inteira: era o
 * achatamento por regex que transformava todo <li> em "- ", perdendo a
 * numeração das listas ordenadas, e que só sabia ler citação de um parágrafo só.
 */
export function htmlToMarkdown(html: string, protectedBlocks: ProtectedBlock[] = []): string {
  const doc = typeof DOMParser !== "undefined"
    ? new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html")
    : null;

  // Sem DOM (ambiente de teste em Node sem jsdom) caímos no caminho por regex,
  // que é suficiente para o conteúdo simples e nunca é usado no navegador.
  if (!doc) return restoreProtectedBlocks(legacyHtmlToMarkdown(html), protectedBlocks);

  const root = doc.getElementById("root");
  if (!root) return restoreProtectedBlocks(legacyHtmlToMarkdown(html), protectedBlocks);

  const partes: string[] = [];

  const listaParaMd = (el: Element, nivel: number): string[] => {
    const linhas: string[] = [];
    const ordenada = el.tagName.toLowerCase() === "ol";
    let n = 1;
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== "li") continue;
      // Texto do item = tudo que não for lista aninhada.
      const filhosLista = Array.from(li.children).filter((c) =>
        ["ul", "ol"].includes(c.tagName.toLowerCase()),
      );
      const clone = li.cloneNode(true) as Element;
      for (const c of Array.from(clone.children)) {
        if (["ul", "ol"].includes(c.tagName.toLowerCase())) c.remove();
      }
      const texto = inlineHtmlToMarkdown(clone.innerHTML);
      const prefixo = ordenada ? `${n}. ` : "- ";
      linhas.push(`${"  ".repeat(nivel)}${prefixo}${texto}`);
      n++;
      for (const sub of filhosLista) linhas.push(...listaParaMd(sub, nivel + 1));
    }
    return linhas;
  };

  for (const el of Array.from(root.children)) {
    const tag = el.tagName.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      partes.push(`${"#".repeat(Number(tag[1]))} ${inlineHtmlToMarkdown(el.innerHTML)}`);
    } else if (tag === "hr") {
      partes.push("---");
    } else if (tag === "ul" || tag === "ol") {
      partes.push(listaParaMd(el, 0).join("\n"));
    } else if (tag === "blockquote") {
      // Cada parágrafo interno vira uma linha com ">", e o separador entre eles
      // é a linha "> " — que é como o gerador escreve os callouts.
      const ps = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "p");
      const linhas = (ps.length ? ps.map((p) => inlineHtmlToMarkdown(p.innerHTML))
        : [inlineHtmlToMarkdown(el.innerHTML)]);
      partes.push(linhas.map((l) => (l ? `> ${l}` : "> ")).join("\n"));
    } else if (tag === "pre") {
      partes.push("```\n" + inlineHtmlToMarkdown(el.innerHTML) + "\n```");
    } else {
      const t = inlineHtmlToMarkdown(el.innerHTML);
      if (t) partes.push(t);
    }
  }

  const md = partes.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return restoreProtectedBlocks(md, protectedBlocks);
}

/** Caminho por regex, usado só quando não há DOM disponível. */
function legacyHtmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<h([1-3])[^>]*>(.*?)<\/h\1>/gi, (_m, n, c) => `${"#".repeat(Number(n))} ${c}\n`);
  md = md.replace(/<hr[^>]*\/?>/gi, "---\n");
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<\/?(?:ul|ol)[^>]*>/gi, "");
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_m, c) =>
    c.replace(/<p[^>]*>(.*?)<\/p>/gi, "> $1\n"));
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n");
  return inlineHtmlToMarkdown(md).replace(/\n{3,}/g, "\n\n").trim();
}
