# Curso gerado A PARTIR DE FONTES, com as fontes ao lado

Este é o primeiro registro da bancada em que o curso **e os documentos que o
originaram** estão juntos. Até aqui todos os 14 cursos da bancada foram gerados
sem fontes (`useSources: false`), o que deixou duas mudanças sem como medir:

- o corte proporcional de `numerosSemFonte` (o limiar de 0,5);
- a mudança de `validateModuleDocument` para olhar o corpus completo.

## Os arquivos

| arquivo | o que é |
|---|---|
| `auditoria-planejamento-issai.md` | curso de 7 módulos gerado em 19/11/2026 |
| `fonte-1-introducao.txt` | 1ª fonte anexada — 38.605 caracteres |
| `fonte-2-manual-cap4.txt` | 2ª fonte anexada — 93.537 caracteres |

As fontes são os dois capítulos do *Manual de auditoria operacional, 4ª edição*
(TCU), extraídos com `pdftotext -layout` dos mesmos PDFs enviados ao app. O
texto aqui é o da extração, não o que o app extraiu: o app converte o PDF no
navegador antes de enviar, então os dois podem divergir em espaçamento. Para
comparar conteúdo isso serve; para reproduzir a extração do app, não.

## Por que está num subdiretório

O placar travado em `guardas-do-portao.test.ts` varre `cursos-reais/*.md` e
exige que o total de achados de coerência fique em **32**. Um curso novo na
pasta plana muda esse número, e a convenção do projeto é que o placar só se
mexe depois de classificar achado por achado — verdadeiro ou falso — em
`EXPERIMENTO-DOSSIE.md`.

Esse trabalho não foi feito. O `readdirSync` da bancada não é recursivo, então o
curso fica guardado, disponível para quem for medir, sem mover um número que
ninguém auditou ainda.

## O experimento que este curso fechou

**Hipótese registrada em 18/11:** se a fonte definir os quatro critérios de
auditoria (economicidade, eficiência, eficácia, efetividade), o curso passa a
ensiná-los.

O curso de 18/11 foi gerado com um capítulo só. Resultado: 221 menções aos
quatro critérios e **zero definições** — porque aquele capítulo os nomeia e não
define nenhum, e a regra de fontes proíbe importar o que não está no documento.

Em 19/11 o mesmo pedido foi feito com os dois capítulos. A `fonte-1` traz a
seção `1.3 PRINCIPAIS CONCEITOS`, com uma subseção e uma citação normativa por
critério (`1.3.1 ECONOMICIDADE`, GUID 3910/38; `1.3.2 EFICIÊNCIA`, GUID 3910/39;
`1.3.3 EFICÁCIA`; `1.3.4 EFETIVIDADE`, GUID 3910/42).

**Resultado: hipótese confirmada.** O curso ganhou a lição `1.2 Auditoria
Operacional: Conceitos e Os '4 Es'`, com uma subseção de definição por critério
e uma seção de inter-relações. A lacuna era da fonte, não do gerador.

## O segundo defeito, relatado por quem usou, e o resultado do conserto

**Relatado em 19/11:** ao anexar os dois documentos, o app preencheu o título de
forma abrangente, como se o curso cobrisse todas as fases da auditoria, e o tema
afirmou que iria ALÉM do planejamento — promessa que as fontes não sustentam.
Título e tema tiveram de ser corrigidos à mão.

Causa dupla: `analyze-pdf-source` analisava cada documento sozinho ("desenhe um
curso a partir deste documento"), e o formulário usava `analises[0]` — o
primeiro escolhido, que era o dos conceitos gerais.

**Conserto:** cada análise declara os documentos já analisados, o prompt exige
escopo do conjunto com a regra de não prometer cobertura ausente, e o formulário
usa a última análise — a única que conheceu todos. O tamanho em caracteres de
cada documento vai no prompt como contrapeso (93.537 do planejamento contra
38.605 dos conceitos gerais).

**MEDIDO no mesmo upload, depois do conserto:**

| campo | antes | depois |
|---|---|---|
| título | abrangente, todas as fases | `Auditoria Operacional no Setor Público: Fundamentos e Planejamento Estratégico` |
| tema | afirmava ir além do planejamento | escopo em framework normativo, análise preliminar, estratégia e plano |
| público-alvo | — | `...na fase de planejamento de auditorias operacionais` |

A delimitação apareceu sozinha, sem edição. Nenhuma menção a execução, coleta de
evidência, relatório ou monitoramento — as fases que os documentos não cobrem. O
público-alvo nomeia a fase explicitamente, que é a regra do prompt agindo.

Imprecisão que sobrou: o título diz "Planejamento Estratégico", expressão que em
português puxa para planejamento estratégico de organização. A fonte trata da
FASE de planejamento de uma auditoria, que inclui a Estratégia Global de
Auditoria. Não é promessa falsa de cobertura; é escolha de palavra.

## O defeito que este curso revelou

22 ocorrências de identificador interno de trecho (`S2:C34`) no corpo das
lições — o modelo repetindo o `id` que recebe em `<SOURCE id="...">`. Em 18/11
havia 98; eu consertei a seção de referências, onde o pipeline os imprimia, e
encerrei o caso sem verificar se o modelo também os escrevia.

Cinco das 22 dividem o parêntese com uma citação normativa real, como
`(ISSAI 3000/35, S2:C15)`. Apagar só o código deixaria a vírgula órfã; apagar o
parêntese levaria a ISSAI. `semCodigosDeTrecho` em `markdown.ts` desmonta o
parêntese item por item, e `codigos-de-trecho.test.ts` mede isso contra estes
recortes literais.
