// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o que cada ação do menu de IA manda a IA fazer
//
// POR QUE ISTO SAIU DO index.ts
//
// O menu do editor oferecia dez ações. O mapa de instruções tinha quatro. As
// outras seis caíam num `|| systemPrompts.improve` e recebiam, caladas, a
// instrução de "melhorar o texto": o autor clicava em "Encurtar", a IA devolvia
// o texto melhorado — às vezes maior — e o aviso na tela dizia "Texto
// encurtado ✨". Nas três que INSEREM (exemplo, aula prática, atividade) o
// estrago era maior: o retorno era o módulo reescrito e o cliente o anexava,
// duplicando o conteúdo do módulo dentro dele mesmo.
//
// Nada no código ligava a lista do menu à lista do servidor, então a divergência
// não tinha como aparecer. Aqui elas ficam de um lado só, exportadas, e um teste
// compara com o espelho do front (src/lib/ai-actions.ts). Se alguém acrescentar
// um item no menu sem escrever a instrução, o teste acusa.
// ═══════════════════════════════════════════════════════════════════════════

/** Como o resultado entra no documento. */
export type ModoEdicao = "append" | "replace";

/** Toda ação que o menu pode pedir, fora a "custom", que monta o próprio texto. */
export const ACOES_IA = [
  "improve",
  "fix",
  "simplify",
  "shorten",
  "expand",
  "deepen",
  "example",
  "practical",
  "activity",
  "regenerate",
] as const;

export type AcaoIA = typeof ACOES_IA[number];

/**
 * As três que INSEREM conteúdo novo. Elas são as únicas cujo texto muda com o
 * modo: anexando, a IA devolve só o trecho novo; substituindo, o texto inteiro.
 */
export const ACOES_QUE_INSEREM: readonly AcaoIA[] = ["example", "practical", "activity"];

/**
 * Travas que valem para TODA edição, inclusive a personalizada: sem elas o
 * modelo responde com explicação em volta do texto, ou devolve prosa onde havia
 * markdown — e o resultado entra direto no editor do autor.
 */
export const TRAVAS =
  "Mantenha o formato markdown do original, incluindo listas, tabelas e citações. " +
  "Responda APENAS com o texto editado, sem preâmbulo, sem comentários e sem cercas de código.";

/**
 * A instrução de uma ação, já com as travas. Devolve `null` para ação que o
 * servidor não conhece — servir a instrução de outra ação no lugar foi
 * exatamente o defeito que isto corrige.
 */
export function promptDaAcao(acao: string, modo: ModoEdicao): string | null {
  const base = instrucao(acao, modo);
  return base ? `${base} ${TRAVAS}` : null;
}

/** A instrução de uma instrução personalizada escrita pelo autor. */
export function promptPersonalizado(instrucaoDoAutor: string): string {
  return `Você é um editor pedagógico especialista. Aplique ao texto fornecido a seguinte instrução do autor:\n\n"${instrucaoDoAutor}"\n\n${TRAVAS}`;
}

function instrucao(acao: string, modo: ModoEdicao): string | null {
  const inserindo = modo === "append";

  switch (acao) {
    case "improve":
      return "Você é um editor pedagógico especialista. Melhore o texto mantendo o mesmo significado, tornando-o mais claro, preciso e profissional. Não acrescente assunto novo nem remova informação.";

    case "fix":
      return "Você é um revisor. Corrija apenas erros de gramática, ortografia, pontuação, concordância e formatação. NÃO reescreva frases que já estão corretas, não mude o estilo e não altere o conteúdo.";

    case "simplify":
      return "Você é um editor pedagógico. Reescreva o texto para que um iniciante entenda: frases curtas, ordem direta, jargão explicado na primeira vez que aparece. Preserve TODA a informação — simplificar é trocar a forma, não cortar conteúdo.";

    case "shorten":
      return "Você é um editor pedagógico. Reduza o texto para cerca de 60% do tamanho original, preservando todas as informações essenciais. Corte redundância, rodeio e adjetivo decorativo — não corte fatos, dados, definições nem itens de lista. O resultado TEM de ficar visivelmente mais curto que a entrada.";

    case "expand":
      return "Você é um editor pedagógico. Desenvolva o texto acrescentando explicação, contexto e exemplos concretos onde a ideia estiver apenas enunciada. Aprofunde o que já está lá; não introduza tema que o texto não trata.";

    case "deepen":
      return "Você é um especialista no assunto escrevendo material avançado. Aprofunde o texto: explique o MECANISMO por trás de cada afirmação, as causas, as implicações práticas, as exceções e os casos-limite. Aprofundar não é alongar — cada parágrafo acrescentado tem de trazer informação que não estava no original.";

    case "example":
      return inserindo
        ? 'Você é um professor. Leia o texto e escreva UM exemplo prático, concreto e específico do assunto tratado, com dados e nomes plausíveis do contexto do texto. Comece com o título "### Exemplo prático". Devolva SOMENTE o exemplo novo — NÃO repita, NÃO resuma e NÃO reescreva o texto recebido.'
        : "Você é um professor. O texto contém um exemplo. Substitua-o por um exemplo melhor: mais concreto, mais específico e mais próximo da realidade de quem estuda o assunto. Devolva o texto inteiro com o exemplo trocado, preservando todo o resto.";

    case "practical":
      return inserindo
        ? 'Você é um professor. A partir do texto, escreva uma aula prática: um roteiro passo a passo que o aluno executa para aplicar o que acabou de ler, com o que é preciso ter em mãos, os passos numerados e o resultado esperado ao final. Comece com o título "### Aula prática". Devolva SOMENTE a aula prática nova — NÃO repita o texto recebido.'
        : "Você é um professor. Transforme o texto em uma aula prática: converta a exposição teórica num roteiro passo a passo que o aluno executa, preservando o conteúdo técnico. Devolva o texto transformado por inteiro.";

    case "activity":
      return inserindo
        ? 'Você é um professor. A partir do texto, escreva UMA atividade avaliável: enunciado com uma situação realista, o que se pede do aluno, e os critérios de correção. Comece com o título "### Atividade". Devolva SOMENTE a atividade nova — NÃO repita o texto recebido.'
        : "Você é um professor. O texto contém uma atividade. Substitua-a por uma melhor, com situação realista, comando claro e critérios de correção. Devolva o texto inteiro com a atividade trocada.";

    case "regenerate":
      return "Você é um autor de cursos. Reescreva este módulo do zero, mantendo o mesmo tema, os mesmos objetivos de aprendizagem e a mesma estrutura de seções, mas com abordagem, exemplos e redação novos. O resultado deve cobrir o mesmo programa sem reaproveitar as frases do original.";

    default:
      return null;
  }
}
