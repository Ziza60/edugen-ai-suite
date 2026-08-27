import { describe, expect, it } from "vitest";
import { valoresDoCasoCondutor } from "../../supabase/functions/_shared/course-pipeline";
import {
  grandezasDoTexto,
  identificarCaso,
  mesmoObjeto,
  oracoes,
  paragrafosDe,
  valorEmNumero,
  pareceEntidade,
  ehNomeProprio,
} from "../../supabase/functions/_shared/valores-do-caso";

// ═══════════════════════════════════════════════════════════════════════════
// O CUSTO DE PEDIDO QUE MUDOU DE VALOR ENTRE OS MÓDULOS
//
// Apostila de estoque, 23/08. Página 21, módulo 2: o aluno soma tempo do dono,
// tempo do funcionário, frete e papelaria e chega a um Custo de Pedido de
// R$185,00 para o Armazém da Esquina. Página 37, módulo 3, mesmo armazém, mesmo
// dono: "CP = R$ 50,00/pedido". Sem uma palavra de explicação.
//
// Cada módulo é gerado numa invocação separada e não lê uma linha do texto dos
// anteriores. Esta leitura é a ponte: acha, no que já foi impresso, os números
// que o caso condutor teve fixados, para que o módulo seguinte os receba junto
// com o prompt.
//
// A PRIMEIRA versão lia pelo glossário do curso — procurava um valor perto de
// cada termo canônico. Passou nos nove testes que a acompanhavam e, no curso de
// precificação de 24/08, achou "Custo Variável: R$ 0,80" numa tabela de outro
// produto e injetou esse número nos módulos seguintes. Um valor extraído errado
// vira instrução errada, e o modelo obedece.
//
// Os textos abaixo são recortes literais das apostilas.
// ═══════════════════════════════════════════════════════════════════════════

/** Módulo 2 da apostila de estoque, com a soma como ela saiu impressa. */
const ESTOQUE_M2 = `Passo a Passo para Calcular o Custo de Pedido

O Custo de Pedido (CP) abrange todos os gastos envolvidos no processo de
solicitar e receber mercadorias no 'Armazém da Esquina'.

No 'Armazém da Esquina', Custo Total de Pedido (CP) = R$125.00 (Sr. João) +
R$25.00 (funcionário) + R$30.00 (frete) + R$5.00 (papelaria) = R$185.00 por
pedido.

Resultado: O Custo de Pedido para cada compra no 'Armazém da Esquina' é de
R$185.00. Este valor mostra que, mesmo em um pequeno varejo, cada pedido pesa.

O Sr. João, do 'Armazém da Esquina', revisa esse número todo mês.`;

describe("valoresDoCasoCondutor", () => {
  it("carrega o Custo de Pedido que o módulo 2 fixou", () => {
    const v = valoresDoCasoCondutor([{ texto: ESTOQUE_M2, modulo: 2 }]);
    const cp = v.find((x) => /custo/i.test(x.termo));
    expect(cp, `valores: ${JSON.stringify(v)}`).toBeDefined();
    expect(cp!.valor).toBe("R$185.00");
    expect(cp!.modulo).toBe(2);
    expect(cp!.termo).toContain("Armazém da Esquina");
  });

  it("o valor é o TOTAL da soma, não a primeira parcela", () => {
    // "= R$125.00 (Sr. João) + R$25.00 + R$30.00 + R$5.00 = R$185.00".
    // Levar R$ 125,00 adiante seria propagar o tempo do dono como se fosse o
    // custo do pedido inteiro.
    const v = valoresDoCasoCondutor([{ texto: ESTOQUE_M2, modulo: 2 }]);
    expect(v.map((x) => x.valor)).not.toContain("R$125.00");
  });

  it("sem caso condutor identificável, não injeta nada", () => {
    // Não ter valor nenhum é um desfecho correto. Ter o valor errado, não.
    const v = valoresDoCasoCondutor([{
      texto: "Conceitos gerais de custo. O custo variável é de R$ 4,00.",
      modulo: 1,
    }]);
    expect(v).toEqual([]);
  });

  it("fica com a fonte mais antiga quando duas fixam a mesma grandeza", () => {
    const depois = ESTOQUE_M2.replace(/R\$185\.00/g, "R$50,00");
    const v = valoresDoCasoCondutor([
      { texto: ESTOQUE_M2, modulo: 2 },
      { texto: depois, modulo: 3 },
    ]);
    const cp = v.find((x) => /custo/i.test(x.termo))!;
    expect(cp.modulo).toBe(2);
    expect(cp.valor).toBe("R$185.00");
  });

  it("lista vazia e texto vazio não quebram", () => {
    expect(valoresDoCasoCondutor([])).toEqual([]);
    expect(valoresDoCasoCondutor([{ texto: "", modulo: 1 }])).toEqual([]);
    expect(
      valoresDoCasoCondutor([{ texto: null as unknown as string, modulo: 1 }]),
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O FILTRO QUE O PORTÃO NÃO PRECISA TER
//
// O portão de qualidade tolera leitura ruim: um rótulo falso não se agrupa com
// nada e nunca vira alarme. A ponte não tolera — tudo que ela lê é injetado no
// prompt como fato estabelecido.
//
// Rodando a leitura ancorada, sem filtro, contra o módulo 1 do curso de
// precificação, saíam treze "valores", entre eles "Detox Verde — Eles precisam:
// 30%" e "Detox Verde — Além disso: R$ 0,20". São fragmentos de oração.
//
// O que separa uma grandeza de um fragmento, sem precisar de dicionário: a
// grandeza SE REPETE. O curso fixa o número e o reafirma no resultado.
// ═══════════════════════════════════════════════════════════════════════════

describe("a grandeza precisa se repetir", () => {
  const UMA_VEZ = `A 'Delícias Saudáveis' produz o suco 'Detox Verde'.

No 'Detox Verde', o custo de energia elétrica é de R$ 0,20 por garrafa.

O 'Detox Verde' da 'Delícias Saudáveis' é o carro-chefe da linha.

A 'Delícias Saudáveis' aposta no 'Detox Verde' para o lançamento.`;

  it("número citado uma vez só não é injetado", () => {
    expect(valoresDoCasoCondutor([{ texto: UMA_VEZ, modulo: 1 }])).toEqual([]);
  });

  it("número reafirmado é injetado", () => {
    const DUAS = `${UMA_VEZ}

Para o 'Detox Verde', o custo de energia elétrica é de R$ 0,20 por unidade.`;
    const v = valoresDoCasoCondutor([{ texto: DUAS, modulo: 1 }]);
    expect(v.map((x) => x.valor)).toContain("R$ 0,20");
  });

  it("parágrafo que não cita o caso não é lido", () => {
    // A âncora não é enfeite: sem ela, o número pode ser de qualquer coisa.
    // Foi assim que a versão por glossário pegou o custo de outro produto.
    const SEM_ANCORA = `A 'Delícias Saudáveis' produz o suco 'Detox Verde'.

Num exemplo à parte, o custo de energia elétrica é de R$ 9,99 por garrafa.

Noutro exemplo à parte, o custo de energia elétrica é de R$ 9,99 por garrafa.

O 'Detox Verde' da 'Delícias Saudáveis' é o carro-chefe da linha.

A 'Delícias Saudáveis' aposta no 'Detox Verde' para o lançamento.`;
    const v = valoresDoCasoCondutor([{ texto: SEM_ANCORA, modulo: 1 }]);
    expect(v.map((x) => x.valor)).not.toContain("R$ 9,99");
  });

  it("o mesmo rótulo com valores diferentes não conta como repetição", () => {
    // Duas menções, dois números: o módulo não fixou nada, contradisse-se.
    // Escolher um dos dois seria inventar.
    const CONTRADIZ = `A 'Delícias Saudáveis' produz o 'Detox Verde'.

O custo variável do 'Detox Verde' é de R$ 7,20 por garrafa.

O custo variável do 'Detox Verde' é de R$ 8,00 por garrafa.

O 'Detox Verde' da 'Delícias Saudáveis' vende bem.`;
    const v = valoresDoCasoCondutor([{ texto: CONTRADIZ, modulo: 1 }]);
    expect(v.filter((x) => /custo/i.test(x.termo))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AS ARMADILHAS DO TEXTO REAL
// ═══════════════════════════════════════════════════════════════════════════

describe("oracoes", () => {
  it("o ponto de 'Sr. João' não corta a soma ao meio", () => {
    // Este era o defeito: o corte em "Sr. João" partia
    // "= R$125.00 (Sr. João) + … = R$185.00" e o rótulo ficava com R$ 125,00.
    const o = oracoes(
      "Custo Total de Pedido (CP) = R$125.00 (Sr. João) + R$25.00 = R$185.00.",
    );
    expect(o).toHaveLength(1);
  });

  it("ponto dentro de parêntese aberto não corta", () => {
    expect(oracoes("O total (soma de 2.5h com 1h. veja acima) é R$ 10,00."))
      .toHaveLength(1);
  });

  it("ponto final de verdade corta", () => {
    expect(oracoes("O custo é R$ 7,20. O preço é R$ 25,00.")).toHaveLength(2);
  });

  it("o enumerador de passos separa orações", () => {
    const o = oracoes("Solução: 1. Preço: R$25,00 2. Custo: R$8,00");
    expect(o.length).toBeGreaterThan(1);
  });
});

describe("valorEmNumero", () => {
  it("lê as quatro formas que os cursos escrevem", () => {
    expect(valorEmNumero("R$25.000,00")).toBe(25000);
    expect(valorEmNumero("R$ 25.000")).toBe(25000);
    expect(valorEmNumero("R$7,20")).toBe(7.2);
    // Ponto decimal: é assim que a apostila de estoque escreveu o Custo de
    // Pedido. Ignorar essa forma deixaria o defeito original passar batido.
    expect(valorEmNumero("R$185.00")).toBe(185);
    expect(valorEmNumero("R$ 50")).toBe(50);
  });

  it("percentual e quantidade também viram número", () => {
    expect(valorEmNumero("30%")).toBe(30);
    expect(valorEmNumero("60 unidades")).toBe(60);
  });

  it("o que não dá para ler devolve null, e ninguém compara", () => {
    expect(valorEmNumero("um punhado")).toBeNull();
  });
});

describe("mesmoObjeto", () => {
  it("complementos diferentes são objetos diferentes", () => {
    // "Preço de Venda Unitário DO PÃO TRADICIONAL: R$ 5,00" contra "O Preço de
    // Venda calculado PARA O BOLO ARTESANAL é de R$ 62,50". Mesma padaria,
    // mesma chave, dois produtos — e um falso alarme medido no curso real.
    expect(
      mesmoObjeto(new Set(["pao", "tradicional"]), new Set(["bolo", "artesanal"])),
    ).toBe(false);
  });

  it("complemento em comum é o mesmo objeto", () => {
    expect(mesmoObjeto(new Set(["garrafa", "suco"]), new Set(["suco"]))).toBe(true);
  });

  it("sem complemento não há o que contradizer", () => {
    expect(mesmoObjeto(new Set(), new Set(["bolo"]))).toBe(true);
  });
});

describe("identificarCaso", () => {
  const texto = `A 'Delícias Saudáveis' lança o suco 'Detox Verde'.

O Custo Variável e a Margem de Contribuição são conceitos centrais.

O 'Detox Verde' da 'Delícias Saudáveis' custa caro.

A 'Delícias Saudáveis' aposta no 'Detox Verde'.`;

  it("o caso vem das aspas, não das maiúsculas", () => {
    const caso = identificarCaso([{ paragrafos: paragrafosDe(texto) }], 1);
    expect(caso.nomes).toContain("Detox Verde");
    // "Custo Variável" e "Margem de Contribuição" também vêm capitalizados. Se
    // virassem âncora, grandezas de produtos diferentes cairiam sob o mesmo
    // nome.
    expect(caso.nomes).not.toContain("Custo Variável");
    expect(caso.nomes).not.toContain("Margem de Contribuição");
  });

  it("nome citado uma vez só não é o caso do curso", () => {
    const caso = identificarCaso(
      [{ paragrafos: paragrafosDe("A 'Fábrica Nova' foi mencionada uma vez.") }],
      1,
    );
    expect(caso.nomes).toEqual([]);
  });

  it("a grandeza vai para a âncora mais específica do parágrafo", () => {
    // A empresa aparece em toda parte; o produto, só onde é o assunto. Um
    // parágrafo que fala do produto E cita a empresa pertence ao produto —
    // senão um curso com vários produtos empilharia todos sob a empresa.
    const comEmpresaOnipresente = `A 'Delícias Saudáveis' foi fundada em 2010.

A 'Delícias Saudáveis' tem fábrica própria.

A 'Delícias Saudáveis' exporta para três países.

A 'Delícias Saudáveis' lança o suco 'Detox Verde' neste trimestre.

O 'Detox Verde' da 'Delícias Saudáveis' tem boa aceitação.

O custo variável do 'Detox Verde' da 'Delícias Saudáveis' é de R$ 7,20.`;
    const caso = identificarCaso(
      [{ paragrafos: paragrafosDe(comEmpresaOnipresente) }],
      1,
    );
    const g = grandezasDoTexto(comEmpresaOnipresente, caso);
    const achado = g.find((x) => x.valor === "R$ 7,20");
    expect(achado?.caso).toBe("Detox Verde");
  });

  it("quando dois nomes andam sempre juntos, a atribuição é consistente", () => {
    // Nomes coextensivos são o mesmo recorte do curso: cai tudo no mesmo
    // balde, e qual dos dois nomeia o balde não muda nada — desde que não
    // mude de um parágrafo para o outro.
    const caso = identificarCaso([{ paragrafos: paragrafosDe(texto) }], 1);
    const g = grandezasDoTexto(
      `${texto}\n\nO custo variável do 'Detox Verde' da 'Delícias Saudáveis' é de R$ 7,20.\n\nO preço de venda do 'Detox Verde' da 'Delícias Saudáveis' é de R$ 25,00.`,
      caso,
    );
    expect(new Set(g.map((x) => x.caso)).size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// JARGÃO ENTRE ASPAS NÃO É CASO
//
// O curso de estoques de 27/08 escreve 'Lead Time' e 'Ponto de Pedido' assim, e
// a âncora devolvia oito "casos", seis deles conceitos da própria disciplina.
// Os dados do leite condensado do módulo 4 foram arquivados sob o caso "Ponto
// de Pedido" e os do módulo 8 sob "Lead Time": nunca caíram no mesmo grupo,
// nunca foram comparados, e a contradição passou com veredito `ready`.
//
// O que separa os dois é evidência POSITIVA — o caso AGE ou é APRESENTADO.
// ═══════════════════════════════════════════════════════════════════════════
describe("caso x jargão do curso", () => {
  const comAmbos = `A padaria 'Delícias da Vovó' produz doces artesanais.

O 'Lead Time' do fornecedor é o tempo entre o pedido e a entrega.

A 'Delícias da Vovó' utiliza leite condensado em quase tudo.

O 'Ponto de Pedido' é o nível de estoque que dispara uma nova compra.

A 'Delícias da Vovó' compra açúcar todo mês.

Reduzir o 'Lead Time' diminui o 'Ponto de Pedido' necessário.`;

  const caso = () => identificarCaso([{ paragrafos: paragrafosDe(comAmbos) }], 1).nomes;

  it("fica com o nome que age ou é apresentado", () => {
    expect(caso()).toContain("Delícias da Vovó");
  });

  it("descarta o conceito que o próprio curso define", () => {
    expect(caso()).not.toContain("Lead Time");
    expect(caso()).not.toContain("Ponto de Pedido");
  });

  it("'X é ...' não conta como agir — é definição, e definição é de conceito", () => {
    expect(pareceEntidade("O 'Lead Time' é o tempo de espera.", "Lead Time")).toBe(false);
  });

  it("a conjunção 'e' não vale por verbo", () => {
    // Sem acento "é" vira "e": foi assim que "Ponto de Pedido e LEC" entrou como
    // sujeito que age, e os seis jargões voltaram todos de uma vez.
    expect(pareceEntidade("Aplique Ponto de Pedido e Lote Econômico.", "Ponto de Pedido"))
      .toBe(false);
  });

  it("aposto entre parênteses apresenta um TERMO, não uma entidade", () => {
    expect(pareceEntidade("O tempo de ressuprimento (Lead Time) do fornecedor.", "Lead Time"))
      .toBe(false);
  });

  it("adjetivo antes do nome não apresenta", () => {
    expect(pareceEntidade('Uma boa "Gestão de Fornecedores" vai além do preço.', "Gestão de Fornecedores"))
      .toBe(false);
  });

  it("substantivo que apresenta conta: 'o suco Detox Verde'", () => {
    expect(pareceEntidade("Para o suco Detox Verde, a estimativa é de 5.000 garrafas.", "Detox Verde"))
      .toBe(true);
  });

  it("nome com palavra de conteúdo em minúscula não é nome próprio", () => {
    expect(ehNomeProprio("Homologação de fornecedores")).toBe(false);
    expect(ehNomeProprio("Delícias da Vovó")).toBe(true);
    expect(ehNomeProprio("Vovó")).toBe(false);
  });

  it("sem evidência para NINGUÉM, a evidência não exclui ninguém", () => {
    // Um módulo do curso de estoque de 23/08 menciona o 'Armazém da Esquina'
    // oito vezes, sempre depois de preposição. A loja é o caso, e ali ela não
    // age nenhuma vez: tirar todos trocaria leitura errada por silêncio total.
    const so = `No 'Armazém da Esquina', o custo de pedido é de R$185.00.

Do 'Armazém da Esquina' saem 40 pedidos por mês.

Para o 'Armazém da Esquina', esse número pesa.`;
    expect(identificarCaso([{ paragrafos: paragrafosDe(so) }], 1).nomes)
      .toContain("Armazém da Esquina");
  });
});
