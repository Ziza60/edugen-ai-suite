# Cursos reais, como bancada de medição

Cinco cursos gerados pelo EduGen em produção, exportados em Markdown. Eles não
são exemplo nem amostra inventada: é o material contra o qual toda regra de
qualidade deste projeto foi medida.

## Por que estão versionados

Duas vezes o contêiner de trabalho foi reciclado e levou junto os arquivos que
serviam de bancada. Nas duas, a medição parou até alguém reenviá-los, e uma
regra ficou sem verificação enquanto isso.

Uma regra de qualidade que não é medida contra texto real vira palpite — e este
projeto tem histórico disso. Três das minhas próprias regras morreram na
medição depois de parecerem óbvias no papel:

- a fração de citações entre aspas (limiar ajustado a três cursos, morto no
  quarto, no suco 'Detox Verde');
- a preposição locativa como sinal de entidade ('Ponto de Pedido' aparece 13
  vezes com "no/do");
- o termo definido como sinal negativo ('Delícias da Vovó' é definida uma vez e
  aparece em 24 títulos).

Nenhuma delas teria sido descartada sem estes arquivos.

## O que cada um é

| arquivo | caso condutor | módulos | serve para |
|---|---|---|---|
| `estoques-delicias-da-vovo.md` | padaria 'Delícias da Vovó' | 8 | duas diferenças LEGÍTIMAS que não podem virar bloqueador |
| `estoques-pao-quente.md` | padaria 'Pão Quente' | 8 | contradição verdadeira do Custo de Pedido |
| `estoques-sabor-da-vovo.md` | padaria 'Sabor da Vovó' | 8 | alarme falso do Lead Time, itens diferentes |
| `preco-financas-inteligentes.md` | app 'Finanças Inteligentes' | 5 | as duas contradições verdadeiras mais claras do acervo |
| `transformacao-digital.md` | — (sem caso numérico) | 8 | **o curso limpo**: prova que a regra não acusa quem não tem defeito |
| `estoques-doces-da-vovo-encadeado.md` | padaria 'Doces da Vovó' | 8 | o primeiro gerado com os dois primeiros módulos EM ORDEM |
| `estoques-sabor-caseiro.md` | padaria 'Sabor Caseiro' | 8 | alarme falso do prazo de entrega; **a bancada do reparo** |
| `estoques-techinov.md` | varejo 'TechInov' | 8 | **a âncora pegando jargão como caso**, do lado da ponte |

O de `TechInov` é o primeiro gerado com os módulos 1 e 2 rodando juntos (185,5 s
contra 265,7 s do 'Sabor Caseiro'), mas não é por isso que ele está aqui. Ele
está aqui porque a âncora falhou de um jeito que nenhum teste pegava: o caso
condutor é a empresa TechInov, presente nos oito módulos, e a ponte devolveu

    Lead Time — média móvel = 3 meses
    Lead Time — previsão de demanda = 93 unidades

com **'Lead Time'**, o conceito da disciplina, no lugar da empresa. O
`regressao-cursos-reais.test.ts` já travava isso, mas só em três cursos e só na
saída do PORTÃO; do lado da ponte não havia teste, e foi por ali que voltou.

O curso também tem uma contradição verdadeira que o portão achou pelos motivos
errados. O produto de 93 unidades/mês tem Lead Time de 20 dias (m2), 10 dias
(m3) e 15 dias (m8) — mesmo produto, sem explicação. Mas a lista do laudo cita
5 dias (que é do 'Mouse Gamer RGB'), 10 dias (do 'Fone Y') e 20 dias (que é o
MÁXIMO derivado no texto dos 15 de média), e **não cita os 20 dias do módulo 2**,
que é o valor que fixa o caso. Um acerto em quatro.

Parte da culpa é do curso: o produto é inominado no módulo 2, vira 'Smartphone
Z' no 3 e 'Smartphone X' no 5 e no 8. Nenhuma regra olha para renomeação, e é
ela que torna o agrupamento por nome impossível.

O de `Sabor Caseiro` é o primeiro gerado com o reparo de lição corrigido, e o
único do acervo cujo log foi lido reparo a reparo. Cinco rodaram, de 14,5 a
22,2 s, nenhum truncado; quatro foram aceitos (a lição 8.2 saiu de 3 problemas
para 0) e um foi recusado por voltar PIOR — 1 problema antes, 2 depois. Contra
o curso de 31/08, no mesmo tema e com a mesma configuração: lá foram três
reparos, de 17,9 a 36,0 s, um truncado, nenhum consertando nada, e os dois
módulos que repararam perderam quiz e imagem. Aqui saíram 8/8 imagens, 8/8
avaliações e nenhuma lição abaixo do mínimo de palavras.

O de `Doces da Vovó` é o primeiro gerado depois de os dois primeiros módulos
passarem a rodar em ordem. Levou 5min23s contra os ~2 min do paralelo total, e
saiu sem nenhum achado. O crédito não é da ponte: ela carregou ZERO valores
dele, porque o curso não enuncia nenhum número duas vezes. É registro de um
curso limpo, não prova de que o encadeamento resolveu.

O de transformação digital é o mais importante e o que menos parece. Sem ele, toda medição seria
feita só contra cursos problemáticos — que é a forma clássica de uma regra
parecer boa e não ser.

## A verdade de referência

O que é defeito e o que é diferença legítima está em
`../regressao-cursos-reais.test.ts`, ao lado de cada asserção, com o trecho do
curso que sustenta o julgamento. Ela foi apurada à mão, lendo o texto — não é
saída de ferramenta, e por isso pode estar errada; quando estiver, o lugar de
corrigir é lá, com a citação nova junto.

## Como usar

Rode a suíte. `regressao-cursos-reais.test.ts` avalia os cinco a cada mudança e
falha se uma regra passar a acusar o curso limpo, parar de achar uma contradição
verdadeira, ou promover a bloqueador uma diferença que é legítima.
