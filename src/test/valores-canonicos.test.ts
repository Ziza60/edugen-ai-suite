import { describe, expect, it } from "vitest";
import { extrairValoresCanonicos } from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// O CUSTO DE PEDIDO QUE MUDOU DE VALOR ENTRE OS MÓDULOS
//
// Apostila de estoque, 23/08. Página 21, módulo 2: o aluno soma tempo do dono,
// tempo do funcionário, frete e papelaria e chega a um Custo de Pedido de
// R$185,00 para o Armazém da Esquina. Página 37, módulo 3, mesmo armazém, mesmo
// dono: "CP = R$ 50,00/pedido". Sem uma palavra de explicação.
//
// Cada módulo é gerado numa invocação separada e não lê uma linha do texto dos
// anteriores. Esta extração é a ponte: acha, no que já foi impresso, o valor
// que cada termo do glossário recebeu, para que o módulo seguinte o receba
// junto com o prompt.
//
// A precisão vem de procurar só perto dos TERMOS CANÔNICOS do curso. Extrair
// "grandeza = valor" de prosa livre daria ruído, e um valor errado extraído
// vira instrução errada — pior que não ter nenhuma.
// ═══════════════════════════════════════════════════════════════════════════

const TERMOS = [
  "Custo de Pedido",
  "Custo de Manutenção",
  "Lote Econômico de Compra",
  "Ponto de Pedido",
  "Curva ABC",
];

const MODULO_2 = `## 2.1 Dissecando o Custo de Pedido

O Custo de Pedido (CP) abrange todos os gastos envolvidos no processo de
solicitar e receber mercadorias do fornecedor.

**Cálculo no Armazém da Esquina**

Tempo do Sr. João: 2.5h * R$50/h = R$125.00. Tempo do funcionário: 1h * R$25/h
= R$25.00. Somando: R$125.00 + R$25.00 + R$30.00 (frete) + R$5.00 (papelaria).

Resultado: o Custo de Pedido para cada compra no Armazém da Esquina é de
R$185.00 por pedido.`;

describe("extrairValoresCanonicos", () => {
  it("acha o valor que o módulo publicou para o termo", () => {
    const achados = extrairValoresCanonicos(MODULO_2, TERMOS, 2);
    const cp = achados.find((v) => v.termo === "Custo de Pedido");
    expect(cp).toBeDefined();
    expect(cp!.valor).toMatch(/R\$\s?\d/);
    expect(cp!.modulo).toBe(2);
  });

  it("não inventa valor para termo que o módulo não quantificou", () => {
    const achados = extrairValoresCanonicos(MODULO_2, TERMOS, 2);
    expect(achados.find((v) => v.termo === "Curva ABC")).toBeUndefined();
  });

  it("um valor por termo — o primeiro, que é o que o módulo apresentou", () => {
    const achados = extrairValoresCanonicos(MODULO_2, TERMOS, 2);
    const termos = achados.map((v) => v.termo);
    expect(new Set(termos).size).toBe(termos.length);
  });

  it("pega quantidade com unidade, não só dinheiro", () => {
    const md = "O Ponto de Pedido calculado foi de 60 unidades para o item.";
    const achados = extrairValoresCanonicos(md, TERMOS, 3);
    expect(achados[0]?.termo).toBe("Ponto de Pedido");
    expect(achados[0]?.valor).toBe("60 unidades");
  });

  it("pega percentual", () => {
    const md = "A Curva ABC coloca em A os itens que somam 80% do valor total.";
    const achados = extrairValoresCanonicos(md, TERMOS, 1);
    expect(achados[0]?.valor).toBe("80%");
  });

  it("não atravessa o fim da frase atrás de um número", () => {
    // O valor tem de estar na MESMA frase do termo. Sem esse limite, o primeiro
    // número de qualquer lugar do módulo viraria "o valor canônico" do termo.
    const md =
      "O Custo de Pedido é um conceito central da gestão de compras. " +
      "Em outro exemplo sem relação, o frete custou R$30,00.";
    expect(extrairValoresCanonicos(md, TERMOS, 2)).toEqual([]);
  });

  it("ignora termos curtos demais para serem procurados", () => {
    // "LEC" casaria dentro de qualquer palavra e em qualquer contexto.
    const md = "O LEC do item é 200 unidades.";
    expect(extrairValoresCanonicos(md, ["LEC"], 3)).toEqual([]);
  });

  it("termo com parênteses não quebra a expressão regular", () => {
    const md = "O Lote Econômico de Compra (LEC) ficou em 200 unidades.";
    const achados = extrairValoresCanonicos(md, ["Lote Econômico de Compra (LEC)"], 3);
    expect(achados[0]?.valor).toBe("200 unidades");
  });

  it("vazio, sem termos e nulo não quebram", () => {
    expect(extrairValoresCanonicos("", TERMOS, 1)).toEqual([]);
    expect(extrairValoresCanonicos(MODULO_2, [], 1)).toEqual([]);
    expect(extrairValoresCanonicos(null as unknown as string, TERMOS, 1)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A LIÇÃO QUE OS TESTES ACIMA NÃO DERAM
//
// Todos passavam, e rodar contra o módulo 2 de verdade devolveu lista vazia. O
// texto real dobra as linhas no meio da frase — "é de\nR$185.00" — e a versão
// anterior cortava a janela de busca em qualquer quebra, jogando fora
// exatamente o número procurado. O parágrafo abaixo tem a dobra no lugar em que
// ela apareceu na apostila.
// ═══════════════════════════════════════════════════════════════════════════

describe("extrairValoresCanonicos — texto com as linhas dobradas", () => {
  const REAL = `Passo a Passo para Calcular o Custo de Pedido

O Custo de Pedido (CP) abrange todos os gastos envolvidos no processo de
solicitar e receber mercadorias.

Resultado: O Custo de Pedido para cada compra no Armazém da Esquina é de
R$185.00. Este valor mostra que, mesmo em um pequeno varejo, cada pedido pesa.`;

  it("a quebra no meio da frase não esconde o valor", () => {
    const achados = extrairValoresCanonicos(REAL, TERMOS, 2);
    expect(achados).toEqual([
      { termo: "Custo de Pedido", valor: "R$185.00", modulo: 2 },
    ]);
  });

  it("o título sem número não impede achar o valor mais adiante", () => {
    // O termo estreia no título "Passo a Passo para Calcular o Custo de Pedido",
    // onde não há número nenhum. Olhar só a estreia devolvia vazio.
    expect(REAL.indexOf("Custo de Pedido")).toBeLessThan(REAL.indexOf("R$185.00"));
    expect(extrairValoresCanonicos(REAL, TERMOS, 2).length).toBe(1);
  });
});
