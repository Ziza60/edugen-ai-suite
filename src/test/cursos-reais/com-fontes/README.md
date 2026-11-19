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
