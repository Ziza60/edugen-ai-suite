// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — sugerir a descrição da imagem a partir do título
//
// POR QUE ISTO EXISTE
//
// O campo "Descreva a imagem" é opcional, e em branco o gerador manda o TÍTULO
// direto para o modelo de imagem. Títulos de curso são abstratos —
// "Monitoramento, Informação e Comunicação nos Controles Internos" não diz o
// que desenhar. Modelo de imagem é ruim com abstração e bom com substantivo
// concreto, então o resultado saía genérico ou fora do tema, e a saída era o
// autor escrever a cena à mão em todo módulo.
//
// Aqui um modelo de TEXTO faz essa tradução: título → objetos concretos. O
// resultado vai para o campo, onde o autor edita antes de gerar — a decisão
// continua sendo dele, que era o ponto do campo existir.
//
// O que esta descrição NÃO deve conter: regra de enquadramento (isso é do
// sistema, em generate-module-image/image-prompt.ts) e nada que peça texto
// dentro da imagem — pedir um "carimbo de conferido" já custou uma capa com
// letras deformadas.
// ═══════════════════════════════════════════════════════════════════════════

export type EscopoSugestao = "cover" | "module";

/** Teto do campo no app. A sugestão precisa caber sem ser cortada no meio. */
export const LIMITE_DESCRICAO = 480;

export interface EntradaSugestao {
  escopo: EscopoSugestao;
  /** Título do módulo (escopo "module") ou do curso (escopo "cover"). */
  titulo: string;
  /** Título do curso, como contexto, quando o escopo é de módulo. */
  cursoTitulo?: string | null;
}

export function promptDeSugestao(e: EntradaSugestao): string {
  const ehCapa = e.escopo === "cover";
  const alvo = ehCapa
    ? `a CAPA do curso "${e.titulo}"`
    : `o módulo "${e.titulo}"${e.cursoTitulo ? ` do curso "${e.cursoTitulo}"` : ""}`;

  return `Você descreve cenas para um gerador de imagens que ilustra material didático.

Escreva, em português do Brasil, a descrição de UMA cena para ${alvo}.

Como escrever:
- Nomeie OBJETOS CONCRETOS e visíveis. Um gerador de imagem não sabe desenhar "monitoramento" nem "conformidade"; sabe desenhar painel, gráfico, pasta, lupa, engrenagem, fluxograma, prancheta, cofre, balança.
- Traduza o assunto do título em três a cinco objetos que um profissional da área reconheceria, e diga como estão dispostos.
- Uma frase para a paleta de cores e uma para a luz.
- Frases curtas e afirmativas, sem rodeio e sem explicar o que você está fazendo.

Proibido:
- Pedir QUALQUER texto, letra, número, rótulo, placa, carimbo ou logotipo na cena. Não descreva objeto cuja função seja carregar escrita.
- Pessoas, rostos, mãos.
- Falar de enquadramento, moldura, margem, proporção, corte ou onde a imagem será usada — disso cuida o sistema.
- Termos de marca, nome de empresa ou de software.

Responda APENAS com a descrição, em texto corrido, no máximo ${LIMITE_DESCRICAO} caracteres. Sem título, sem aspas, sem lista, sem comentário.`;
}

/**
 * Limpa o que o modelo devolve. Ele às vezes embrulha em aspas, abre com
 * "Claro! Aqui está:" ou entrega em tópicos — e isso iria direto para o campo
 * do autor, que teria de apagar na mão.
 */
export function limparSugestao(bruto: string): string {
  let t = (bruto ?? "").trim();

  // Cerca de código, quando o modelo resolve formatar.
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();

  // Preâmbulo antes de dois-pontos, só quando é curto e claramente conversa.
  t = t.replace(/^(?:claro|certo|aqui está|segue|descrição)[^:\n]{0,40}:\s*/i, "");

  // Tópicos viram texto corrido: o campo é uma caixa de texto simples.
  t = t.split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .join(" ");

  // Aspas em volta do todo.
  t = t.replace(/^["“”'']+/, "").replace(/["“”'']+$/, "").trim();

  t = t.replace(/\s+/g, " ");

  if (t.length > LIMITE_DESCRICAO) {
    // Corta na última frase inteira que couber, para não terminar no meio de
    // uma palavra dentro do campo do autor.
    const corte = t.slice(0, LIMITE_DESCRICAO);
    const ultimoPonto = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("! "));
    t = ultimoPonto > LIMITE_DESCRICAO * 0.5
      ? corte.slice(0, ultimoPonto + 1)
      : corte.slice(0, corte.lastIndexOf(" ")).trim();
  }
  return t;
}
