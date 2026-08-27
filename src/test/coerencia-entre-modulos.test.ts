import { describe, expect, it } from "vitest";
import { inspectCourse } from "../../supabase/functions/_shared/quality-gate";

// ═══════════════════════════════════════════════════════════════════════════
// O SUCO COM QUATRO CUSTOS
//
// Curso "Estratégias para Definir o Preço de Venda", gerado em 24/08. O mesmo
// suco Detox Verde, da mesma empresa, no mesmo lançamento:
//
//   módulo 1, p.10 — custo variável R$ 7,20;  custos fixos R$ 25.000/mês
//   módulo 2, p.22 — custo variável R$ 12,75
//   módulo 2, p.31 — custo variável R$ 8,00;  custos fixos R$ 15.000/mês
//
// O portão aprovou: veredito `ready`, escore 100, zero bloqueadores. Nenhuma
// verificação olhava dois módulos ao mesmo tempo.
//
// Os trechos abaixo são recortes literais do PDF entregue.
// ═══════════════════════════════════════════════════════════════════════════

const M1_REAL = `
### 1.3 Apuração de Custos

Contexto: A 'Delícias Saudáveis' está lançando uma nova linha de sucos
prensados a frio. Para o suco Detox Verde, a estimativa é produzir 5.000
garrafas de 300ml por mês.

Solução: Primeiro, identificamos os custos fixos e variáveis. Os custos fixos
mensais são o aluguel, depreciação e salários fixos, totalizando R$ 25.000.
Para os custos variáveis unitários do suco Detox Verde, somamos: ingredientes
(R$ 5,00) + embalagem (R$ 1,50) + mão de obra direta (R$ 0,50) + energia
elétrica (R$ 0,20). O custo variável total por garrafa será R$ 7,20.

Resultado: O custo variável por garrafa do suco Detox Verde é de R$ 7,20.
`;

const M2_REAL = `
### 2.1 Margem de Contribuição

Contexto: O 'Detox Verde', um dos sabores iniciais da 'Delícias Saudáveis',
possui ingredientes importados.

Solução: 1. Preço de Venda Unitário: o preço de venda sugerido para o Suco
Detox Verde é de R$25,00 por garrafa de 300ml. 2. Custos Variáveis Unitários:
Matéria-prima: R$8,00; Embalagem: R$1,50; Mão de obra direta variável: R$2,00;
Comissões: R$1,25. Total de Custos Variáveis Unitários: R$8,00 + R$1,50 +
R$2,00 + R$1,25 = R$12,75.

### 2.3 Ponto de Equilíbrio

Contexto: Para o suco 'Detox Verde' (300ml), os custos variáveis unitários são
R$ 8,00. Os custos fixos mensais atribuídos à linha de sucos totalizam
R$ 15.000,00.
`;

/** Um curso coerente: os mesmos números atravessam os módulos. */
const M1_LIMPO = `
### 1.1 Custos

Contexto: A 'Delícias Saudáveis' lança o suco 'Detox Verde'. Os custos fixos
mensais são de R$ 25.000. O custo variável por garrafa do 'Detox Verde' é de
R$ 7,20.
`;

const M2_LIMPO = `
### 2.1 Margem

Para o suco 'Detox Verde' da 'Delícias Saudáveis', o custo variável unitário é
de R$ 7,20 e o preço de venda é R$ 25,00. Os custos fixos mensais permanecem em
R$ 25.000.

### 2.2 Equilíbrio

O 'Detox Verde' da 'Delícias Saudáveis' mantém custo variável de R$ 7,20.
`;

function curso(...markdowns: string[]) {
  return {
    course_title: "Estratégias para Definir o Preço de Venda",
    modules: markdowns.map((markdown, i) => ({
      module_number: i + 1,
      title: `Módulo ${i + 1}`,
      markdown,
    })),
  };
}

function coerencia(...markdowns: string[]) {
  const r = inspectCourse(curso(...markdowns));
  const c = r.checks.find((c) => c.id === "coerencia.valores_entre_modulos");
  expect(c, "a verificação precisa estar registrada em inspectCourse").toBeTruthy();
  return c!;
}

describe("coerência numérica entre módulos", () => {
  it("acusa o custo variável que muda de valor entre os módulos", () => {
    const c = coerencia(M1_REAL, M2_REAL);
    expect(c.passed).toBe(false);
    expect(c.severity).toBe("blocker");
    const custo = c.evidence.find((e) => /custos? vari[áa]ve/i.test(e));
    expect(custo, `evidências: ${JSON.stringify(c.evidence)}`).toBeTruthy();
    expect(custo).toContain("R$ 7,20");
    expect(custo).toContain("R$12,75");
  });

  it("acusa os custos fixos que mudam de valor entre os módulos", () => {
    const c = coerencia(M1_REAL, M2_REAL);
    const fixo = c.evidence.find((e) => /custos? fixos?/i.test(e));
    expect(fixo, `evidências: ${JSON.stringify(c.evidence)}`).toBeTruthy();
    expect(fixo).toContain("R$ 25.000");
    expect(fixo).toContain("R$ 15.000,00");
  });

  it("a evidência nomeia o rótulo como o texto escreveu, não a chave interna", () => {
    // "custos fixos", e não "custo fixo": quem lê o laudo procura a frase no
    // PDF, e a chave normalizada não existe em lugar nenhum do curso.
    const c = coerencia(M1_REAL, M2_REAL);
    expect(c.evidence.join(" ")).toMatch(/Detox Verde — custos fixos/);
  });

  it("a evidência diz em que módulo cada valor foi impresso", () => {
    const c = coerencia(M1_REAL, M2_REAL);
    expect(c.evidence.join(" ")).toMatch(/m[óo]dulo 1/i);
    expect(c.evidence.join(" ")).toMatch(/m[óo]dulo 2/i);
  });

  it("a divergência vira bloqueador no veredito do curso", () => {
    const r = inspectCourse(curso(M1_REAL, M2_REAL));
    expect(r.blockers).toBeGreaterThan(0);
    expect(r.verdict).toBe("needs_review");
  });

  it("curso coerente passa — o mesmo número em todos os módulos", () => {
    const c = coerencia(M1_LIMPO, M2_LIMPO);
    expect(c.passed, `evidências: ${JSON.stringify(c.evidence)}`).toBe(true);
  });

  it("o nome do caso vem das aspas, não das maiúsculas", () => {
    // "Custo Variável" e "Margem de Contribuição" aparecem em maiúsculas o
    // tempo todo, como conceitos. Se virassem âncora do caso, o portão
    // agruparia grandezas de produtos diferentes sob o mesmo nome.
    const conceitos = `
### 1.1 Conceitos

O Custo Variável e a Margem de Contribuição são a base. O Custo Variável de um
produto é de R$ 4,00. A Margem de Contribuição é de R$ 6,00.
`;
    const outros = `
### 2.1 Outro produto

O Custo Variável de outro produto é de R$ 9,00. A Margem de Contribuição é de
R$ 1,00.
`;
    expect(coerencia(conceitos, outros).passed).toBe(true);
  });

  it("grandezas de ordens distantes não são confundidas", () => {
    // "custos fixos mensais" (R$ 25.000) e "custos fixos rateados por unidade"
    // (R$ 3,50) começam com as mesmas duas palavras e são coisas diferentes.
    const a = `
### 1.1 Custos

O suco 'Detox Verde' da 'Delícias Saudáveis' tem custos fixos mensais de
R$ 25.000. O 'Detox Verde' é o carro-chefe da 'Delícias Saudáveis'.
`;
    const b = `
### 2.1 Markup

Para o 'Detox Verde' da 'Delícias Saudáveis', os custos fixos rateados por
unidade são de R$ 3,50. O 'Detox Verde' segue com bom giro.
`;
    expect(coerencia(a, b).passed).toBe(true);
  });

  it("dois valores dentro do mesmo módulo não bloqueiam", () => {
    // Comparar cenários dentro de uma lição é legítimo. Medido em cursos
    // reais, a variante intra-módulo deu 3 falsos alarmes em 4 achados.
    const um = `
### 1.1 Cenários

O suco 'Detox Verde' da 'Delícias Saudáveis' com preço de venda de R$ 20,00
vende mais. Com preço de venda de R$ 25,00, o 'Detox Verde' vende menos. O
'Detox Verde' segue em teste.
`;
    const dois = `
### 2.1 Sequência

O 'Detox Verde' da 'Delícias Saudáveis' continua em análise de mercado. A
'Delícias Saudáveis' avalia o 'Detox Verde' com atenção.
`;
    expect(coerencia(um, dois).passed).toBe(true);
  });

  it("curso de módulo único não tem o que cruzar", () => {
    const c = coerencia(M1_REAL);
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/único/i);
  });

  it("curso sem caso condutor recorrente passa sem ruído", () => {
    const c = coerencia("### 1.1 Teoria\n\nConceitos gerais.", "### 2.1 Mais\n\nOutros conceitos.");
    expect(c.passed).toBe(true);
  });

  it("markdown vazio não quebra o portão", () => {
    expect(() => inspectCourse(curso("", ""))).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUANDO O CASO NÃO ESTÁ ENTRE ASPAS
//
// A regra das aspas veio de cinco cursos em que o texto apresentava o caso
// assim: 'Detox Verde', 'Armazém da Esquina'. O sexto curso — "Transformação
// Digital e Inovação nas Empresas", 8 módulos — inverteu tudo: entre aspas
// estão os CONCEITOS ('última milha' 30 vezes, "Gestão da Mudança", 'Cultura
// Digital'), enquanto o caso condutor, Logística Eficiente S.A., aparece em 284
// linhas e nunca entre aspas.
//
// Frequência sozinha não resolve: no curso de estoque os nomes mais frequentes
// são todos conceitos (Curva ABC 49, Custo Total 34), e adotá-los como caso
// trocaria cegueira por alarme falso. O que separa os dois é a DOMINÂNCIA:
//
//     Transformação Digital   Logística Eficiente 288 x Transf. Digital 56 = 5,1x
//     Precificação            Delícias Saudáveis   89 x Detox Verde     49 = 1,8x
//     Estoque                 Curva ABC            49 x Custo Total     34 = 1,4x
//
// Só quem precisa de resgate é dominante. E a escalada é condicional: só age
// quando a leitura pelas aspas não encontrou UMA GRANDEZA SEQUER atravessando
// módulos, e só substitui se a alternativa encontrar. Ficar mudo não é o mesmo
// que aprovar.
// ═══════════════════════════════════════════════════════════════════════════

describe("caso condutor sem aspas", () => {
  // O nome precisa recorrer de verdade: a regra exige dez menções e o dobro da
  // frequência do segundo colocado. Um caso citado de passagem não é o caso.
  const eco = (n: number, frase: string) =>
    Array.from({ length: n }, (_, i) => `${frase} (${i + 1})`).join("\n\n");

  const CONCEITO = `A jornada começa pela 'Cultura Digital' e pela 'Gestão da Mudança'.

Na Logística Eficiente, o custo por entrega é de R$ 12,00.

${eco(7, "A Logística Eficiente acompanha seus indicadores de perto.")}`;

  const CONTRADIZ = `A Logística Eficiente revisou seus números neste trimestre.

Na Logística Eficiente, o custo por entrega é de R$ 30,00.

${eco(7, "A Logística Eficiente publica os resultados todo mês.")}`;

  it("a dominância resgata o caso que as aspas não veem", () => {
    const c = coerencia(CONCEITO, CONTRADIZ);
    expect(c.passed, `evidências: ${JSON.stringify(c.evidence)}`).toBe(false);
    expect(c.evidence.join(" ")).toContain("Logística Eficiente");
    expect(c.evidence.join(" ")).toContain("R$ 12,00");
    expect(c.evidence.join(" ")).toContain("R$ 30,00");
  });

  it("a escalada não age quando as aspas já mediram alguma coisa", () => {
    // Aqui o caso citado rende grandeza que atravessa módulos. A leitura por
    // dominância não pode substituir uma que estava funcionando.
    const m1 = `A 'Delícias Saudáveis' produz sucos.

No suco 'Detox Verde', o custo variável é de R$ 7,20 por garrafa.

O 'Detox Verde' da 'Delícias Saudáveis' lidera a linha.`;
    const m2 = `A 'Delícias Saudáveis' revisou os números.

No suco 'Detox Verde', o custo variável é de R$ 9,90 por garrafa.

O 'Detox Verde' da 'Delícias Saudáveis' segue em campanha.`;
    const c = coerencia(m1, m2);
    expect(c.passed).toBe(false);
    expect(c.evidence.join(" ")).toContain("Detox Verde");
  });
});
