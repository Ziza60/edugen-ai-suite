import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  avisoDeVocabulario, comoAFonteChama, expressoesForaDasFontes, normalizar,
} from "../../supabase/functions/_shared/vocabulario-das-fontes.ts";
import { promptDeAnalise } from "../../supabase/functions/_shared/analise-de-documento.ts";

// ═══════════════════════════════════════════════════════════════════════════
// TERMINOLOGIA INVENTADA NO TÍTULO
//
// APONTADO por quem usou, em 19/11/2026, sobre "Auditoria Operacional no Setor
// Público: Fundamentos e Planejamento Estratégico":
//
//   "não se trata desse tipo de planejamento amplo que as empresas e órgãos
//    públicos fazem"
//
// Eu havia classificado como escolha de palavra. É importação. MEDIDO nas duas
// fontes reais do curso, que estão em cursos-reais/com-fontes/:
//
//   "planejamento estratégico" ....  0 ocorrências
//   "fase de planejamento" ........ 12
//   "plano de auditoria" .......... 11
//
// E não foi um caso: o curso de 18/11, gerado de UM documento só, saiu como
// "Planejamento Estratégico e Operacional de Auditorias". Dois de três títulos.
//
// Os testes abaixo rodam contra as FONTES REAIS do repositório, não contra um
// corpus inventado para o teste passar.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = resolve(process.cwd(), "src/test/cursos-reais/com-fontes");
const le = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const CORPUS = `${le("fonte-1-introducao.txt")}\n${le("fonte-2-manual-cap4.txt")}`;

describe("as fontes reais estão aqui e dizem o que eu afirmei", () => {
  it("há corpus de verdade para examinar", () => {
    // Sem este piso, tudo abaixo passaria com corpus vazio.
    expect(CORPUS.length).toBeGreaterThan(100_000);
  });

  it("o corpus NÃO contém 'planejamento estratégico'", () => {
    expect(normalizar(CORPUS)).not.toContain("planejamento estrategico");
  });

  it("o corpus chama a coisa de 'fase de planejamento'", () => {
    expect(normalizar(CORPUS)).toContain("fase de planejamento");
  });
});

describe("títulos reais contra as fontes reais", () => {
  it("ACUSA o título de 19/11 que o usuário apontou", () => {
    const fora = expressoesForaDasFontes(
      "Auditoria Operacional no Setor Público: Fundamentos e Planejamento Estratégico",
      CORPUS,
    );
    expect(fora).toEqual(["planejamento estrategico"]);
  });

  it("ACUSA o título de 18/11, gerado de um documento só", () => {
    const fora = expressoesForaDasFontes(
      "Planejamento Estratégico e Operacional de Auditorias", CORPUS,
    );
    expect(fora).toContain("planejamento estrategico");
  });

  it("passa limpo no título correto, com a expressão da fonte", () => {
    expect(expressoesForaDasFontes(
      "Fase de Planejamento da Auditoria Operacional no Setor Público", CORPUS,
    )).toEqual([]);
  });

  it("passa limpo no título do curso de 19/11 que foi gerado", () => {
    expect(expressoesForaDasFontes(
      "Planejamento da Auditoria Operacional no Setor Público: Da Teoria à Prática com Base nas ISSAI",
      CORPUS,
    )).toEqual([]);
  });

  it("palavra criativa isolada é legítima e não é acusada", () => {
    // "Alicerce" não está nas fontes, e é um bom título. Só bigrama técnico
    // ausente conta como terminologia inventada.
    expect(expressoesForaDasFontes(
      "Navegando nas ISSAI e NBASP: O Alicerce da Auditoria Operacional", CORPUS,
    )).toEqual([]);
  });
});

describe("enquadramento não é terminologia — o falso positivo que um teste pegou", () => {
  // A primeira versão acusava qualquer bigrama ausente do corpus, e isto
  // entrava como se fosse termo inventado. Um aviso que erra assim treina quem
  // lê a ignorá-lo — foi por isso que a coerência entre módulos saiu da tela.
  for (const titulo of [
    "Guia Prático de Planejamento de Auditoria",
    "Curso Completo de Auditoria Operacional",
    "Guia Base de Auditoria",
  ]) {
    it(`passa limpo: "${titulo}"`, () => {
      expect(expressoesForaDasFontes(titulo, CORPUS)).toEqual([]);
    });
  }

  it("LIMITE CONHECIDO: enquadramento com palavras da fonte é acusado", () => {
    // Este caso falhou quando eu o escrevi esperando lista vazia, e eu o deixo
    // aqui afirmando o comportamento REAL em vez de apagá-lo para a suíte
    // ficar verde.
    //
    // MEDIDO no corpus: "manual" 9 ocorrências, "essencial" 2. As duas palavras
    // são da fonte, "manual essencial" não é, e a regra não tem como saber que
    // aqui elas são moldura e não conceito.
    //
    // Por que é tolerável: isto é um AVISO ao lado de um campo editável, não um
    // bloqueio. O custo de um falso positivo é uma olhada; o custo do falso
    // negativo foi um título que confundiu planejamento de auditoria com
    // planejamento estratégico de organização.
    //
    // Placar medido nos títulos deste acervo: 2 verdadeiros, 3 limpos
    // legítimos, 1 falso positivo inventado por mim — nenhum observado em curso
    // real. Se um curso real trouxer um falso positivo, ele entra aqui e a
    // regra muda.
    expect(expressoesForaDasFontes("Manual Essencial da Auditoria Operacional", CORPUS))
      .toEqual(["manual essencial"]);
  });

  it("a assinatura do defeito é recombinar palavras DA FONTE", () => {
    // "planejamento" existe nas fontes. "estrategico" existe nas fontes.
    // O par não existe — e é isso que muda o sentido numa área técnica.
    const corpusNorm = normalizar(CORPUS);
    expect(corpusNorm).toMatch(/\bplanejamento\b/);
    expect(corpusNorm).toMatch(/\bestrategico\b/);
    expect(corpusNorm).not.toContain("planejamento estrategico");
  });

  it("palavra de fora da fonte no par não é acusada, mesmo com a outra sendo da fonte", () => {
    // "pratico" não está num manual de auditoria: é moldura.
    expect(normalizar(CORPUS)).not.toMatch(/\bpratico\b/);
    expect(expressoesForaDasFontes("Planejamento Pratico", CORPUS)).toEqual([]);
  });
});

describe("como o bigrama é formado", () => {
  // "estrategico" está aqui de propósito: a regra só acusa quando AMBAS as
  // palavras são vocabulário da fonte e o par não é.
  const corpus =
    "a fase de planejamento da auditoria operacional no setor publico " +
    "com enfoque estrategico e um plano detalhado";

  it("pontuação separa ideias — não cria bigrama atravessando os dois pontos", () => {
    // "publico fundamentos" nunca é testado: o ":" corta.
    expect(expressoesForaDasFontes("Setor Publico: Fundamentos", corpus)).toEqual([]);
  });

  it("palavra sem carga no meio impede o bigrama", () => {
    // "Fundamentos e Metodologia" → "fundamentos e" e "e metodologia" caem no
    // filtro, então nada é acusado mesmo sendo os dois ausentes.
    expect(expressoesForaDasFontes("Fundamentos e Metodologia", corpus)).toEqual([]);
  });

  it("palavra curta não forma bigrama técnico", () => {
    // "uso" e "fase" existem os dois no corpus e o par não — só o tamanho de
    // "uso" impede a acusação.
    const c = "o uso de plano e a fase de planejamento";
    expect(expressoesForaDasFontes("Uso Fase", c)).toEqual([]);
    expect(expressoesForaDasFontes("Plano Fase", c)).toEqual(["plano fase"]);
  });

  it("acento e caixa não mudam o resultado", () => {
    expect(expressoesForaDasFontes("FASE DE PLANEJAMENTO", corpus)).toEqual([]);
    expect(expressoesForaDasFontes("Auditoría Operacional", corpus)).toEqual([]);
  });

  it("acusa cada expressão uma vez só, mesmo repetida", () => {
    const fora = expressoesForaDasFontes(
      "Planejamento Estrategico: Planejamento Estrategico", corpus,
    );
    expect(fora).toEqual(["planejamento estrategico"]);
  });

  it("corpus vazio não acusa nada — sem insumo não há medição", () => {
    // Antes de medir obediência, verifique se o insumo existe. Um corpus vazio
    // acusaria TODO bigrama do título, o que seria ruído, não achado.
    expect(expressoesForaDasFontes("Planejamento Estrategico", "")).toEqual([]);
  });

  it("título vazio ou nulo não quebra", () => {
    expect(expressoesForaDasFontes("", corpus)).toEqual([]);
    expect(expressoesForaDasFontes(undefined as any, corpus)).toEqual([]);
  });
});

describe("a frase do aviso", () => {
  it("sem expressão fora, não há aviso", () => {
    expect(avisoDeVocabulario([])).toBeNull();
  });

  it("uma expressão, singular", () => {
    const a = avisoDeVocabulario(["planejamento estrategico"])!;
    expect(a).toContain('"planejamento estrategico"');
    expect(a).toMatch(/^A expressão/);
  });

  it("duas ou mais, plural", () => {
    expect(avisoDeVocabulario(["a bbbb", "c dddd"])).toMatch(/^As expressões/);
  });

  it("sem corpus, o aviso diz só que a expressão não está nos documentos", () => {
    expect(avisoDeVocabulario(["planejamento estrategico"])).not.toContain("sua fonte usa");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DIZER O QUE A FONTE USA, E NÃO SÓ O QUE ELA NÃO USA
//
// Depois do primeiro conserto, o título veio "Auditoria Operacional:
// Fundamentos e Planejamento Detalhado" — o modelo saiu de "estratégico", que
// era o termo errado de ofício, e cunhou outro par. O aviso disparou certo, mas
// dizia apenas que a expressão não existe, sem dizer qual existe.
//
// MEDIDO: "planejamento detalhado" 0 ocorrências, "detalhado" 1.
// ═══════════════════════════════════════════════════════════════════════════

describe("como a fonte chama a coisa", () => {
  it("para 'planejamento estrategico', devolve os termos de ofício do manual", () => {
    const u = comoAFonteChama("planejamento estrategico", CORPUS);
    const exprs = u.map((x) => x.expressao);
    expect(exprs).toContain("fase de planejamento");
    expect(exprs).toContain("matriz de planejamento");
  });

  it("para 'planejamento detalhado', devolve os mesmos — a âncora é a palavra do domínio", () => {
    // "detalhado" aparece 1x e "planejamento" 73x: a âncora tem de ser a
    // segunda, senão a sugestão vira ruído.
    const exprs = comoAFonteChama("planejamento detalhado", CORPUS).map((x) => x.expressao);
    expect(exprs).toContain("fase de planejamento");
  });

  it("vem ordenado por frequência, com a contagem", () => {
    const u = comoAFonteChama("planejamento estrategico", CORPUS);
    expect(u[0].ocorrencias).toBeGreaterThanOrEqual(u[1].ocorrencias);
    expect(u[0].ocorrencias).toBeGreaterThanOrEqual(3);
  });

  it("NÃO sugere nada quando a âncora é rara — o piso que tira o ruído", () => {
    // MEDIDO sem piso: "estrategico" devolvia "grupo estrategico" (1x) e
    // "estrategico da orga" (1x), que é um pedaço de "organização" partido
    // pela extração do PDF. Sugestão ruim é pior que nenhuma.
    expect(comoAFonteChama("detalhado suficientemente", CORPUS)).toEqual([]);
  });

  it("não sugere a própria expressão acusada", () => {
    const c = "fase de planejamento. fase de planejamento. fase de planejamento.";
    expect(comoAFonteChama("fase planejamento", c).map((x) => x.expressao))
      .not.toContain("fase planejamento");
  });

  it("corpus vazio não sugere nada", () => {
    expect(comoAFonteChama("planejamento estrategico", "")).toEqual([]);
  });

  it("o aviso completo diz as duas coisas", () => {
    const a = avisoDeVocabulario(["planejamento detalhado"], CORPUS)!;
    expect(a).toContain('"planejamento detalhado" não aparece');
    expect(a).toContain("A sua fonte usa:");
    expect(a).toContain("fase de planejamento");
    expect(a).toMatch(/\(\d+x\)/);
  });
});

describe("a regra também está no prompt, como primeira camada", () => {
  const prompt = promptDeAnalise("texto", "Manual.pdf");

  it("manda usar as expressões do próprio documento", () => {
    expect(prompt).toContain("EXPRESSIONS THE DOCUMENT ITSELF USES");
  });

  it("nomeia o caso que gerou a regra", () => {
    expect(prompt).toMatch(/"fase de planejamento".*must not say "planejamento estratégico"/);
  });

  it("libera palavra criativa isolada e proíbe bigrama inventado", () => {
    expect(prompt).toContain("Creative single words are fine");
    expect(prompt).toContain("Invented two-word technical expressions are not");
  });

  it("a regra vale também para um documento só — o caso de 18/11", () => {
    // Ela está no corpo do prompt, não dentro do bloco do conjunto.
    expect(prompt).not.toContain("ONE OF");
    expect(prompt).toContain("TERMINOLOGY");
  });
});
