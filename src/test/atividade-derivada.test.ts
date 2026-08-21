import { describe, expect, it } from "vitest";
import { buildActivityFromModule } from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// A ATIVIDADE QUE SERVIA PARA QUALQUER CURSO
//
// Página 17 do curso de orçamento público, módulo 1. A atividade prática que o
// aluno encontrava era esta:
//
//   Campo                  Orientação
//   Seu contexto           Descreva a situação equivalente na sua realidade.
//   Desafio identificado   Qual é o problema central a resolver?
//   Sua solução            Que caminho você adotaria, e por quê?
//   Resultado esperado     O que mudaria se a solução funcionasse?
//
//   Passos
//   Releia o exemplo trabalhado do módulo.
//   Identifique a situação equivalente no seu contexto.
//   …
//
// Nenhuma palavra sobre orçamento. Serve para panificação e para mergulho
// autônomo igualmente bem — que é justamente o defeito.
//
// O bloco é derivado quando o modelo não devolve um `activity` próprio. Ele
// tinha o exemplo resolvido inteiro na mão — contexto, desafio, solução e
// resultado — e não usava uma palavra dele.
// ═══════════════════════════════════════════════════════════════════════════

const EXEMPLO = {
  id: "b1",
  type: "worked_example",
  heading: "Aplicação da LDO e LOA no município de Cidade Nova",
  example: {
    context:
      "A prefeitura de Cidade Nova precisa alinhar a LOA de 2024 às metas fiscais fixadas na LDO. O orçamento anterior estava desatualizado.",
    challenge:
      "Ajustar a dotação da Secretaria de Saúde sem romper o limite de despesa com pessoal previsto na LRF. O prazo termina em dezembro.",
    solution:
      "A equipe remanejou recursos via crédito suplementar, com autorização legislativa prévia, mantendo a despesa com pessoal em 47% da RCL.",
    result:
      "A LOA foi executada dentro dos limites legais e o Tribunal de Contas não apontou ressalvas no exercício.",
  },
};

const DOCUMENTO = {
  lessons: [
    { lesson_number: 1, objective: "Compreender o ciclo orçamentário.", blocks: [] },
    { lesson_number: 2, objective: "Aplicar LDO e LOA.", blocks: [EXEMPLO] },
  ],
};

const BLUEPRINT = {
  module_number: 1,
  title: "Fundamentos e Planejamento: PPA, LDO e LOA no Município",
  module_objective: "Dominar o planejamento orçamentário municipal",
  produces_artifact: "Esquema conceitual do ciclo orçamentário municipal",
};

function derivar(doc: unknown = DOCUMENTO) {
  const r = buildActivityFromModule(doc as never, BLUEPRINT as never);
  if (!r) throw new Error("nada derivado");
  return r.block.activity;
}

describe("a atividade derivada do exemplo trabalhado", () => {
  const a = derivar();
  const orientacoes = a.template_rows.map((r: { instruction: string }) => r.instruction);
  const tudo = [a.objective, ...orientacoes, ...a.steps, ...a.success_criteria].join(" ");

  it("cita o exemplo do módulo, não um exemplo qualquer", () => {
    expect(a.objective).toContain("Aplicação da LDO e LOA no município de Cidade Nova");
  });

  it("as siglas do título sobrevivem", () => {
    // O `.toLowerCase()` antigo transformava "LDO e LOA" em "ldo e loa".
    expect(a.objective).toContain("LDO");
    expect(a.objective).toContain("LOA");
    expect(a.objective).not.toContain("ldo");
  });

  it("cada campo ancora a pergunta no momento correspondente do exemplo", () => {
    expect(orientacoes[0]).toContain("LOA de 2024");
    expect(orientacoes[1]).toContain("Secretaria de Saúde");
    expect(orientacoes[2]).toContain("crédito suplementar");
    expect(orientacoes[3]).toContain("limites legais");
  });

  it("a PERGUNTA vem antes da citação — o corte da célula não pode comê-la", () => {
    for (const o of orientacoes) {
      const corte = o.indexOf("No exemplo:");
      expect(corte).toBeGreaterThan(10);
      expect(o.slice(0, corte).trim()).toMatch(/[?.]$/);
    }
  });

  it("os passos apontam para o caso concreto", () => {
    expect(a.steps[0]).toContain("Aplicação da LDO e LOA");
    expect(a.steps[1]).toContain("Secretaria de Saúde");
    expect(a.steps[2]).toContain("crédito suplementar");
    expect(a.steps[3]).toContain("PPA, LDO e LOA");
  });

  it("nada disso caberia em outro curso qualquer", () => {
    // O teste que o molde antigo reprovava: o texto tem de falar do assunto.
    expect(tudo).toMatch(/LOA|LDO|RCL|Cidade Nova/);
  });

  it("o entregável do módulo continua sendo o entregável", () => {
    expect(a.deliverable).toBe("Esquema conceitual do ciclo orçamentário municipal");
  });

  it("as orientações cabem numa célula de tabela", () => {
    for (const o of orientacoes) expect(o.length).toBeLessThan(240);
  });
});

describe("quando o exemplo é pobre", () => {
  it("sem contexto e sem resultado, o campo fica só com a pergunta", () => {
    const magro = JSON.parse(JSON.stringify(DOCUMENTO));
    magro.lessons[1].blocks[0].example.context = "";
    magro.lessons[1].blocks[0].example.result = "";
    const a = derivar(magro);
    const o = a.template_rows.map((r: { instruction: string }) => r.instruction);
    expect(o[0]).toBe("Descreva a situação equivalente na sua realidade.");
    expect(o[3]).toBe("O que mudaria se a sua solução funcionasse?");
    // Os que TÊM material continuam ancorados.
    expect(o[1]).toContain("No exemplo:");
  });

  it("sem título, o texto não fica com aspas vazias", () => {
    const semTitulo = JSON.parse(JSON.stringify(DOCUMENTO));
    semTitulo.lessons[1].blocks[0].heading = "";
    const a = derivar(semTitulo);
    expect(a.objective).toContain("o exemplo trabalhado do módulo");
    expect(a.objective).not.toContain('""');
  });

  it("frase muito longa é cortada com reticências, não pela metade de uma palavra", () => {
    const longo = JSON.parse(JSON.stringify(DOCUMENTO));
    longo.lessons[1].blocks[0].example.challenge = Array(60).fill("palavra").join(" ") + ".";
    const a = derivar(longo);
    const o = a.template_rows[1].instruction;
    expect(o).toContain("…");
    expect(o.length).toBeLessThan(240);
  });
});

describe("os outros dois caminhos continuam funcionando", () => {
  it("bloco `process` tem prioridade sobre o exemplo", () => {
    const comProcesso = JSON.parse(JSON.stringify(DOCUMENTO));
    comProcesso.lessons[0].blocks = [{
      id: "p1",
      type: "process",
      heading: "Passos da Elaboração do PPA",
      steps: [
        { title: "Diagnóstico", description: "Levantar demandas do município." },
        { title: "Programas", description: "Definir programas e metas." },
        { title: "Aprovação", description: "Enviar à Câmara Municipal." },
      ],
    }];
    const a = derivar(comProcesso);
    expect(a.objective).toContain("Passos da Elaboração do PPA");
    expect(a.template_rows).toHaveLength(3);
    expect(a.template_rows[0].field).toBe("Diagnóstico");
  });

  it("sem exemplo e sem processo, cai nos objetivos das lições", () => {
    const so = { lessons: DOCUMENTO.lessons.map((l) => ({ ...l, blocks: [] })) };
    const a = derivar(so);
    expect(a.template_rows[0].instruction).toContain("ciclo orçamentário");
  });
});
