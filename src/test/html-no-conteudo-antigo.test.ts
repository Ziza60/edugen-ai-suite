import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeLineBreakTags } from "../../supabase/functions/_shared/markdown";
import { inspectCourse } from "../../supabase/functions/_shared/quality-gate";

// ═══════════════════════════════════════════════════════════════════════════
// O `<br>` QUE JÁ ESTÁ NO BANCO
//
// `normalizeLineBreakTags` roda na GERAÇÃO. Todo curso gerado antes dela guarda
// `<br>` para sempre, e o portão o reprova:
//
//   Laudo de qualidade — Revisar antes de publicar
//   90/100 estrutural, 1 bloqueador
//   Nenhum marcador interno ou HTML no conteúdo — 2 ocorrência(s) de tag HTML
//
// O curso da 'Doceria Sabor de Infância' tem 31 `<br>` em duas linhas, e o
// normalizador de hoje limpa as duas. O defeito não é dele: é de a limpeza não
// acontecer também na LEITURA. Ver CourseView, onde os módulos entram na tela.
// ═══════════════════════════════════════════════════════════════════════════

const ARQUIVO = "preco-doceria-sabor-de-infancia.md";

function modulos(texto: string) {
  const linhas = texto.split("\n");
  const ini: number[] = [];
  linhas.forEach((l, i) => { if (l.startsWith("# ")) ini.push(i); });
  return ini.map((a, k) => ({
    module_number: k + 1,
    title: linhas[a].slice(2).trim(),
    markdown: linhas.slice(a + 1, ini[k + 1] ?? linhas.length).join("\n"),
    is_capstone: k === ini.length - 1,
  }));
}

const bruto = readFileSync(
  resolve(process.cwd(), "src/test/cursos-reais", ARQUIVO), "utf8",
);

describe("conteúdo antigo com <br>", () => {
  it("o curso guardado tem 31 tags em 2 linhas — é o estado real do banco", () => {
    expect((bruto.match(/<br/gi) ?? []).length).toBe(31);
    expect(bruto.split("\n").filter((l) => /<br/i.test(l))).toHaveLength(2);
  });

  it("o portão reprova o conteúdo como está", () => {
    const achados = inspectCourse({ course_title: ARQUIVO, modules: modulos(bruto) })
      .checks.filter((c) => !c.passed && /html|marcador/i.test(c.id + c.label));
    expect(achados.length).toBeGreaterThan(0);
  });

  it("e passa depois da limpeza na leitura", () => {
    const limpo = normalizeLineBreakTags(bruto);
    expect(limpo).not.toMatch(/<br/i);
    const achados = inspectCourse({ course_title: ARQUIVO, modules: modulos(limpo) })
      .checks.filter((c) => !c.passed && /html|marcador/i.test(c.id + c.label));
    expect(achados.map((c) => c.evidence).flat()).toEqual([]);
  });

  it("a limpeza não come conteúdo — os números das contas sobrevivem", () => {
    // O bloco do Ponto de Equilíbrio é todo feito de `<br>`; se a limpeza
    // engolisse texto, seria aqui.
    const limpo = normalizeLineBreakTags(bruto);
    for (const n of ["R$ 3.550,00", "R$ 22,40", "158,49", "R$ 6.360,00", "R$ 2.800,00"]) {
      expect(limpo, n).toContain(n);
    }
  });
});
