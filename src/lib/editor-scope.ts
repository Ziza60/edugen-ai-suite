// ═══════════════════════════════════════════════════════════════════════════
// Escopo da edição por IA dentro do editor
//
// POR QUE ISTO SAIU DO BlockEditor
//
// As duas funções decidem o que a IA lê e o que ela pode sobrescrever — o
// caminho por onde o conteúdo do autor pode ser perdido. Dentro do componente
// elas só podiam ser exercitadas clicando na interface; aqui recebem o Editor
// como argumento e um teste consegue montar um documento real, posicionar o
// cursor e conferir a fatia.
// ═══════════════════════════════════════════════════════════════════════════

import type { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import {
  htmlToMarkdown,
  markdownToHtml,
  restoreProtectedBlocks,
  type ProtectedBlock,
} from "./markdown-roundtrip";

/** O que a IA vai reescrever, e como o resultado volta para o documento. */
export type EscopoIA =
  | { tipo: "selecao"; from: number; to: number }
  | { tipo: "secao"; from: number; to: number; titulo: string }
  | { tipo: "modulo" };

export const ESCOPO_LABEL: Record<EscopoIA["tipo"], string> = {
  selecao: "trecho selecionado",
  secao: "seção sob o cursor",
  modulo: "módulo inteiro",
};

/**
 * Decide o que a IA vai reescrever.
 *
 * Seleção primeiro; sem seleção, a SEÇÃO sob o cursor — antes disso, qualquer
 * ação sem seleção reescrevia o módulo inteiro, o que é uma cirurgia grande
 * demais para quem só queria melhorar um parágrafo. O módulo inteiro continua
 * disponível, mas só quando o autor pede explicitamente.
 */
export function resolverEscopo(editor: Editor | null, forcarModulo: boolean): EscopoIA {
  if (!editor || forcarModulo) return { tipo: "modulo" };

  const { from, to } = editor.state.selection;
  if (from !== to) return { tipo: "selecao", from, to };

  // Sem seleção: acha o H2 em que o cursor está e o próximo, delimitando a
  // seção. A varredura é no documento do ProseMirror, e não no markdown,
  // porque é lá que a posição do cursor tem significado.
  const encabecamentos: Array<{ pos: number; texto: string }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.attrs.level === 2) {
      encabecamentos.push({ pos, texto: node.textContent });
    }
    return true;
  });
  if (!encabecamentos.length) return { tipo: "modulo" };

  let idx = -1;
  for (let i = 0; i < encabecamentos.length; i++) {
    if (encabecamentos[i].pos <= from) idx = i;
  }
  // Cursor antes do primeiro título: o texto de abertura não pertence a seção
  // nenhuma, então não há fatia a propor.
  if (idx < 0) return { tipo: "modulo" };

  const inicio = encabecamentos[idx].pos;
  const fim = idx + 1 < encabecamentos.length
    ? encabecamentos[idx + 1].pos
    : editor.state.doc.content.size;
  return { tipo: "secao", from: inicio, to: fim, titulo: encabecamentos[idx].texto };
}

export interface EscopoMarkdown {
  /** O que vai para a IA: markdown de verdade, sem marcador nenhum. */
  texto: string;
  /** Tabelas que estavam dentro do escopo, na ordem do documento. */
  tabelas: ProtectedBlock[];
}

/**
 * Markdown do trecho que será enviado à IA.
 *
 * O marcador ⟦tabela preservada N⟧ NUNCA sai daqui: para o modelo ele é uma
 * linha sem sentido, que ele reescreve ou apaga — e junto vai a tabela. O que
 * sai é a tabela em markdown; quem garante que a original volta intacta depois
 * é reconcileProtectedTables, no caminho de volta.
 */
export function markdownDoEscopo(
  editor: Editor | null,
  escopo: EscopoIA,
  protegidos: ProtectedBlock[],
): EscopoMarkdown {
  if (!editor) return { texto: "", tabelas: [] };

  let html: string;
  if (escopo.tipo === "modulo") {
    html = editor.getHTML();
  } else {
    // Serializa apenas a fatia, para que a IA veja markdown de verdade
    // (títulos, listas, ênfase) em vez de texto plano.
    const slice = editor.state.doc.slice(escopo.from, escopo.to);
    const div = document.createElement("div");
    div.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content));
    html = div.innerHTML;
  }

  // Converte SEM restaurar, para descobrir quais marcadores caem neste escopo.
  const comMarcadores = htmlToMarkdown(html, []);
  const tabelas = protegidos
    .map((b) => ({ b, i: comMarcadores.indexOf(b.token) }))
    .filter((x) => x.i >= 0)
    .sort((a, z) => a.i - z.i)
    .map((x) => x.b);

  return { texto: restoreProtectedBlocks(comMarcadores, tabelas), tabelas };
}

export interface EdicaoAplicada {
  /** Markdown que deve ser gravado — é o que o auto-save do CourseView recebe. */
  markdown: string;
  /** Lista de blocos protegidos atualizada, para substituir a anterior. */
  protegidos: ProtectedBlock[];
}

/**
 * Escreve no documento a edição que o autor aprovou no diff.
 *
 * É o único ponto do editor em que a IA altera o documento. Fica aqui, e não no
 * componente, porque é o passo em que uma fatia errada apaga texto do autor —
 * e isso precisa ser exercitável por teste, com um documento de verdade.
 */
export function aplicarEdicaoAprovada(
  editor: Editor,
  escopo: EscopoIA,
  depoisComTokens: string,
  blocos: ProtectedBlock[],
  protegidos: ProtectedBlock[],
  mode: "append" | "replace",
): EdicaoAplicada {
  // O texto já vem com marcador no lugar das tabelas, então aqui não sobra
  // tabela crua para extrair — o segundo retorno é só uma rede, caso algo escape.
  const { html, protectedBlocks: extras } = markdownToHtml(
    depoisComTokens,
    protegidos.length + blocos.length,
  );
  const atualizados = [...protegidos, ...blocos, ...extras];

  if (escopo.tipo === "selecao" || escopo.tipo === "secao") {
    // Uma única transação: o ⌘Z desfaz a edição inteira de uma vez.
    editor
      .chain()
      .focus()
      .deleteRange({ from: escopo.from, to: escopo.to })
      .insertContentAt(escopo.from, html)
      .run();
  } else if (mode === "append") {
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, html).run();
  } else {
    editor.commands.setContent(html);
  }

  return {
    markdown: htmlToMarkdown(editor.getHTML(), atualizados),
    protegidos: atualizados,
  };
}
