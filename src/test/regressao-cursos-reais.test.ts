import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectCourse } from "../../supabase/functions/_shared/quality-gate";
import { valoresDoCasoCondutor } from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// O PORTÃO, MEDIDO CONTRA CINCO CURSOS REAIS
//
// Os testes de fixture sintética travam o mecanismo; estes travam o RESULTADO.
// A diferença apareceu várias vezes: uma regra passava em toda fixture escrita
// à mão e, no texto real, ou não achava nada ou acusava o que era legítimo.
//
// Cada asserção aqui carrega o motivo e o trecho do curso que a sustenta. Se
// uma delas quebrar, a pergunta certa não é "como faço passar" — é se o curso
// mudou de julgamento, e aí a citação nova entra junto.
//
// Ver `cursos-reais/README.md` para o que é cada arquivo.
// ═══════════════════════════════════════════════════════════════════════════

function laudo(arquivo: string) {
  // Caminho a partir da raiz do projeto, e não de `import.meta.url`: o ambiente
  // de teste é jsdom, e ali a URL do módulo vem sem a raiz — o `readFileSync`
  // acabava procurando em `/src/test/...`.
  const caminho = resolve(process.cwd(), "src/test/cursos-reais", arquivo);
  const linhas = readFileSync(caminho, "utf8").split("\n");
  const inicios: number[] = [];
  linhas.forEach((l, i) => { if (l.startsWith("# ")) inicios.push(i); });
  const modules = inicios.map((a, k) => ({
    module_number: k + 1,
    title: linhas[a].slice(2).trim(),
    markdown: linhas.slice(a + 1, k + 1 < inicios.length ? inicios[k + 1] : linhas.length)
      .join("\n"),
    is_capstone: k === inicios.length - 1,
  }));
  return inspectCourse({ course_title: arquivo, modules });
}

const evidencias = (r: ReturnType<typeof laudo>, prefixo = "coerencia") =>
  r.checks.filter((c) => !c.passed && c.id.startsWith(prefixo))
    .flatMap((c) => c.evidence).join(" | ");

// ── A linha que não se cruza ────────────────────────────────────────────────
//
// Bloqueador rebaixa o curso a `needs_review`. Foi por medir aqui que o
// cruzamento de valores deixou de bloquear: dois achados verdadeiros e um falso
// não sustentam uma regra que reprova.

describe("nenhum curso real é bloqueado pelo cruzamento de valores", () => {
  for (const arquivo of [
    "estoques-delicias-da-vovo.md",
    "estoques-pao-quente.md",
    "estoques-sabor-da-vovo.md",
    "preco-financas-inteligentes.md",
    "transformacao-digital.md",
  ]) {
    it(arquivo, () => {
      const bloqueadores = laudo(arquivo).checks
        .filter((c) => !c.passed && c.severity === "blocker" && c.id.startsWith("coerencia"));
      expect(bloqueadores.map((c) => c.evidence).flat()).toEqual([]);
    });
  }
});

// ── O curso limpo ──────────────────────────────────────────────────────────

describe("o curso sem caso numérico não é acusado de nada", () => {
  it("transformação digital sai sem achado de coerência", () => {
    // Sem este teste, toda medição seria feita só contra cursos problemáticos.
    expect(evidencias(laudo("transformacao-digital.md"))).toBe("");
  });
});

// ── As contradições verdadeiras ────────────────────────────────────────────

describe("as contradições que o portão TEM de continuar achando", () => {
  it("preço: o custo variável do app muda entre o módulo 1 e o 5", () => {
    // M1: "custos variáveis unitários de R$5,00 por usuário"
    // M5: "O custo variável por usuário (hospedagem, licenças) é de R$2,50/mês"
    // Mesma empresa, mesmo app, mesma unidade, sem explicação no texto.
    const e = evidencias(laudo("preco-financas-inteligentes.md"));
    expect(e).toMatch(/custos variáveis/i);
    expect(e).toContain("R$5,00");
    expect(e).toContain("R$2,50");
  });

  it("preço: o preço do mesmo plano muda entre o módulo 1 e o 3", () => {
    // M1: "preço de venda mensal de R$19,90"
    // M3: "Preço = R$ 83,50 / 0,75 = R$ 111,33"
    const e = evidencias(laudo("preco-financas-inteligentes.md"));
    expect(e).toMatch(/preço de venda/i);
    expect(e).toContain("R$19,90");
    expect(e).toContain("R$ 111,33");
  });

  it("Pão Quente: o Custo de Pedido calculado no módulo 2 não é o usado no 4", () => {
    // M2 calcula "Custo de Pedido por Ordem = R$ 610,00 / 4 = R$ 152,50" e
    // afirma, na mesma lição: "O Custo de Pedido é FIXO POR TRANSAÇÃO".
    // M4 usa R$ 75 (farinha) e R$ 50 (ovos) para a mesma padaria.
    const e = evidencias(laudo("estoques-pao-quente.md"));
    expect(e).toMatch(/custo de pedido/i);
    expect(e).toMatch(/R\$ ?(610|152|75|50)/);
  });
});

// ── As diferenças legítimas ────────────────────────────────────────────────

describe("as diferenças legítimas não podem virar bloqueador", () => {
  it("Delícias: custo de pedido do açúcar ≠ da farinha, e isso é normal", () => {
    // M4: "Custo de Pedido (S): R$ 80,00 por pedido (inclui frete fixo do
    // fornecedor e tempo administrativo)" — açúcar cristal.
    // M7/M8: R$ 50,00 para farinha e leite condensado, outros fornecedores.
    // O achado NÃO some — ele deixa de reprovar. Aparece no laudo, com a
    // evidência, e quem escreveu o curso decide.
    const r = laudo("estoques-delicias-da-vovo.md");
    expect(evidencias(r)).toMatch(/custo de pedido/i);
    for (const c of r.checks.filter((c) => !c.passed && c.id.startsWith("coerencia"))) {
      expect(c.severity, c.id).toBe("warning");
    }
  });

  it("Sabor: Lead Time de ovos ≠ de chocolate belga, e isso é normal", () => {
    // M6: "Lead Time Atual (Estimativa): 4 dias" — ovos frescos.
    // M8: "O Lead Time do fornecedor é de 15 dias" — chocolate belga.
    // Numa padaria com vários fornecedores, prazo por item é o esperado.
    const r = laudo("estoques-sabor-da-vovo.md");
    const achado = r.checks.find((c) => c.id === "coerencia.valores_entre_modulos")!;
    // Ele é encontrado — três Lead Times diferentes existem mesmo no texto —,
    // mas como AVISO. Foi este curso que fez o cruzamento deixar de bloquear.
    expect(achado.severity).toBe("warning");
    expect(achado.evidence.join(" ")).toMatch(/lead time/i);
  });
});

// ── A âncora ───────────────────────────────────────────────────────────────

describe("a âncora não confunde jargão com caso", () => {
  it("nenhum achado é atribuído a um conceito da disciplina", () => {
    // O curso de estoque escreve 'Lead Time' e 'Ponto de Pedido' entre aspas, e
    // a âncora chegou a devolver oito "casos", seis deles conceitos. Os dados
    // do módulo 4 iam para o caso "Ponto de Pedido" e os do 8 para "Lead Time":
    // nunca caíam no mesmo grupo, nunca eram comparados.
    const jargao = /^(Lead Time|Ponto de Pedido|Estoque de Segurança|Gestão de Fornecedores|Tempo de Ressuprimento|Produtos Acabados) —/;
    for (const arquivo of [
      "estoques-delicias-da-vovo.md",
      "estoques-pao-quente.md",
      "estoques-sabor-da-vovo.md",
    ]) {
      const linhas = evidencias(laudo(arquivo)).split(" | ").filter(Boolean);
      for (const linha of linhas) {
        expect(linha, `${arquivo}: ${linha}`).not.toMatch(jargao);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A PONTE DE VALORES, MEDIDA NOS DOIS PRIMEIROS MÓDULOS
//
// A ponte lê o que os módulos anteriores já publicaram e injeta no prompt do
// seguinte. Ela é a única PREVENÇÃO contra o curso se contradizer — todo o
// resto é detecção. E ela carregava um valor em cinco cursos.
//
// Os dois filtros se destruíam mutuamente: o curso enuncia o número na
// "Solução" e o repete no "Resultado", mas o parágrafo do "Resultado" quase
// nunca repete o nome da empresa. A segunda menção saía como herdada, e a
// repetição que o outro filtro exige nunca acontecia.
// ═══════════════════════════════════════════════════════════════════════════
describe("a ponte carrega os números que depois se contradizem", () => {
  const doisPrimeiros = (arquivo: string) => {
    const linhas = readFileSync(
      resolve(process.cwd(), "src/test/cursos-reais", arquivo), "utf8",
    ).split("\n");
    const ini: number[] = [];
    linhas.forEach((l, i) => { if (l.startsWith("# ")) ini.push(i); });
    return [0, 1].map((k) => ({
      texto: linhas.slice(ini[k] + 1, ini[k + 1] ?? linhas.length).join("\n"),
      modulo: k + 1,
    }));
  };

  it("preço: leva o preço de venda e o custo variável do módulo 1", () => {
    // São exatamente os dois que depois se contradizem — R$19,90 vira R$111,33
    // no módulo 3, e R$5,00 vira R$2,50 no módulo 5. Antes, a ponte levava
    // apenas o custo variável; o preço de venda se perdia.
    const v = valoresDoCasoCondutor(doisPrimeiros("preco-financas-inteligentes.md"));
    const texto = v.map((x) => `${x.termo}=${x.valor}`).join(" | ");
    expect(texto).toContain("R$19,90");
    expect(texto).toContain("R$5,00");
  });

  it("estoques: leva a margem de lucro, que antes não saía", () => {
    for (const arquivo of ["estoques-delicias-da-vovo.md", "estoques-pao-quente.md"]) {
      const v = valoresDoCasoCondutor(doisPrimeiros(arquivo));
      expect(v.map((x) => x.termo).join(" | "), arquivo).toMatch(/margem de lucro/i);
    }
  });

  it("o curso sem caso numérico não injeta nada", () => {
    expect(valoresDoCasoCondutor(doisPrimeiros("transformacao-digital.md"))).toEqual([]);
  });

  it("frase copiada duas vezes não conta como repetição", () => {
    // O curso 'Sabor da Vovó' repete o enunciado de uma atividade palavra por
    // palavra. Contando MENÇÕES, isso valia por corroboração e injetava dois
    // fragmentos de oração: "exigirá um aumento = R$ 100,00" e
    // "obsolescência para esses = 0,8%". Contando ORAÇÕES DISTINTAS, saem.
    const termos = valoresDoCasoCondutor(doisPrimeiros("estoques-sabor-da-vovo.md"))
      .map((x) => x.termo).join(" | ");
    expect(termos).not.toMatch(/exigirá um aumento/i);
    expect(termos).not.toMatch(/obsolescência para esses/i);
  });
});
