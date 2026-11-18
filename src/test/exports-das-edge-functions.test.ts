import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// O QUE TIROU O APP DO AR EM 18/11/2026
//
// Eu exportei `containsLikelyUnsupportedNumber` duas vezes no mesmo arquivo:
// `export function` na declaração E o nome dentro do bloco `export { }` no fim
// de `course-pipeline.ts`. Exportar o mesmo nome duas vezes é erro de módulo: o
// Deno recusa carregar, a Edge Function não sobe, e o navegador não recebe
// resposta nenhuma — a tela mostra "Erro ao gerar curso: failed to fetch", que
// não parece um erro de compilação e manda procurar no lugar errado.
//
// POR QUE NADA PEGOU, e isto é o achado mais importante:
//
//   `npx tsc --noEmit` verifica ZERO arquivos de supabase/functions. Medido:
//   `tsc --noEmit --listFiles | grep -c supabase/functions` → 0. O tsconfig da
//   raiz tem `"files": []` e referencia tsconfig.app.json e tsconfig.node.json,
//   que cobrem `src/`. Todo "tsc limpo" que eu reportei por semanas foi uma
//   afirmação sobre o front-end, não sobre as Edge Functions — que é onde
//   praticamente todo o trabalho deste projeto aconteceu.
//
//   E o esbuild do Vitest tolera a duplicata em silêncio: a suíte inteira
//   passou, 1128 testes, com a função quebrada em produção.
//
// Este arquivo é a trava que faltava. Ele não substitui um `deno check` — o
// Deno não está disponível neste contêiner —, mas cobre exatamente a classe que
// escapou, de forma determinística e sem rede.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = resolve(process.cwd(), "supabase/functions");

function arquivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...arquivosTs(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Nomes exportados na própria declaração: `export function x`, `export const x`. */
function exportsInline(fonte: string): string[] {
  return [
    ...fonte.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|interface|type|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
    ),
  ].map((m) => m[1]);
}

/** Nomes listados em blocos `export { a, b, c };` — sem `from`, que é re-export. */
function exportsEmBloco(fonte: string): string[] {
  const nomes: string[] = [];
  for (const m of fonte.matchAll(/^export\s*\{([^}]*)\}\s*(;|$)/gm)) {
    for (const bruto of m[1].split(",")) {
      const nome = bruto.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (nome) nomes.push(nome);
    }
  }
  return nomes;
}

const ARQUIVOS = arquivosTs(DIR);

describe("as Edge Functions não têm nome exportado duas vezes", () => {
  it("há arquivos para examinar", () => {
    // Se este cair, o caminho mudou e os testes abaixo passariam vazios —
    // exatamente o tipo de verificação que não olha o que afirma medir.
    expect(ARQUIVOS.length).toBeGreaterThan(8);
  });

  it("nenhum nome aparece na declaração E num bloco export", () => {
    const problemas: string[] = [];
    for (const arq of ARQUIVOS) {
      const fonte = readFileSync(arq, "utf8");
      const inline = new Set(exportsInline(fonte));
      const dobrados = exportsEmBloco(fonte).filter((n) => inline.has(n));
      for (const n of new Set(dobrados)) {
        problemas.push(`${arq.replace(DIR, "supabase/functions")}: ${n}`);
      }
    }
    expect(problemas, `exportado duas vezes:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("nenhum nome é declarado como export duas vezes na mesma forma", () => {
    const problemas: string[] = [];
    for (const arq of ARQUIVOS) {
      const fonte = readFileSync(arq, "utf8");
      const contagem = new Map<string, number>();
      for (const n of exportsInline(fonte)) {
        contagem.set(n, (contagem.get(n) ?? 0) + 1);
      }
      for (const [n, c] of contagem) {
        // `interface` + `function` com o mesmo nome é legítimo em TS (declaration
        // merging de tipo e valor); duas funções com o mesmo nome, não.
        if (c > 1 && !new RegExp(`^export (?:interface|type) ${n}\\b`, "m").test(fonte)) {
          problemas.push(`${arq.replace(DIR, "supabase/functions")}: ${n} (${c}x)`);
        }
      }
    }
    expect(problemas, `declarado export mais de uma vez:\n${problemas.join("\n")}`)
      .toEqual([]);
  });

  it("o detector reconhece a duplicata que escapou, para não passar vazio", () => {
    // A trava precisa provar que ACUSA, e não só que passa. Esta é a forma
    // exata do que foi para produção em 560360f.
    const quebrado = [
      "export function alvo(a: string): string[] { return [a]; }",
      "export {",
      "  outra,",
      "  alvo,",
      "};",
    ].join("\n");
    const inline = new Set(exportsInline(quebrado));
    expect(exportsEmBloco(quebrado).filter((n) => inline.has(n))).toEqual(["alvo"]);
  });

  it("re-export com `from` não é confundido com duplicata", () => {
    const legitimo = [
      "export function alvo(): void {}",
      'export { alvo } from "./outro.ts";',
    ].join("\n");
    // O bloco com `from` é re-export de OUTRO módulo e não entra na contagem.
    expect(exportsEmBloco(legitimo)).toEqual([]);
  });
});
