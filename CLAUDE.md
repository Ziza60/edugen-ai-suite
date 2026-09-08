# Convenções deste projeto

Este arquivo é curto de propósito. Não descreve a arquitetura — descreve as
regras de trabalho que já foram pagas com defeito em produção.

## Toda regra é medida contra texto real antes de entrar

A bancada é `src/test/cursos-reais/` — cursos gerados em produção, com a
verdade de referência apurada à mão em `src/test/regressao-cursos-reais.test.ts`.
Leia `src/test/cursos-reais/README.md` antes de mexer em qualquer regra de
qualidade.

Cinco regras já morreram na medição depois de parecerem óbvias no papel. Uma
regra que passa em fixture escrita à mão e não é medida contra curso real é
palpite.

## Toda medição precisa de uma segunda opinião independente

**Regra permanente, criada em 08/09/2026 depois de um erro caro.**

Ao medir qualquer coisa sobre o texto dos cursos, produza **duas** contagens:

1. a do **instrumento** — a função do código que está sendo avaliada;
2. uma **contagem crua e independente** — `grep`, `str.count()`, uma regex
   escrita do zero — que não compartilhe código nem expressão regular com o
   instrumento.

Se as duas divergirem, **o instrumento está sob suspeita até prova em
contrário**, e a divergência é o resultado mais importante da medição.

### O caso que criou a regra

`NOME_CITADO_RE` aceitava no máximo três palavras. O curso de 09/09 chama o caso
condutor de `'Padaria Delícias do Bairro'` — quatro palavras, citado 141 vezes.
O reconhecedor devolvia lista vazia.

Ao investigar, escrevi um script de diagnóstico **copiando o mesmo regex do
código**. Ele encontrou só termos de três palavras, e eu concluí que o modelo
tinha ignorado a instrução do prompt. O modelo obedecera; o reconhecedor é que
era cego — e o instrumento confirmou o erro em vez de expô-lo.

Um `grep` por `'Padaria Delícias do Bairro'` teria mostrado 141 ocorrências em
dois segundos e apontado para o lugar certo. A conclusão errada quase virou uma
mudança grande no extrator para resolver um problema inexistente.

## Números no código carregam a medição que os justifica

Constante, limiar ou orçamento entra com o número medido no comentário, e com o
que aconteceria se ele estivesse errado. Quando o número é julgamento e não
medição, o comentário diz isso com todas as letras.

O defeito recorrente deste projeto tem nome: **uma constante, regra ou régua que
não olha aquilo que afirma medir.** Ele já apareceu no orçamento do reparo, no
teto de tokens, na contagem de reparos aplicados, no rótulo da ponte e — como
acima — no próprio instrumento de medição.

## Deploy

As Edge Functions são publicadas pelo Replit, que só faz deploy: o código é
escrito e testado aqui e empurrado para `main`. Antes de qualquer deploy, o SHA
é confirmado com `git rev-parse HEAD`. Commit publicado nunca é reescrito.
