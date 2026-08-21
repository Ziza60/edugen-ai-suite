import { describe, expect, it } from "vitest";
import { ensurePedagogicalCoverage } from "../../supabase/functions/export-pptx-v7/deck-plan";

// ═══════════════════════════════════════════════════════════════════════════
// O ESTUDO DE CASO SEM CONTEÚDO
//
// Deck de 21/08, slides 26 e 38. O aluno via, na tela inteira:
//
//     Estudo de Caso: Aquisição de Materiais para Saúde
//     1 Contexto   2 Desafio   3 Solução   4 Resultado
//
// Quatro rótulos e nenhuma frase. O planejador devolveu os passos com o corpo
// vazio, e o construtor determinístico — que leria a seção do módulo e a
// preencheria — não achou a seção: ele a procurava pelo TÍTULO, exigindo as
// palavras "exemplo prático", "estudo de caso" ou "case study". O exemplo do
// módulo 4 deste curso chama-se "Análise de Relatórios para Conformidade
// Fiscal em Cidade Nova". Nenhuma delas aparece ali.
//
// Agora a seção é reconhecida pela FORMA — três ou mais rótulos de caso
// abrindo linhas do mesmo bloco — e, se ainda assim nada puder ser preenchido,
// o slide vazio não embarca.
// ═══════════════════════════════════════════════════════════════════════════

const SECAO = `
**Contexto:** A nova administração de Cidade Nova, buscando melhorar a saúde pública, identificou a necessidade urgente de adquirir medicamentos e materiais hospitalares básicos.

**Desafio:** Realizar a aquisição de R$ 50.000,00 em materiais médicos garantindo a correta execução orçamentária, da reserva da dotação ao pagamento.

**Solução:** A Secretaria Municipal de Saúde identificou uma dotação específica na LOA e emitiu Nota de Empenho Ordinário no valor total de R$ 50.000,00.

**Resultado:** A aquisição foi concluída, os materiais foram entregues e o processo seguiu todas as fases legalmente exigidas.

#### Alerta de Descumprimento da LRF

A LRF estabelece rigorosos controles sobre a execução da despesa.
`;

const COM_PALAVRA = `#### Estudo de Caso: Aquisição de Materiais para a Saúde\n${SECAO}`;
/** O caso real do módulo 4: título temático, sem nenhuma das palavras-chave. */
const SEM_PALAVRA = `#### Análise de Relatórios para Conformidade Fiscal em Cidade Nova\n${SECAO}`;

/** O slide 26 exatamente como saiu do deck de 21/08. */
const CASO_VAZIO = () => ({
  kind: "steps",
  title: "Estudo de Caso: Aquisição de Materiais para Saúde",
  eyebrow: "M",
  steps: [
    { heading: "Contexto" },
    { heading: "Desafio" },
    { heading: "Solução" },
    { heading: "Resultado" },
  ],
});

const FECHAMENTO = { kind: "closing", title: "Recapitulando", bullets: ["a", "b"] };

function rodar(slides: unknown[], conteudo: string) {
  const out: any[] = [{ title: "M", slides: slides.slice() }];
  const r = ensurePedagogicalCoverage(
    out,
    [{ title: "M", content: conteudo }] as any,
    "Português",
  );
  return { modulo: out[0], ...r };
}

const comCorpo = (s: any) =>
  (s.steps ?? []).filter((st: any) => String(st.body ?? "").trim()).length;

describe("seção reconhecida pelo título", () => {
  it("o caso vazio é preenchido com o texto da fonte", () => {
    const { modulo, examplesAdded } = rodar([CASO_VAZIO(), FECHAMENTO], COM_PALAVRA);
    expect(examplesAdded).toBe(1);
    expect(comCorpo(modulo.slides[0])).toBe(4);
    expect(modulo.slides[0].steps[0].body).toContain("Cidade Nova");
  });
});

describe("seção com título temático — o caso do módulo 4", () => {
  const { modulo, examplesAdded } = rodar([CASO_VAZIO(), FECHAMENTO], SEM_PALAVRA);

  it("é reconhecida pela forma e preenche o slide", () => {
    expect(examplesAdded).toBe(1);
    expect(comCorpo(modulo.slides[0])).toBe(4);
  });

  it("os quatro momentos do caso chegam com conteúdo", () => {
    const passos = modulo.slides[0].steps;
    expect(passos.map((p: any) => p.heading))
      .toEqual(["Contexto", "Desafio", "Solução", "Resultado"]);
    expect(passos[1].body).toContain("50.000");
    expect(passos[3].body.length).toBeGreaterThan(20);
  });

  it("o slide continua no lugar, não vai para o fim", () => {
    expect(modulo.slides[0].kind).toBe("steps");
    expect(modulo.slides.at(-1).kind).toBe("closing");
  });
});

describe("quando não há como preencher", () => {
  it("o estudo de caso vazio não embarca", () => {
    const { modulo, emptyExamplesDropped } = rodar(
      [CASO_VAZIO(), FECHAMENTO],
      "#### Uma lição qualquer\n\nProsa comum, sem caso nenhum.",
    );
    expect(emptyExamplesDropped).toBe(1);
    expect(modulo.slides.some((s: any) => s.kind === "steps")).toBe(false);
  });

  it("um passo com corpo já basta para o slide ficar", () => {
    const meio: any = CASO_VAZIO();
    meio.steps[0].body = "O setor de saúde precisa de materiais.";
    const { modulo, emptyExamplesDropped } = rodar(
      [meio, FECHAMENTO],
      "#### Uma lição qualquer\n\nProsa comum, sem caso nenhum.",
    );
    expect(emptyExamplesDropped).toBe(0);
    expect(modulo.slides).toHaveLength(2);
  });

  it("slide de passos que não é estudo de caso nunca é removido", () => {
    const passos = {
      kind: "steps",
      title: "Estágios da Receita",
      steps: [{ heading: "Previsão" }, { heading: "Lançamento" }, { heading: "Arrecadação" }],
    };
    const { modulo, emptyExamplesDropped } = rodar(
      [passos, FECHAMENTO],
      "#### Uma lição qualquer\n\nProsa comum.",
    );
    expect(emptyExamplesDropped).toBe(0);
    expect(modulo.slides[0].title).toBe("Estágios da Receita");
  });
});
