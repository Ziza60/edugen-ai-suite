import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  markdownHasPlaceholder, placeholdersNoMarkdown, MARKDOWN_PLACEHOLDER_PATTERNS,
  PLACEHOLDER_PATTERNS,
} from "../../supabase/functions/_shared/course-pipeline";
import {
  eUltimaTentativa, MAX_TENTATIVAS,
} from "../../supabase/functions/_shared/course-dispatch.ts";

// ═══════════════════════════════════════════════════════════════════════════
// 7 MÓDULOS PEDIDOS, 7 PLANEJADOS, 7 GERADOS, 3 GRAVADOS
//
// MEDIDO no curso 30305a65, de 19/11/2026, no log da função:
//
//   course-module-done ..... índices 0, 1 e 6, descartado=false
//   "Módulo 3 falhou: Módulo 4 sem conteúdo entregável:
//    Placeholder detectado no Markdown final."  ← três vezes, 17:26, 17:28, 17:30
//
// Os sete objetivos do curso (CO1..CO7) mostram que o blueprint tinha 7
// módulos. O usuário recebeu 1, 2 e 7, sem nada na tela explicando o buraco.
//
// TRÊS DEFEITOS NUMA LINHA DE LOG:
//
// 1. A mensagem não diz QUAL dos treze padrões casou nem onde. Levantei a
//    hipótese de `resposta esperada` ou `criterio de avaliacao \d+` — legítimos
//    num curso que ensina critérios de auditoria — e fui medir: rodei o
//    detector contra os 15 cursos reais do acervo e nenhum reprova. A medição
//    não serviu, porque os 15 são os que PASSARAM. Viés de sobrevivência: o
//    markdown reprovado não existe em lugar nenhum.
//
// 2. "Módulo 3 falhou: Módulo 4" é o MESMO módulo, com dois sistemas de
//    numeração na mesma frase — índice base 0 e module_number base 1.
//
// 3. A retentativa repete o mesmo prompt. Se o bloqueio nasce de uma frase que
//    o modelo considera correta, as três tentativas falham igual, e o segundo e
//    o terceiro gasto de tokens são desperdício certo.
// ═══════════════════════════════════════════════════════════════════════════

describe("o achado de placeholder diz qual padrão e onde", () => {
  it("devolve o padrão que casou", () => {
    const md = "## Lição 1\n\nTexto a desenvolver conforme o plano de aula.";
    const achados = placeholdersNoMarkdown(md);
    expect(achados).toHaveLength(1);
    expect(achados[0].padrao).toBe("texto a desenvolver");
  });

  it("devolve o trecho em volta, para dar para achar no módulo", () => {
    const md = "## Matriz\n\nA equipe define o escopo. Preencher conteúdo aqui. Depois valida.";
    const [achado] = placeholdersNoMarkdown(md);
    expect(achado.trecho).toContain("preencher conteudo");
    expect(achado.trecho).toContain("define o escopo");
    expect(achado.trecho).toContain("depois valida");
  });

  it("acha mais de um padrão quando há mais de um", () => {
    const md = "Texto a desenvolver. E também: exemplo de conteúdo.";
    expect(placeholdersNoMarkdown(md).map((a) => a.padrao).sort())
      .toEqual(["exemplo de conteudo", "texto a desenvolver"]);
  });

  it("markdown limpo devolve lista vazia", () => {
    const md = "## 4.1 Objetivos de auditoria\n\nO objetivo delimita o que será examinado.";
    expect(placeholdersNoMarkdown(md)).toEqual([]);
  });

  it("markdown vazio ou nulo não quebra", () => {
    expect(placeholdersNoMarkdown("")).toEqual([]);
    expect(placeholdersNoMarkdown(undefined as any)).toEqual([]);
  });
});

describe("o booleano e a lista não podem divergir", () => {
  it("markdownHasPlaceholder é a lista não-vazia, e nada mais", () => {
    // Duas implementações da mesma pergunta divergem com o tempo. Esta é uma
    // régua que olha exatamente o que afirma medir.
    for (const md of [
      "Texto a desenvolver.",
      "## Limpo\n\nUm parágrafo normal sobre matriz de planejamento.",
      "",
      "Resposta esperada: a equipe valida a matriz.",
    ]) {
      expect(markdownHasPlaceholder(md)).toBe(placeholdersNoMarkdown(md).length > 0);
    }
  });

  it("o rótulo do próprio renderizador continua não reprovando", () => {
    // Este já custou 100% dos módulos reprovados uma vez: "**Objetivo da
    // lição:**" é emitido para TODA lição por renderModuleMarkdown.
    const md = "### 1.1 Definição\n\n> **Objetivo da lição:** Definir auditoria operacional.";
    expect(placeholdersNoMarkdown(md)).toEqual([]);
  });

  it("a lista do Markdown é menor que a lista campo a campo", () => {
    expect(MARKDOWN_PLACEHOLDER_PATTERNS.length).toBeLessThan(PLACEHOLDER_PATTERNS.length);
    expect(MARKDOWN_PLACEHOLDER_PATTERNS.length).toBeGreaterThan(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A REGRA DA ÚLTIMA TENTATIVA
//
// `claim_course_generation_job` faz `attempts = attempts + 1 ... where attempts
// < 3 returning *`. Então o claim devolve 1, 2 ou 3, e um quarto claim não
// acontece. `attempts === 3` é a última chamada que o job terá.
//
// Errar isto nos dois sentidos tem custo: cedo demais entrega conteúdo ruim que
// uma retentativa teria consertado; tarde demais nunca dispara e o módulo é
// perdido, que é o defeito de hoje.
// ═══════════════════════════════════════════════════════════════════════════

// A primeira versão deste bloco definia a conta aqui dentro, como uma cópia. Ia
// medir meu raciocínio, não o código. `eUltimaTentativa` mora em
// course-dispatch.ts, junto de `reivindicou`, e é a MESMA função que o worker
// chama.

describe("quando o bloqueio vira ressalva", () => {
  it("primeira tentativa: NÃO é a última — o bloqueio ainda bloqueia", () => {
    expect(eUltimaTentativa({ attempts: 1 })).toBe(false);
  });

  it("segunda tentativa: NÃO é a última", () => {
    expect(eUltimaTentativa({ attempts: 2 })).toBe(false);
  });

  it("terceira tentativa: É a última — entrega com ressalva", () => {
    expect(eUltimaTentativa({ attempts: 3 })).toBe(true);
  });

  it("claim sem attempts não é tratado como última", () => {
    // Na dúvida, retentar: o caminho antigo volta o job para 'pending' e a rede
    // de segurança repesca. Tratar o desconhecido como última tentativa
    // entregaria conteúdo ruim na primeira passada.
    expect(eUltimaTentativa({})).toBe(false);
    expect(eUltimaTentativa(null)).toBe(false);
    expect(eUltimaTentativa(undefined)).toBe(false);
    expect(eUltimaTentativa({ attempts: "3" })).toBe(false);
  });

  it("o teto do código e o teto da função SQL são o mesmo número", () => {
    // `claim_course_generation_job` tem `attempts < 3` escrito em SQL. Se um
    // dos dois mudar sozinho, a última tentativa deixa de ser a última.
    expect(MAX_TENTATIVAS).toBe(3);
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260908220000_claim_devolve_zero_linhas.sql"),
      "utf8",
    );
    expect(sql).toContain(`attempts < ${MAX_TENTATIVAS}`);
  });
});
