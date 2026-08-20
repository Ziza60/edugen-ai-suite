// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o tom escolhido vira instrução, não etiqueta
//
// O QUE ESTAVA ERRADO
//
// A pergunta "Que tom você prefere no material?" mandava para o modelo uma
// palavra solta: `- Tom: didatico`. Sem acento, sem explicação, sem nenhuma
// regra que a sustentasse depois. Duas consequências:
//
// 1) O rótulo do botão não batia com o valor enviado. Quem clicava em
//    "Prático" fazia o modelo receber "didatico"; quem clicava em
//    "Conversacional" fazia receber "direto" — que puxa para o seco, quase o
//    contrário do pedido.
//
// 2) A ironia: o padrão de quem NÃO escolhe nada era a frase inteira
//    "profissional, claro e acessível". Escolher um tom entregava ao modelo
//    MENOS informação do que não escolher.
//
// COMO FICOU
//
// O identificador continua curto — é ele que vai para o banco, e cursos
// antigos já têm "didatico" e "direto" gravados. Quem cresce é o texto que
// chega ao modelo: cada tom vira uma instrução com o que fazer, e não um
// adjetivo para o modelo interpretar como quiser.
//
// Texto livre passa intacto. Se alguém gravar "tom de mentor sênior falando
// com estagiário", isso é melhor que qualquer opção da lista e não deve ser
// substituído por um padrão.
// ═══════════════════════════════════════════════════════════════════════════

const TONS: Record<string, string> = {
  profissional:
    "profissional: claro e acessível, frases diretas, sem jargão desnecessário e sem informalidade",
  didatico:
    "didático: explica o porquê antes do como, define cada termo na primeira vez que ele aparece e retoma o essencial ao fim de cada trecho",
  pratico:
    "prático: começa pelo exemplo e pelo passo a passo e só depois generaliza; prioriza o que o leitor vai FAZER sobre o que ele deve saber",
  direto:
    "direto: frases curtas, voz ativa, nenhum preâmbulo; corta adjetivo de enfeite e vai ao ponto na primeira linha de cada trecho",
  conversacional:
    "conversacional: fala com o leitor por 'você', antecipa a dúvida que ele teria naquele ponto e mantém ritmo natural — sem virar informal e sem perder precisão técnica",
  academico:
    "acadêmico: registro formal, terminologia precisa, remissão explícita às normas e fontes que fundamentam cada afirmação, sem coloquialismo",
};

/** Os identificadores que a interface oferece. */
export const TONS_CONHECIDOS = Object.keys(TONS);

/**
 * Expande o tom escolhido na instrução que vai ao modelo.
 *
 * Texto que não está na lista é devolvido como veio — pode ser descrição
 * própria do autor, que vale mais que qualquer opção pronta.
 */
export function descricaoDoTom(tom: string | null | undefined): string {
  const bruto = (tom ?? "").trim();
  if (!bruto) return TONS.profissional;
  const chave = bruto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return TONS[chave] ?? bruto;
}
