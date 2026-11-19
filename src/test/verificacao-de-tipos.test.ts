import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// `npx tsc --noEmit` NA RAIZ VERIFICA ZERO ARQUIVOS
//
// MEDIDO em 19/11/2026, com --listFiles:
//
//   npx tsc --noEmit            →    0 arquivos
//   tsc --noEmit -p tsconfig.app.json  → 1430 arquivos
//   tsc --noEmit -p tsconfig.node.json →  228 arquivos
//
// A causa está no tsconfig.json da raiz: `"files": []` mais `references`. O
// `tsc --noEmit` NÃO segue references (isso é trabalho do `tsc --build`), então
// ele abre o projeto, não encontra arquivo nenhum para compilar, e sai com
// código 0. Limpo e vazio são indistinguíveis na saída.
//
// O que isso custou: eu reportei "tsc limpo" dezenas de vezes neste projeto a
// partir desse comando. Primeiro concluí que ele cobria `src/` mas não as Edge
// Functions; essa correção também estava errada — ele não cobria NADA. No mesmo
// dia em que medi isto, o comando devolveu 0 com um `Cannot find name 'file'`
// real em PdfImportScreen.tsx, que só apareceu com `-p tsconfig.app.json`.
//
// A trava: o script `typecheck` precisa existir e precisa nomear todos os
// projetos referenciados. Verificar tipos com um comando que não olha arquivo
// nenhum é a régua que não olha o que afirma medir — o defeito assinado deste
// projeto, desta vez no meu próprio instrumento.
//
// AINDA EM ABERTO, de propósito: `supabase/functions` continua fora dos dois
// projetos (~6 mil linhas sem verificação de tipos). O que cobre a classe de
// falha que derrubou o app está em `exports-das-edge-functions.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

const raiz = process.cwd();

/**
 * Os tsconfig são JSONC: `tsconfig.node.json` traz `/* Bundler mode *\/` e o
 * `JSON.parse` cru morre nele. Tira comentário de bloco, comentário de linha
 * (só no começo da linha, para não cortar o `//` de uma URL) e vírgula sobrando.
 */
function leJsonc(p: string): any {
  const texto = readFileSync(resolve(raiz, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(texto);
}
const leJson = leJsonc;

const tsconfig = leJson("tsconfig.json");
const pkg = leJson("package.json");

describe("o comando que verifica tipos olha arquivos de verdade", () => {
  it("a raiz é um projeto vazio com references — por isso `tsc --noEmit` nela não serve", () => {
    expect(tsconfig.files).toEqual([]);
    expect(Array.isArray(tsconfig.references)).toBe(true);
    expect(tsconfig.references.length).toBeGreaterThanOrEqual(2);
  });

  it("existe um script `typecheck`", () => {
    expect(pkg.scripts?.typecheck).toBeTruthy();
  });

  it("o script nomeia TODOS os projetos referenciados na raiz", () => {
    // Se alguém acrescentar um terceiro tsconfig e esquecer o script, este cai.
    const script: string = pkg.scripts.typecheck;
    const faltando = (tsconfig.references as Array<{ path: string }>)
      .map((r) => r.path.replace(/^\.\//, ""))
      .filter((p) => !script.includes(p));
    expect(faltando, `projeto referenciado fora do script typecheck: ${faltando}`)
      .toEqual([]);
  });

  it("o script não é um `tsc --noEmit` solto, que mediria zero", () => {
    const script: string = pkg.scripts.typecheck;
    expect(script).toMatch(/-p\s+tsconfig\./);
  });

  it("cada projeto referenciado realmente inclui arquivos", () => {
    // Um `include` vazio devolveria o mesmo 0 com cara de aprovação.
    for (const { path } of tsconfig.references as Array<{ path: string }>) {
      const conf = leJson(path);
      expect(
        Array.isArray(conf.include) && conf.include.length > 0,
        `${path} não inclui arquivo nenhum`,
      ).toBe(true);
    }
  });
});
