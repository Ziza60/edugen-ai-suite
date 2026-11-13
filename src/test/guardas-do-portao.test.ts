import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { GUARDAS, aplicarGuardas, semGuarda } from "../../supabase/functions/_shared/guardas-do-caso";
import {
  casoPorDominancia, grandezasDoTexto, identificarCaso, paragrafosDe,
} from "../../supabase/functions/_shared/valores-do-caso";
import { inspectCourse } from "../../supabase/functions/_shared/quality-gate";

// ═══════════════════════════════════════════════════════════════════════════
// AS GUARDAS DO PORTÃO, TRAVADAS CONTRA A BANCADA
//
// A leitura dos 29 achados de coerência (12/11/2026) deu 9 contradições
// verdadeiras, 26 falsos positivos e 1 artefato de gêmeo nos 13 cursos —
// precisão de 25%. As guardas existem para derrubar os falsos SEM tocar nas
// verdadeiras, e este arquivo é o que impede que isso se inverta em silêncio.
//
// MEDIDO com as guardas ligadas: 36 achados → 26, as 9 verdadeiras intactas.
// Precisão 25% → 35%.
//
// Ver EXPERIMENTO-DOSSIE.md para a tabela achado-a-achado.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = resolve(process.cwd(), "src/test/cursos-reais");

function modulosDe(arq: string) {
  const linhas = readFileSync(resolve(DIR, arq), "utf8").split("\n");
  const ini: number[] = [];
  linhas.forEach((l, i) => { if (l.startsWith("# ")) ini.push(i); });
  return ini.map((a, k) => ({
    numero: k + 1,
    titulo: linhas[a].slice(2).trim(),
    texto: linhas.slice(a + 1, k + 1 < ini.length ? ini[k + 1] : linhas.length).join("\n"),
  }));
}

function laudo(arq: string) {
  const mods = modulosDe(arq);
  return inspectCourse({
    course_title: arq,
    modules: mods.map((m, i) => ({
      module_number: m.numero, title: m.titulo, markdown: m.texto,
      is_capstone: i === mods.length - 1,
    })),
  });
}

const achados = (arq: string) =>
  laudo(arq).checks.filter((c) => !c.passed && c.id.startsWith("coerencia"))
    .flatMap((c) => c.evidence);

function grandezas(arq: string) {
  const mods = modulosDe(arq);
  const ps = mods.map((m) => ({ paragrafos: paragrafosDe(m.texto) }));
  let caso = identificarCaso(ps as any);
  if (!caso.nomes.length) caso = casoPorDominancia(ps as any);
  if (!caso.nomes.length) return [];
  return mods.flatMap((m) => grandezasDoTexto(m.texto, caso));
}

// ── As verdadeiras continuam sendo achadas ──────────────────────────────────

describe("nenhuma guarda apaga contradição verdadeira", () => {
  it("Pão Quente: o Custo de Pedido sobrevive, inclusive o valor DERIVADO", () => {
    // "Custo de Pedido por Ordem = R$ 610,00 / 4 = R$ 152,50" é derivado, e é a
    // melhor evidência do acervo. Foi por isto que a guarda de "valor derivado"
    // foi testada e REJEITADA — ela apagaria exatamente este achado.
    const e = achados("estoques-pao-quente.md").join(" | ");
    expect(e).toMatch(/custo de pedido/i);
    expect(e).toMatch(/R\$ ?610/);
  });

  it("Doceria: o CTU do brigadeiro sobrevive — o componente promovido a total", () => {
    // m2 calcula R$ 6,075; m3 diz "com base nos cálculos do módulo anterior, o
    // CTU de cada brigadeiro é de R$ 1,50" — e R$ 1,50 é o leite condensado.
    const e = achados("preco-doceria-sabor-de-infancia.md").join(" | ");
    expect(e).toMatch(/custo total unit/i);
    expect(e).toContain("R$ 6,07");
    expect(e).toContain("R$ 1,50");
  });

  it("Finanças: as três contradições do app sobrevivem", () => {
    const e = achados("preco-financas-inteligentes.md").join(" | ");
    expect(e).toContain("R$19,90");   // preço de venda ≠ R$ 111,33
    expect(e).toContain("R$5,00");    // custo variável ≠ R$2,50
    expect(e).toContain("R$25.000");  // custos fixos: 25.000 ≠ 28.000 (e 50.000 no m3)
  });

  it("clínica-1: os dois 'último DRE' do mesmo módulo sobrevivem", () => {
    const e = achados("financas-clinica-sorriso-perfeito.md").join(" | ");
    expect(e).toContain("R$ 144.000,00");
    expect(e).toContain("R$ 200.000,00");
  });
});

// ── Os falsos positivos que as guardas derrubaram ───────────────────────────

describe("as guardas derrubam os falsos positivos medidos", () => {
  it("Padaria do Bairro: a faixa 'normalmente 3 dias… atraso até 5 dias' sai", () => {
    expect(achados("estoques-padaria-delicias-do-bairro.md").join(" | "))
      .not.toMatch(/ressuprimento/i);
  });

  it("Sabor da Vovó: nível de serviço de alternativa de quiz sai", () => {
    expect(achados("estoques-sabor-da-vovo.md").join(" | "))
      .not.toMatch(/n[íi]vel de servi/i);
  });

  it("clínica-1: o 'valores hipotéticos para fins deste exemplo' sai", () => {
    expect(achados("financas-clinica-sorriso-perfeito.md").join(" | "))
      .not.toMatch(/ativo circulante/i);
  });

  it("clínica-1: o orçamento do PRÓXIMO ANO não contradiz o DRE atual", () => {
    expect(achados("financas-clinica-sorriso-perfeito.md").join(" | "))
      .not.toMatch(/receita bruta/i);
  });

  it("Doceria: o '(ex: R$ 3.200,00)' de template sai", () => {
    expect(achados("preco-doceria-sabor-de-infancia.md").join(" | "))
      .not.toMatch(/despesas fixas/i);
  });

  it("o curso limpo continua limpo", () => {
    expect(achados("transformacao-digital.md")).toHaveLength(0);
  });
});

// ── O PARALELO QUE O PONTO 2 PEDIU: pareamento texto → entrada ──────────────
//
// As duas sub-classes novas achadas na leitura. Não são "rótulo ruim": são o
// extrator prendendo o rótulo ao número ERRADO da frase. Se o pareamento erra,
// qualquer comparação — par ou gabarito — acusa contradição onde não há, e um
// gabarito de objeto+valor erraria com mais autoridade, porque afirmaria que o
// número divergiu da ficha.

describe("pareamento texto → entrada: o número tem de ser o do rótulo", () => {
  const ORACAO_DOCERIA =
    "**Custo Variável Unitário Total:** R$ 4,30 (Diretos) + R$ 0,41 (Impostos - 4,5% de R$ 9,00) + R$ 0,18 (Taxa Cartão - 2% de R$ 9,00) = R$ 4,89.";

  it("'Custo Variável' não recebe o R$ 9,00, que é o PREÇO vizinho", () => {
    const guarda = GUARDAS.find((g) => g.nome === "operando-de-soma")!;
    expect(guarda.exclui(ORACAO_DOCERIA, "R$ 9,00")).toBe(true);
    // e o total, que é o valor do rótulo, continua comparável
    expect(guarda.exclui(ORACAO_DOCERIA, "R$ 4,89")).toBe(false);
  });

  it("'Taxa Cartão' não recebe o operando: a taxa é R$ 0,30, não R$ 15,00", () => {
    const oracao = "Taxa de cartão = R$ 15,00 * 0,02 = R$ 0,30";
    // Aqui não há `+` na esquerda, então a guarda de soma não age: este caso
    // depende do objeto, e fica registrado como o que o gabarito tem de pegar.
    const guarda = GUARDAS.find((g) => g.nome === "operando-de-soma")!;
    expect(guarda.exclui(oracao, "R$ 15,00")).toBe(false);
  });

  it("na Doceria, o R$ 9,00 não aparece mais rotulado como Custo Variável", () => {
    const e = achados("preco-doceria-sabor-de-infancia.md").join(" | ");
    expect(e).not.toMatch(/custo vari[áa]vel/i);
    expect(e).not.toMatch(/taxa cart/i);
  });
});

// ── As guardas, uma a uma ───────────────────────────────────────────────────

describe("cada guarda, no caso que a justifica", () => {
  const g = (nome: string) => GUARDAS.find((x) => x.nome === nome)!;

  it("valor-de-exemplo", () => {
    expect(g("valor-de-exemplo").exclui(
      "| Saldo Inicial | Determine um saldo inicial fictício para o primeiro mês (ex: R$ 10.000). |",
      "R$ 10.000",
    )).toBe(true);
    // não exclui valor em parêntese que NÃO é exemplo
    expect(g("valor-de-exemplo").exclui(
      "Custos fixos (aluguel R$ 5.000,00) somam o total",
      "R$ 5.000,00",
    )).toBe(false);
  });

  it("alternativa-de-quiz", () => {
    expect(g("alternativa-de-quiz").exclui(
      "- [ ] C. Aumentar o Nível de Serviço para 95%, o que aumentaria o Estoque",
      "95%",
    )).toBe(true);
  });

  it("declarado-hipotetico", () => {
    expect(g("declarado-hipotetico").exclui(
      "valores hipotéticos para fins deste exemplo: Ativo Circulante de R$ 90.000,00",
      "R$ 90.000,00",
    )).toBe(true);
  });

  it("faixa-declarada", () => {
    expect(g("faixa-declarada").exclui(
      "O tempo de ressuprimento é normalmente de 3 dias, mas já houve casos de atraso, estendendo-se para 5 dias.",
      "5 dias",
    )).toBe(true);
    expect(g("faixa-declarada").exclui(
      "O Lead Time médio dos fornecedores da TechInov é de 7 a 20 dias.",
      "20 dias",
    )).toBe(true);
  });

  it("condicional-hipotetica", () => {
    expect(g("condicional-hipotetica").exclui(
      "Se o Lead Time for de 20 dias, e sua previsão for para o próximo mês, antecipe o pedido.",
      "20 dias",
    )).toBe(true);
  });

  it("peso-de-rubrica", () => {
    expect(g("peso-de-rubrica").exclui(
      "| Análise de Viabilidade de Investimentos | 15% | Realiza uma análise completa, utilizando Payback e ROI |",
      "15%",
    )).toBe(true);
  });

  it("periodo-projetado", () => {
    expect(g("periodo-projetado").exclui(
      "O Orçamento de Vendas estima uma receita bruta total de R$ 350.000 para o próximo ano.",
      "R$ 350.000",
    )).toBe(true);
    // MEDIDO: a versão larga aceitava "estimar" solto e disparou 91 vezes,
    // 43 só no curso com ficha. Marcador de período tem de ser explícito.
    expect(g("periodo-projetado").exclui(
      "Utilize o faturamento médio mensal para estimar a capacidade de pagamento: R$ 60.000,00.",
      "R$ 60.000,00",
    )).toBe(false);
  });

  it("identificador: número nu com etiqueta sai, dinheiro não", () => {
    expect(g("identificador").exclui("Compra 2 x R$ 4,50 por unidade", "2")).toBe(true);
    expect(g("identificador").exclui("Compra 2 x R$ 4,50 por unidade", "R$ 4,50")).toBe(false);
  });
});

// ── O placar, travado ───────────────────────────────────────────────────────

describe("o placar da bancada não piora em silêncio", () => {
  it("as guardas excluem entre 10% e 20% das grandezas, não mais", () => {
    // Guarda que exclui demais deixa de ser guarda e passa a ser cegueira.
    // MEDIDO em 13/11/2026: 1519 grandezas, 215 excluídas = 14%.
    const arqs = readdirSync(DIR).filter((f) => f.endsWith(".md") && !/^README|^EXPERIMENTO/.test(f));
    let total = 0, passam = 0;
    for (const arq of arqs) {
      const gs = grandezas(arq);
      total += gs.length;
      passam += semGuarda(gs).length;
    }
    const fracao = (total - passam) / total;
    expect(total).toBeGreaterThan(1000);
    expect(fracao).toBeGreaterThan(0.08);
    expect(fracao).toBeLessThan(0.20);
  }, 60000);

  it("o total de achados de coerência na bancada fica em 26", () => {
    // Trava o placar medido. Se cair, uma verdadeira pode ter sumido; se subir,
    // uma guarda deixou de agir. Nos dois casos a pergunta é qual achado mudou,
    // e a resposta vai no EXPERIMENTO-DOSSIE.md antes de o número aqui mudar.
    const arqs = readdirSync(DIR).filter((f) => f.endsWith(".md") && !/^README|^EXPERIMENTO/.test(f));
    const total = arqs.reduce((n, f) => n + achados(f).length, 0);
    expect(total).toBe(26);
  }, 60000);

  it("toda guarda tem nome e a medição que a justifica", () => {
    for (const guarda of GUARDAS) {
      expect(guarda.nome, "guarda sem nome").toBeTruthy();
      expect(guarda.origem.length, `guarda ${guarda.nome} sem origem medida`)
        .toBeGreaterThan(40);
    }
  });

  it("aplicarGuardas devolve TODAS as grandezas, marcadas", () => {
    // Uma guarda silenciosa é a próxima régua que não olha o que mede.
    const gs = grandezas("preco-doceria-sabor-de-infancia.md");
    const marc = aplicarGuardas(gs);
    expect(marc).toHaveLength(gs.length);
    expect(marc.filter((o) => o.guarda).length).toBeGreaterThan(0);
  });
});
