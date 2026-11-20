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
| `auditoria-3-de-7-modulos.md` | o curso 30305a65: 7 pedidos, **3 entregues** |
| `auditoria-3-de-7-modulos-log.csv` | o log da função para esse curso |
| `fonte-1-introducao.txt` | 1ª fonte anexada — 38.605 caracteres |
| `fonte-2-manual-cap4.txt` | 2ª fonte anexada — 93.537 caracteres |

O par curso + log é o primeiro registro em que os dois existem lado a lado, e é
o que permitiu separar "a estrutura planejou menos" de "os módulos foram
descartados depois".

## O terceiro defeito: 7 módulos pedidos, 3 entregues

MEDIDO no log de `auditoria-3-de-7-modulos-log.csv`:

```
course-module-done ..... índices 0, 1 e 6, descartado=false
"Módulo 3 falhou: Módulo 4 sem conteúdo entregável:
 Placeholder detectado no Markdown final."   ← 17:26:56, 17:28:41, 17:30:06
```

Os sete objetivos do curso (CO1..CO7, na visão geral) provam que o blueprint
tinha 7 módulos, e as sete séries de lições aparecem no log. Entregues: 1, 2 e
7. Perdidos: 3, 4, 5 e 6. O módulo de índice 3 queimou as três tentativas no
mesmo bloqueio.

**O que o log NÃO diz:** o que aconteceu com os índices 2, 4 e 5. A janela
exportada vai de 17:25:32 a 17:30:06 e a geração começou antes — não há `done`
nem `falhou` para eles. Fica em aberto até alguém exportar a janela inteira.

**O que não dá para medir com este arquivo:** qual dos treze padrões de
placeholder casou. O markdown do módulo reprovado não existe em lugar nenhum —
só os três que passaram estão aqui. Eu levantei a hipótese de `resposta
esperada` ou `criterio de avaliacao \d+`, legítimos num curso que ensina
critérios de auditoria, rodei o detector contra os 15 cursos reais do acervo e
nenhum reprova. A medição não valeu nada: os 15 são justamente os que passaram.
Viés de sobrevivência.

Daí os três consertos de 19/11: a mensagem passa a dizer qual padrão e o trecho
em volta; o log passa a dizer o número do módulo nas duas bases e a tentativa;
e na última tentativa o bloqueio desce para ressalva e o módulo é gravado.

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

## O experimento das cláusulas distintivas, fechado em 20/11/2026

**Hipótese registrada em 19/11**, depois de o usuário — auditor — dizer que a
perda "importa muito": se o prompt exigir que a definição conserve as cláusulas
que distinguem o termo dos vizinhos, elas voltam.

**Critério escrito antes do teste:** a definição de eficácia tem de conter
"independentemente dos custos", e a de eficiência, "mantidos os padrões de
qualidade".

| | 18/11 | 19/11 | 20/11, com a regra |
|---|---|---|---|
| eficácia: independentemente dos custos | ausente | ausente | **presente, 2x** |
| eficiência: padrões de qualidade | ausente | ausente | **presente** |
| economicidade: qualidade | ausente | presente | **presente** |
| efetividade: causalidade | ausente | presente | **presente** |

E as cláusulas estão NA DEFINIÇÃO, não espalhadas pelo texto:

```
eficácia ....... "grau de alcance das metas programadas em termos de produtos
                  e resultados imediatos, independentemente dos custos
                  implicados"
eficiência ..... "relação entre produtos obtidos e insumos empregados ...,
                  mantendo os padrões de qualidade"
economicidade .. "a preços competitivos, sem comprometer os padrões de
                  qualidade e os prazos estabelecidos"
```

**Hipótese confirmada.** Duas de duas cláusulas recuperadas na primeira geração
depois do deploy. Um curso não é uma taxa, e a regra segue sendo instrução de
prompt sem verificação determinística — mas o critério era específico, foi
escrito antes, e foi cumprido.

`auditoria-definicoes-fieis.md` é o registro. MEDIDO nele:

```
módulos 6, objetivos 7     CO1 e CO2 no módulo 1, por desenho — nada perdido
citações normativas        8 de 8 existem nas fontes, 0 inventadas
caso fictício              175 menções no curso, 0 nas fontes, rotulado 6x
códigos S<n>:C<nn>         0
palavras partidas          0
(nota N) pendurado         0      ← a ocorrência de 19/11 não repetiu
tags <br>                  0
valores monetários         0      percentuais 4
estrutura                  6/6 módulos com pontos-chave, questão e referências
escopo                     nenhum módulo ou lição ensina fase ausente das fontes
```
