import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";

// ═══════════════════════════════════════════════════════════════════════════
// A configuração do editor bate com a versão instalada do TipTap?
//
// O BlockEditor foi escrito sem certeza sobre v2 ou v3, e a diferença não
// aparece em erro de compilação: na v3 o StarterKit passou a incluir o Link, e
// registrar o nosso por cima só produz um aviso no console — enquanto qual das
// duas configurações vale (openOnClick, classe do link) fica indefinido.
//
// Este teste monta um editor com a MESMA lista de extensões do BlockEditor e
// falha se algum nome aparecer duas vezes ou se algum comando usado no
// componente não existir na versão instalada.
// ═══════════════════════════════════════════════════════════════════════════

/** Espelha as extensões do BlockEditor. Mantenha as duas listas juntas. */
const EXTENSOES = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline" } }),
  Placeholder.configure({ placeholder: "Comece a escrever o conteúdo do módulo..." }),
];

/** Todo comando encadeado que o BlockEditor chama. */
const COMANDOS = [
  "focus", "toggleHeading", "toggleBold", "toggleItalic", "toggleCode",
  "toggleBulletList", "toggleOrderedList", "toggleBlockquote",
  "setHorizontalRule", "undo", "redo", "extendMarkRange", "setLink",
  "unsetLink", "deleteRange", "insertContentAt", "setContent",
];

function montar() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: EXTENSOES, content: "<h2>T</h2><p>a</p>" });
}

describe("configuração do TipTap", () => {
  it("não registra duas extensões com o mesmo nome", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = montar();

    const nomes = editor.extensionManager.extensions.map((e) => e.name);
    const repetidos = nomes.filter((n, i) => nomes.indexOf(n) !== i);
    expect(repetidos).toEqual([]);

    const avisos = warn.mock.calls.map((c) => String(c[0]));
    expect(avisos.filter((a) => a.includes("Duplicate extension names"))).toEqual([]);

    warn.mockRestore();
    editor.destroy();
  });

  it("expõe todos os comandos que o editor usa", () => {
    const editor = montar();
    const faltando = COMANDOS.filter(
      (c) => typeof (editor.commands as Record<string, unknown>)[c] !== "function",
    );
    expect(faltando).toEqual([]);
    editor.destroy();
  });

  it("a configuração do Link é a nossa, e não a do StarterKit", () => {
    const editor = montar();
    const link = editor.extensionManager.extensions.find((e) => e.name === "link");
    expect(link?.options.openOnClick).toBe(false);
    expect(link?.options.HTMLAttributes?.class).toBe("text-primary underline");
    editor.destroy();
  });
});
