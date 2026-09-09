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
| `preco-doceria-sabor-de-infancia.md` | 'Doceria Sabor de Infância' | 5 | arredondamento LIMÍTROFE e `≈`; amostra do `<br>` antigo |
| `estoques-padaria-delicias-do-bairro.md` | 'Padaria Delícias do Bairro' | 8 | **caso de QUATRO palavras**, que o reconhecedor não via |
| `financas-clinica-sorriso-perfeito.md` | 'Clínica Sorriso Perfeito' | 8 pedidos, 10 gravados | **fora do domínio**; o curso que saiu DUPLICADO, e o caso RENOMEADO entre os módulos 1 e 2 |
| `financas-clinica-sorriso-perfeito-2.md` | 'Sorriso Perfeito' | 8 | o MESMO pedido depois do conserto: 8 módulos, 1 portão; e **o rótulo sem objeto, duas vezes** |

O `...-2.md` é o mesmo pedido — clínica odontológica, 8 módulos, Treinamento
Completo, Profissional — rodado depois do conserto da duplicação, e serve de
par controlado com o primeiro. O que mudou, medido nos dois logs:

    módulos gravados ........... 10  →  8      (8 títulos distintos)
    course-module-done ......... 12  →  7 na janela, 7 execution_ids distintos
    course-quality-gate-done ....  5  →  1
    descartado ................. campo não existia  →  false em 7/7
    effort=medium ...............  0  →  0
    âncora da ponte ............ 'Custo Variável'  →  'Sorriso Perfeito'

A âncora acertar aqui NÃO é crédito do conserto: este curso cita
`'Sorriso Perfeito'` 166 vezes, na mesma forma de duas palavras, presente nos
dois primeiros módulos. O defeito da renomeação (ver o curso anterior) não
reapareceu porque o modelo não renomeou, não porque alguém tenha consertado.
Pela mesma razão, a corrida de despacho não foi exercitada: só o módulo 2
liberou os seis seguintes (uma linha `liberou`, não duas), então nenhum worker
precisou descartar. A garantia aqui é o índice único, medido em Postgres — não
este curso.

**O rótulo sem objeto, duas vezes no mesmo laudo.** Das três grandezas que o
portão apontou, uma é verdadeira e duas são a mesma falha de rótulo:

| apontado | veredito |
|---|---|
| Custos Fixos: R$ 12.000 (m3) ≠ R$ 10.000 (m4) | **VERDADEIRA** — Dra. Ana Paula, 'Sorriso Perfeito', custo fixo mensal, dois valores |
| ... ≠ R$ 126.000 (m4) | falso — é 10.500 × 12, a projeção ANUAL |
| 'Dra Ana': 7% (m4) ≠ 50% (m7) | falso — 7% é crescimento de receita, 50% é ROI; o rótulo é o NOME DA PESSOA |
| 'Payback Investimento': R$ 70.000 (m7) ≠ R$ 35.000 (m8) | falso — digitalização de prontuário vs. equipamento odontológico |

Um acerto em três, e as duas falhas têm causa única: **o rótulo não carrega o
objeto**. `'Dra Ana'` como grandeza é o caso extremo — o extrator pegou o nome
de quem age no caso e o usou como nome do que é medido. O módulo 7 sozinho tem
três investimentos diferentes (R$ 80.000 em aparelho de imagem, R$ 70.000 em
digitalização, R$ 35.000 em curso e marketing), e nenhum rótulo os distingue.

A regra do prompt que pede o objeto junto do número ("TODO NÚMERO DO CASO
CARREGA O SEU OBJETO") está no lado da geração; do lado do rótulo, o extrator
ainda não olha para isso.

O da `Clínica Sorriso Perfeito` é o primeiro curso da bancada fora de estoque e
preço, e o único gravado com defeito de infraestrutura. Ele está aqui verbatim,
com os dois módulos repetidos, porque é a evidência.

**O que ele expôs, primeiro: o claim que nunca recusava ninguém.**
`claim_course_generation_job` era `returns course_generation_jobs` — um
registro, não `setof`. Sem linha casada, uma função SQL assim devolve UMA linha
de colunas nulas, que o PostgREST entrega como `{"id": null, …}` — truthy em
JavaScript. O `if (!claimed)` do worker nunca disparou. Com `MODULOS_DA_PONTE =
2`, os módulos 1 e 2 terminam quase juntos e cada um abre a porta para os seis
seguintes: 12 workers para 6 jobs, todos iniciados dentro de 145 ms, todos
rodando até o fim. Medido no log: 12 `course-module-done` para os índices 2 a 7,
11 execution_ids (um isolate serviu duas requisições), 5 execuções do portão, e
`claim_ms` de 613, 679 e 722 ms em três dos seis pares — a espera de lock que
prova que os dois miravam a MESMA linha. Reproduzido em Postgres 16.13 e
consertado em `reivindicou` (`_shared/course-dispatch.ts`) e na migração
`20260908220000`.

**O que ele expôs, segundo: o caso muda de nome entre um módulo e o outro.**
Contagem crua no texto, por bloco:

    módulo 1 ... 'Clínica Odontológica Sorriso Perfeito' 18 | 'Clínica Sorriso Perfeito'  0
    módulo 2 ... 'Clínica Odontológica Sorriso Perfeito'  0 | 'Clínica Sorriso Perfeito' 30

Nenhuma das duas formas aparece nos DOIS blocos, e `identificarCaso` exige
`minFontes = 2`. Sobra 'Custo Variável' (4 e 7), que está nos dois. A âncora que
a ponte usa quando o módulo 3 começa é **'Custo Variável'** — jargão da
disciplina de novo, pela terceira vez, e desta vez sem culpa do teto de palavras:
o nome de quatro palavras foi reconhecido, só não em dois blocos.

No curso inteiro o reconhecedor acerta (`'Clínica Odontológica Sorriso
Perfeito'` em primeiro), o que confirma que o problema é a janela de dois
módulos, não o extrator não enxergar o nome. `'Sorriso Perfeito'`, a forma curta
que está em TODOS os dez blocos, resolveria — mas ela nunca aparece sozinha
entre aspas nos módulos 1 e 2, então não chega a ser candidata.

O de `Padaria Delícias do Bairro` é o curso que expôs o teto de palavras do
reconhecedor. O nome aparece citado 141 vezes — 41 nos dois primeiros módulos —
e `NOME_CITADO_RE` aceitava no máximo três palavras, então devolvia lista vazia
e a ponte levava ZERO num curso que cita o caso em toda página.

Ele também é o caso em que eu errei o diagnóstico: procurei 'Padaria Delícias'
no texto, não achei entre aspas, e conclui que o modelo tinha ignorado a
instrução do prompt. O modelo obedeceu; quem falhou foi o reconhecedor — e o
script com que eu medi usava o MESMO regex do código, então confirmou o erro em
vez de expô-lo.

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

## Duas contagens, sempre

Ver `CLAUDE.md`, na raiz. Toda medição feita aqui produz duas contagens: a do
instrumento e uma contagem crua independente (`grep`, `str.count`). Se
divergirem, o instrumento está sob suspeita.

A regra nasceu de um erro: um script de diagnóstico copiou o regex do próprio
código que estava sendo avaliado, herdou a mesma cegueira e confirmou uma
conclusão errada sobre o curso da 'Padaria Delícias do Bairro'.

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

## Dívidas anotadas contra estes cursos

**`decision_map ausente` — o reparo não conserta.** Três recusas seguidas na
mesma classe, em três cursos diferentes:

| curso | lição | resultado |
|---|---|---|
| 06/09 Sabores da Vovó | 3.3 | recusado — 3 → 4 (351 → 351 palavras) |
| 08/09 Doces da Vovó | 8.1 | recusado — 1 → 2 (582 → 582 palavras) |
| 09/09 Padaria Delícias | 8.1 | recusado — 1 → 2 (589 → 589 palavras) |
| 09/09 Clínica Sorriso Perfeito | 2.3 | recusado — 3 → 3 (392 → 392 palavras, 2 → 2 blocos) |

O padrão é sempre o mesmo: pede-se um `decision_map`, o modelo devolve a lição
com o MESMO número de palavras e de blocos, e a régua conta o mesmo número de
problemas ou MAIS. Quatro vezes em quatro cursos diferentes é padrão, não azar —
o reparo não sabe acrescentar um bloco de tipo específico, só reescrever o que
existe.

O quarto caso é o mais limpo dos quatro: 392 palavras antes, 392 depois; 2
blocos antes, 2 depois; 3 problemas antes, 3 depois. O modelo gastou 23,8 s para
devolver a mesma lição.

A recusa está certa: sem ela essas quatro lições teriam ficado piores ou iguais.
Mas o
defeito que a disparou continua no curso, e nenhuma das três foi corrigida. Não
está consertado nem investigado; fica registrado para quando a frente do reparo
reabrir.
