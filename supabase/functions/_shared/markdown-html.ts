// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o markdown do curso vira HTML de verdade
//
// O QUE HAVIA
//
// O export-scorm e o export-moodle tinham o MESMO conversor, copiado de um para
// o outro, e nenhum dos dois entendia tabela. Uma tabela do curso — e o curso de
// orçamento tem seis — chegava ao aluno assim:
//
//   <p>| Poder | Limite | Apurado |</p>
//   <p>| --- | --- | --- |</p>
//   <p>| Executivo | 54% | 51,3% |</p>
//
// Sopa de barras verticais. O mesmo valia para a sequência numerada, que virava
// uma lista com marcador redondo, perdendo a ordem que era justamente o ponto.
//
// A observação que originou isto: toda a inteligência de layout que o motor de
// slides construiu — linha do tempo, tabela, matriz, destaque numérico — morre
// fora do PPTX. Quem faz o curso no Moodle lê parágrafos.
//
// POR QUE NÃO MERMAID
//
// A sugestão original era gerar diagramas com Mermaid.js. Recusei por um motivo
// prático: o pacote SCORM tem de funcionar OFFLINE, dentro do LMS, sem buscar
// nada na rede. Usar Mermaid significaria embutir a biblioteca (perto de 1 MB)
// em cada pacote, e depender de o LMS permitir a execução dela. Tabela, linha
// do tempo e destaque numérico feitos com HTML e CSS não dependem de nada,
// pesam alguns kilobytes e são exatamente as formas de que este conteúdo
// precisa. Diagrama de fluxo com setas ramificadas seria caso para Mermaid — e
// não é o que os cursos produzem.
// ═══════════════════════════════════════════════════════════════════════════

function escapar(t: string): string {
  return String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Negrito, itálico, código e link, dentro de uma linha já escapada. */
function inline(t: string): string {
  return escapar(t)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

const LINHA_TABELA = /^\s*\|(.+)\|\s*$/;
const SEPARADOR_TABELA = /^\s*\|[\s:|-]+\|\s*$/;

function celulas(linha: string): string[] {
  const m = linha.match(LINHA_TABELA);
  return (m ? m[1] : "").split("|").map((c) => c.trim());
}

/**
 * O CSS que acompanha o HTML. Vai embutido porque o pacote SCORM roda offline e
 * o Moodle costuma limpar folhas externas.
 */
export const ESTILO_CONTEUDO = `
  .eg-tabela { width:100%; border-collapse:collapse; margin:18px 0; font-size:.95em; }
  .eg-tabela th, .eg-tabela td { border:1px solid #d7dbe0; padding:8px 10px; text-align:left; vertical-align:top; }
  .eg-tabela th { background:#1E3A5F; color:#fff; font-weight:600; }
  .eg-tabela tr:nth-child(even) td { background:#f6f8fa; }
  .eg-passos { list-style:none; padding:0; margin:18px 0; counter-reset:eg; }
  .eg-passos li { counter-increment:eg; position:relative; padding:6px 0 14px 46px; }
  .eg-passos li::before { content:counter(eg); position:absolute; left:0; top:2px;
    width:28px; height:28px; border-radius:50%; background:#1E3A5F; color:#fff;
    font-weight:700; font-size:.85em; display:flex; align-items:center; justify-content:center; }
  .eg-passos li::after { content:""; position:absolute; left:13px; top:32px; bottom:0;
    width:2px; background:#d7dbe0; }
  .eg-passos li:last-child::after { display:none; }
  .eg-nota { border-left:4px solid #C9A227; background:#fdfaf1; margin:16px 0;
    padding:10px 14px; color:#4a4a4a; }
`;

/**
 * Converte o markdown do módulo em HTML.
 *
 * Trata, além do que já era tratado: tabela (vira `<table>` com cabeçalho),
 * lista numerada (vira sequência com numeração visível e fio ligando os
 * passos), citação (vira nota destacada) e bloco de código.
 */
export function markdownParaHtml(md: string): string {
  const linhas = String(md ?? "").split("\n");
  const saida: string[] = [];
  let i = 0;

  const fecharLista = (aberta: string | null) => {
    if (aberta) saida.push(aberta === "ol" ? "</ol>" : "</ul>");
  };
  let listaAberta: string | null = null;

  while (i < linhas.length) {
    const linha = linhas[i];
    const t = linha.trim();

    if (!t) {
      fecharLista(listaAberta);
      listaAberta = null;
      i++;
      continue;
    }

    // ── Bloco de código ──
    if (t.startsWith("```")) {
      fecharLista(listaAberta);
      listaAberta = null;
      const corpo: string[] = [];
      i++;
      while (i < linhas.length && !linhas[i].trim().startsWith("```")) {
        corpo.push(linhas[i]);
        i++;
      }
      i++; // fecha a cerca
      saida.push(`<pre><code>${escapar(corpo.join("\n"))}</code></pre>`);
      continue;
    }

    // ── Tabela ──
    // Precisa de cabeçalho + separador; sem eles é texto com barras, não tabela.
    if (LINHA_TABELA.test(t) && SEPARADOR_TABELA.test(linhas[i + 1]?.trim() ?? "")) {
      fecharLista(listaAberta);
      listaAberta = null;
      const cabecalho = celulas(t);
      i += 2;
      const corpo: string[][] = [];
      while (i < linhas.length && LINHA_TABELA.test(linhas[i].trim())) {
        corpo.push(celulas(linhas[i].trim()));
        i++;
      }
      const th = cabecalho.map((c) => `<th>${inline(c)}</th>`).join("");
      const tr = corpo.map((r) => {
        // Linha curta é preenchida: célula faltando desalinharia a coluna toda.
        const cs = Array.from({ length: cabecalho.length }, (_, k) => r[k] ?? "");
        return `<tr>${cs.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`;
      }).join("");
      saida.push(`<table class="eg-tabela"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
      continue;
    }

    // ── Título ──
    const titulo = t.match(/^(#{1,6})\s+(.+)$/);
    if (titulo) {
      fecharLista(listaAberta);
      listaAberta = null;
      const n = Math.min(titulo[1].length, 6);
      saida.push(`<h${n}>${inline(titulo[2])}</h${n}>`);
      i++;
      continue;
    }

    // ── Citação → nota destacada ──
    if (t.startsWith(">")) {
      fecharLista(listaAberta);
      listaAberta = null;
      const corpo: string[] = [];
      while (i < linhas.length && linhas[i].trim().startsWith(">")) {
        corpo.push(linhas[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      saida.push(`<blockquote class="eg-nota">${inline(corpo.join(" "))}</blockquote>`);
      continue;
    }

    // ── Lista numerada → sequência de passos ──
    // A numeração é o conteúdo: virar marcador redondo apagava a ordem.
    const numerado = t.match(/^\d{1,3}[.)]\s+(.+)$/);
    if (numerado) {
      if (listaAberta !== "ol") {
        fecharLista(listaAberta);
        saida.push('<ol class="eg-passos">');
        listaAberta = "ol";
      }
      saida.push(`<li>${inline(numerado[1])}</li>`);
      i++;
      continue;
    }

    // ── Lista com marcador ──
    const marcado = t.match(/^[-*+]\s+(.+)$/);
    if (marcado) {
      if (listaAberta !== "ul") {
        fecharLista(listaAberta);
        saida.push("<ul>");
        listaAberta = "ul";
      }
      saida.push(`<li>${inline(marcado[1])}</li>`);
      i++;
      continue;
    }

    // ── Régua ──
    if (/^-{3,}$/.test(t)) {
      fecharLista(listaAberta);
      listaAberta = null;
      saida.push("<hr>");
      i++;
      continue;
    }

    // ── Parágrafo ──
    fecharLista(listaAberta);
    listaAberta = null;
    saida.push(`<p>${inline(t)}</p>`);
    i++;
  }

  fecharLista(listaAberta);
  return saida.join("\n");
}
