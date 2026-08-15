import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  resolverEscopo,
  markdownDoEscopo,
  aplicarEdicaoAprovada,
} from "@/lib/editor-scope";
import {
  markdownToHtml,
  htmlToMarkdown,
  reconcileProtectedTables,
  type ProtectedBlock,
} from "@/lib/markdown-roundtrip";

// ═══════════════════════════════════════════════════════════════════════════
// Editor de verdade, no jsdom — nada de simular o ProseMirror
//
// Estes testes montam um TipTap com o mesmo StarterKit e a mesma configuração
// de heading do BlockEditor, carregam markdown pelo mesmo conversor de produção
// e mexem na seleção real. É o único jeito de o resultado significar alguma
// coisa: o que quebra nesse caminho é a posição do cursor dentro do documento
// do ProseMirror, e um dublê de editor não tem posições.
// ═══════════════════════════════════════════════════════════════════════════

const editores: Editor[] = [];

function montarEditor(markdown: string): {
  editor: Editor;
  protegidos: ProtectedBlock[];
} {
  const { html, protectedBlocks } = markdownToHtml(markdown);
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })],
    content: html,
  });
  editores.push(editor);
  return { editor, protegidos: protectedBlocks };
}

/** Põe o cursor (sem seleção) na primeira ocorrência do texto informado. */
function cursorEm(editor: Editor, trecho: string) {
  let alvo = -1;
  editor.state.doc.descendants((node, pos) => {
    if (alvo >= 0) return false;
    if (node.isText && node.text?.includes(trecho)) {
      alvo = pos + (node.text.indexOf(trecho) ?? 0) + 1;
      return false;
    }
    return true;
  });
  if (alvo < 0) throw new Error(`Texto não encontrado no documento: ${trecho}`);
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, alvo),
  );
  editor.view.dispatch(tr);
}

afterEach(() => {
  while (editores.length) editores.pop()?.destroy();
  document.body.innerHTML = "";
});

// ── Documentos de teste ─────────────────────────────────────────────────────

const TRES_SECOES = [
  "# Módulo 1 — Controles internos",
  "",
  "Texto de abertura, antes de qualquer seção.",
  "",
  "## Objetivos de aprendizagem",
  "",
  "Ao final você saberá identificar riscos operacionais.",
  "",
  "- Reconhecer o risco",
  "- Classificar o impacto",
  "",
  "## Como funciona na prática",
  "",
  "O controle interno nasce do mapeamento de processos.",
  "",
  "## Resumo do módulo",
  "",
  "Controles internos reduzem perdas e fraudes.",
].join("\n");

const TABELA = [
  "| Risco | Impacto | Controle |",
  "|---|---|---|",
  "| Fraude de caixa | Alto | Conferência diária |",
  "| Erro de lançamento | Médio | Dupla checagem |",
].join("\n");

const COM_TABELA = [
  "## Introdução",
  "",
  "Todo processo tem risco.",
  "",
  "## Matriz de riscos",
  "",
  "A matriz abaixo relaciona risco, impacto e controle.",
  "",
  TABELA,
  "",
  "## Encerramento",
  "",
  "Revise a matriz a cada trimestre.",
].join("\n");

// ═══════════════════════════════════════════════════════════════════════════
// 3) Fatiamento da "seção sob o cursor"
// ═══════════════════════════════════════════════════════════════════════════

describe("resolverEscopo — seção sob o cursor", () => {
  it("primeira seção: pega só ela, não avança para a seguinte", () => {
    const { editor, protegidos } = montarEditor(TRES_SECOES);
    cursorEm(editor, "identificar riscos");

    const escopo = resolverEscopo(editor, false);
    expect(escopo.tipo).toBe("secao");
    if (escopo.tipo !== "secao") return;
    expect(escopo.titulo).toBe("Objetivos de aprendizagem");

    const { texto } = markdownDoEscopo(editor, escopo, protegidos);
    expect(texto).toContain("## Objetivos de aprendizagem");
    expect(texto).toContain("Classificar o impacto");
    expect(texto).not.toContain("Como funciona na prática");
    expect(texto).not.toContain("Resumo do módulo");
    // O texto de abertura fica de fora: ele é anterior ao primeiro H2.
    expect(texto).not.toContain("Texto de abertura");
  });

  it("seção do meio: não invade nem a anterior nem a seguinte", () => {
    const { editor, protegidos } = montarEditor(TRES_SECOES);
    cursorEm(editor, "mapeamento de processos");

    const escopo = resolverEscopo(editor, false);
    expect(escopo.tipo).toBe("secao");
    if (escopo.tipo !== "secao") return;
    expect(escopo.titulo).toBe("Como funciona na prática");

    const { texto } = markdownDoEscopo(editor, escopo, protegidos);
    expect(texto).toContain("## Como funciona na prática");
    expect(texto).toContain("mapeamento de processos");
    expect(texto).not.toContain("Objetivos de aprendizagem");
    expect(texto).not.toContain("Resumo do módulo");
  });

  it("última seção: vai até o fim do documento", () => {
    const { editor, protegidos } = montarEditor(TRES_SECOES);
    cursorEm(editor, "reduzem perdas");

    const escopo = resolverEscopo(editor, false);
    expect(escopo.tipo).toBe("secao");
    if (escopo.tipo !== "secao") return;
    expect(escopo.titulo).toBe("Resumo do módulo");
    expect(escopo.to).toBe(editor.state.doc.content.size);

    const { texto } = markdownDoEscopo(editor, escopo, protegidos);
    expect(texto).toContain("## Resumo do módulo");
    expect(texto).toContain("reduzem perdas e fraudes");
    expect(texto).not.toContain("Como funciona na prática");
  });

  it("módulo de seção única: a seção é o documento inteiro depois do H2", () => {
    const unica = [
      "## Conceito central",
      "",
      "Primeiro parágrafo.",
      "",
      "Segundo parágrafo.",
    ].join("\n");
    const { editor, protegidos } = montarEditor(unica);
    cursorEm(editor, "Segundo parágrafo");

    const escopo = resolverEscopo(editor, false);
    expect(escopo.tipo).toBe("secao");
    if (escopo.tipo !== "secao") return;
    expect(escopo.titulo).toBe("Conceito central");
    expect(escopo.from).toBe(0);
    expect(escopo.to).toBe(editor.state.doc.content.size);

    const { texto } = markdownDoEscopo(editor, escopo, protegidos);
    expect(texto).toContain("## Conceito central");
    expect(texto).toContain("Primeiro parágrafo.");
    expect(texto).toContain("Segundo parágrafo.");
  });

  it("cursor antes do primeiro H2 cai para o módulo inteiro", () => {
    const { editor } = montarEditor(TRES_SECOES);
    cursorEm(editor, "Texto de abertura");
    expect(resolverEscopo(editor, false).tipo).toBe("modulo");
  });

  it("documento sem H2 cai para o módulo inteiro", () => {
    const { editor } = montarEditor("Só um parágrafo, sem título nenhum.");
    cursorEm(editor, "Só um parágrafo");
    expect(resolverEscopo(editor, false).tipo).toBe("modulo");
  });

  it("seleção vence a seção sob o cursor", () => {
    const { editor } = montarEditor(TRES_SECOES);
    cursorEm(editor, "mapeamento de processos");
    const { from } = editor.state.selection;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, from, from + 10),
      ),
    );
    const escopo = resolverEscopo(editor, false);
    expect(escopo.tipo).toBe("selecao");
  });

  it("escopo forçado ignora a seção e devolve o módulo", () => {
    const { editor } = montarEditor(TRES_SECOES);
    cursorEm(editor, "mapeamento de processos");
    expect(resolverEscopo(editor, true).tipo).toBe("modulo");
  });

  it("as três seções somadas cobrem o documento sem sobreposição", () => {
    const { editor } = montarEditor(TRES_SECOES);
    const alvos = ["identificar riscos", "mapeamento de processos", "reduzem perdas"];
    const faixas = alvos.map((t) => {
      cursorEm(editor, t);
      const e = resolverEscopo(editor, false);
      if (e.tipo !== "secao") throw new Error(`esperava seção em "${t}"`);
      return { from: e.from, to: e.to };
    });
    expect(faixas[0].to).toBe(faixas[1].from);
    expect(faixas[1].to).toBe(faixas[2].from);
    expect(faixas[2].to).toBe(editor.state.doc.content.size);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) Enhance sobre seção que contém tabela
// ═══════════════════════════════════════════════════════════════════════════

describe("edição por IA em seção com tabela", () => {
  it("(a) o marcador não vai para a enhance-paragraph; a tabela vai em markdown", () => {
    const { editor, protegidos } = montarEditor(COM_TABELA);
    expect(protegidos).toHaveLength(1);

    cursorEm(editor, "relaciona risco");
    const escopo = resolverEscopo(editor, false);
    expect(escopo.tipo).toBe("secao");

    const { texto, tabelas } = markdownDoEscopo(editor, escopo, protegidos);

    // É este "texto" que vira o campo `text` do corpo enviado à função.
    expect(texto).not.toContain("⟦");
    expect(texto).not.toContain("⟧");
    expect(texto).not.toMatch(/preservad/i);
    expect(texto).toContain("| Fraude de caixa | Alto | Conferência diária |");
    expect(texto).toContain("|---|---|---|");
    expect(tabelas).toHaveLength(1);
    expect(tabelas[0].markdown).toBe(TABELA);
  });

  it("(b) a IA apagando a tabela: a original volta intacta ao salvar", () => {
    const { editor, protegidos } = montarEditor(COM_TABELA);
    cursorEm(editor, "relaciona risco");
    const escopo = resolverEscopo(editor, false);
    const { tabelas } = markdownDoEscopo(editor, escopo, protegidos);

    // Resposta típica de um modelo com limite de tokens: reescreve a prosa e
    // some com a tabela inteira.
    const daIA = [
      "## Matriz de riscos",
      "",
      "A matriz a seguir cruza cada risco com seu impacto e o controle correspondente.",
    ].join("\n");

    const rec = reconcileProtectedTables(daIA, tabelas, protegidos.length);
    const { markdown } = aplicarEdicaoAprovada(
      editor,
      escopo,
      rec.markdown,
      rec.blocks,
      protegidos,
      "replace",
    );

    expect(markdown).toContain("cruza cada risco");
    expect(markdown).toContain(TABELA);
    expect(markdown).not.toContain("⟦");
    // As outras seções continuam onde estavam.
    expect(markdown).toContain("## Introdução");
    expect(markdown).toContain("## Encerramento");
    expect(markdown).toContain("Revise a matriz a cada trimestre.");
  });

  it("(b) a IA truncando a tabela: vale a original, não a versão da IA", () => {
    const { editor, protegidos } = montarEditor(COM_TABELA);
    cursorEm(editor, "relaciona risco");
    const escopo = resolverEscopo(editor, false);
    const { tabelas } = markdownDoEscopo(editor, escopo, protegidos);

    // Devolve a tabela pela metade — a segunda linha de dados se perdeu.
    const daIA = [
      "## Matriz de riscos",
      "",
      "A matriz abaixo relaciona risco, impacto e controle.",
      "",
      "| Risco | Impacto | Controle |",
      "|---|---|---|",
      "| Fraude de caixa | Alto | Conferência diária |",
    ].join("\n");

    const rec = reconcileProtectedTables(daIA, tabelas, protegidos.length);
    const { markdown } = aplicarEdicaoAprovada(
      editor,
      escopo,
      rec.markdown,
      rec.blocks,
      protegidos,
      "replace",
    );

    expect(markdown).toContain("| Erro de lançamento | Médio | Dupla checagem |");
    expect(markdown).toContain(TABELA);
  });

  it("marcador alucinado pela IA não vira texto literal no documento", () => {
    const { editor, protegidos } = montarEditor(COM_TABELA);
    cursorEm(editor, "relaciona risco");
    const escopo = resolverEscopo(editor, false);
    const { tabelas } = markdownDoEscopo(editor, escopo, protegidos);

    const daIA = [
      "## Matriz de riscos",
      "",
      "Veja a seguir:",
      "",
      "⟦tabela preservada 7⟧",
    ].join("\n");

    const rec = reconcileProtectedTables(daIA, tabelas, protegidos.length);
    const { markdown } = aplicarEdicaoAprovada(
      editor,
      escopo,
      rec.markdown,
      rec.blocks,
      protegidos,
      "replace",
    );

    expect(markdown).not.toContain("preservada 7");
    expect(markdown).toContain(TABELA);
  });

  it("tabela nova criada pela IA é mantida como ela escreveu", () => {
    const { editor, protegidos } = montarEditor(COM_TABELA);
    cursorEm(editor, "Todo processo tem risco");
    const escopo = resolverEscopo(editor, false);
    const { tabelas } = markdownDoEscopo(editor, escopo, protegidos);
    // A seção "Introdução" não tem tabela nenhuma.
    expect(tabelas).toHaveLength(0);

    const nova = [
      "| Etapa | Responsável |",
      "|---|---|",
      "| Mapear | Gestor |",
    ].join("\n");
    const daIA = ["## Introdução", "", "Todo processo tem risco.", "", nova].join("\n");

    const rec = reconcileProtectedTables(daIA, tabelas, protegidos.length);
    const { markdown } = aplicarEdicaoAprovada(
      editor,
      escopo,
      rec.markdown,
      rec.blocks,
      protegidos,
      "replace",
    );

    expect(markdown).toContain(nova);
    // E a tabela original da outra seção não foi tocada.
    expect(markdown).toContain(TABELA);
  });

  it("escopo de módulo inteiro também não vaza marcador", () => {
    const { editor, protegidos } = montarEditor(COM_TABELA);
    const { texto, tabelas } = markdownDoEscopo(editor, { tipo: "modulo" }, protegidos);
    expect(texto).not.toContain("⟦");
    expect(texto).toContain(TABELA);
    expect(tabelas).toHaveLength(1);
  });

  it("append no módulo não duplica as tabelas existentes", () => {
    const { editor, protegidos } = montarEditor(COM_TABELA);
    const escopo = { tipo: "modulo" } as const;
    // É o que o BlockEditor faz em "append": nada de original a repor.
    const rec = reconcileProtectedTables(
      "## Atividade\n\nMonte a matriz do seu setor.",
      [],
      protegidos.length,
    );
    const { markdown } = aplicarEdicaoAprovada(
      editor,
      escopo,
      rec.markdown,
      rec.blocks,
      protegidos,
      "append",
    );

    expect(markdown.split("| Fraude de caixa |").length - 1).toBe(1);
    expect(markdown).toContain("Monte a matriz do seu setor.");
    expect(markdown).toContain(TABELA);
  });

  it("abrir e fechar o editor sem digitar não perde a tabela", () => {
    const { editor, protegidos } = montarEditor(COM_TABELA);
    // É exatamente o que o onUpdate do BlockEditor grava.
    const salvo = htmlToMarkdown(editor.getHTML(), protegidos);
    expect(salvo).toContain(TABELA);
    expect(salvo).not.toContain("⟦");
  });
});
