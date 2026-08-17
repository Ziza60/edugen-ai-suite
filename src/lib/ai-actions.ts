/**
 * Espelho de front das ações do menu de IA.
 * Mantenha em sincronia com supabase/functions/enhance-paragraph/actions.ts —
 * `src/test/ai-actions.test.ts` compara os dois e falha se divergirem.
 *
 * POR QUE O TESTE EXISTE
 *
 * O menu oferecia dez ações e o servidor tinha instrução para quatro. As outras
 * seis caíam num `|| improve` e recebiam, caladas, a instrução de "melhorar o
 * texto": clicar em "Encurtar" devolvia o texto melhorado — às vezes maior — e
 * a mensagem na tela dizia "Texto encurtado ✨". Nas três que inserem conteúdo,
 * o retorno era o módulo reescrito e o cliente o anexava, duplicando o módulo
 * dentro dele mesmo.
 *
 * Nada ligava as duas listas, então a divergência nunca apareceu sozinha.
 */

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

/** Como o resultado entra no documento quando o menu não diz explicitamente. */
export const MODO_PADRAO: Partial<Record<AcaoIA, "append" | "replace">> = {
  example: "append",
  practical: "append",
  activity: "append",
};

/** Aviso mostrado quando o autor aceita a edição. */
export const ROTULOS_IA: Record<AcaoIA, string> = {
  improve: "Texto melhorado ✨",
  fix: "Erros corrigidos ✨",
  simplify: "Texto simplificado ✨",
  shorten: "Texto encurtado ✨",
  expand: "Texto expandido ✨",
  deepen: "Conteúdo aprofundado ✨",
  example: "Exemplo prático adicionado ✨",
  practical: "Aula prática gerada ✨",
  activity: "Atividade adicionada ✨",
  regenerate: "Módulo regenerado ✨",
};
