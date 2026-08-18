import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "../lib/plans";

// ═══════════════════════════════════════════════════════════════════════════
// As três exportações do mesmo nível tinham três travas diferentes:
//
//   SCORM   — exigia o plano "business". O comentário no código dizia, com
//             todas as letras, que nenhum plano business existe: devolvia 403
//             para TODO MUNDO. O assinante Pro pagava pelo recurso, via o botão
//             liberado e recebia "requires a Business plan" — um plano que não
//             está à venda.
//   Moodle  — exigia "pro". Correto.
//   Notion  — não tinha trava nenhuma. O botão some da tela no plano free, mas
//             a tela não é trava: chamando a função direto, saía de graça.
//
// Nada ligava a trava de cada função ao que a página de planos vende. Este
// teste lê o código-fonte das funções justamente porque é lá que a regra mora,
// e é lá que ela se desencontrou.
// ═══════════════════════════════════════════════════════════════════════════

const FUNCOES = resolve(__dirname, "../../supabase/functions");
const fonte = (nome: string) => readFileSync(`${FUNCOES}/${nome}/index.ts`, "utf8");

/** Exportações vendidas como recurso do Pro, com o campo que as representa. */
const EXPORTACOES_PRO = [
  { funcao: "export-scorm", limite: "hasScorm" },
  { funcao: "export-moodle", limite: "hasMoodle" },
  { funcao: "export-notion", limite: "hasNotion" },
] as const;

describe("o que a tabela de planos promete", () => {
  it("as três exportações são do Pro, e não do free nem do starter", () => {
    for (const { limite } of EXPORTACOES_PRO) {
      expect(PLAN_LIMITS.pro[limite], `pro.${limite}`).toBe(true);
      expect(PLAN_LIMITS.free[limite], `free.${limite}`).toBe(false);
      expect(PLAN_LIMITS.starter[limite], `starter.${limite}`).toBe(false);
    }
  });
});

describe("a trava que cada função aplica de fato", () => {
  it.each(EXPORTACOES_PRO)("$funcao exige plano no servidor", ({ funcao }) => {
    // Sem esta checagem, a tela é a única barreira — e tela não é barreira.
    expect(fonte(funcao)).toMatch(/from\("subscriptions"\)[\s\S]{0,120}?select\("plan"\)/);
  });

  it.each(EXPORTACOES_PRO)("$funcao aceita o Pro", ({ funcao }) => {
    // O defeito do SCORM: a trava era `plan !== "business"`, e business não
    // existe. Toda exportação vendida no Pro tem de aceitar o Pro.
    expect(fonte(funcao)).toMatch(/plan !== "pro"/);
  });

  it.each(EXPORTACOES_PRO)("$funcao não exige um plano que não está à venda", ({ funcao }) => {
    const texto = fonte(funcao);
    // "business" pode aparecer como tolerância a um plano futuro
    // (`plan !== "pro" && plan !== "business"`), mas nunca sozinho.
    const exigeSoBusiness = /plan !== "business"(?!\s*\))/.test(texto) &&
      !/plan !== "pro"/.test(texto);
    expect(exigeSoBusiness, `${funcao} exige business sem aceitar pro`).toBe(false);
  });

  it("as três aplicam a MESMA trava — divergir foi como isso começou", () => {
    const travas = EXPORTACOES_PRO.map(({ funcao }) => {
      const m = /if \(plan !== "pro"[^)]*\) \{/.exec(fonte(funcao));
      return m?.[0] ?? `(sem trava em ${funcao})`;
    });
    expect(new Set(travas).size, `travas encontradas: ${travas.join(" | ")}`).toBe(1);
  });

  it("todas preservam a saída de teste por profiles.is_dev", () => {
    for (const { funcao } of EXPORTACOES_PRO) {
      expect(fonte(funcao), funcao).toMatch(/is_dev/);
    }
  });

  it("a mensagem de erro nomeia o plano certo", () => {
    // "requires a Business plan" mandava o assinante procurar um plano que não
    // existe na página de preços.
    //
    // A checagem olha o campo `error:` da resposta, e não o arquivo inteiro:
    // os comentários que explicam o defeito citam a frase antiga de propósito,
    // e casar com eles seria o teste medindo a documentação em vez do código.
    for (const { funcao } of EXPORTACOES_PRO) {
      const texto = fonte(funcao);
      expect(texto, funcao).toMatch(/error: "[^"]*requires a Pro plan/);
      expect(texto, funcao).not.toMatch(/error: "[^"]*requires a Business plan/);
    }
  });
});
