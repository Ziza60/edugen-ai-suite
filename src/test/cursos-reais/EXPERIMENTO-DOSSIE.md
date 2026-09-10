# O dossiê do caso, com números

Registro pré-medição de uma mudança que ainda não foi feita. Segue o padrão do
`EXPERIMENTO-PONTE.md`: a métrica é escrita ANTES do curso de teste, para o
resultado não poder ser lido de um jeito conveniente depois.

## O que se propõe

Que os números-base do caso condutor sejam **ditados no planejamento** e
injetados no prompt de todos os módulos, em vez de emergirem módulo a módulo e
serem capturados depois pela ponte de valores.

## O canal já existe, e trafega vazio de números

Isto não é um subsistema novo. `buildCaseDossier`
(`_shared/course-pipeline.ts:2448`) já monta um bloco chamado literalmente
`DOSSIÊ CANÔNICO` a partir de `case_thread` e `case_facts`, que são campos
obrigatórios do `COURSE_BLUEPRINT_SCHEMA`. Ele é injetado em
`buildModulePrompt:2873`, **acima** da bifurcação `part === "envelope" | "lesson"`
— ou seja, chega aos 8 envelopes e às 24 lições.

O que o esvazia é uma frase no prompt de planejamento (`:2245`):

> "Preencha case_thread e 8 a 12 case_facts canônicos. **Não atribua resultados
> numéricos ao caso sem base permitida pela regra de números.**"

E a regra de números (`generate-course/index.ts:240`) proíbe "inventar
estatística, resultado de pesquisa, custo, preço ou prazo que você não conheça
com certeza".

A regra confunde duas coisas: **inventar um fato do mundo** — errar uma alíquota
é grave — e **fixar os números de um caso declaradamente fictício**, onde não há
o que errar porque a clínica não existe.

## MEDIDO: o dossiê real do curso de 09/09

`courses.generation_blueprint` do curso `1cf8d225`:

    fatos .................... 10
    com valor em R$ ........... 0
    com percentual ............ 0
    com qualquer algarismo .... 1   ("atua há 5 anos")

E o padrão dos fatos não é omitir a grandeza — é **nomeá-la e sonegar o valor**:

> "A clínica tem um **faturamento médio mensal estável**, mas os custos
> operacionais parecem crescer constantemente."
> "**Não há** um controle detalhado de **custos por procedimento**."
> "A precificação dos serviços é baseada nos **preços da concorrência**."
> "A **inadimplência** dos pacientes é uma preocupação."
> "Gostaria de adquirir um novo equipamento de diagnóstico por imagem, mas não
> sabe como planejar o **investimento**."

Cinco dos dez fatos apontam para uma grandeza financeira e não dão o número
(julgamento à mão, lendo os dez). O efeito é o pior possível: garante que todo
módulo vai precisar do valor e que nenhum vai recebê-lo.

### A cadeia causal, fechada num curso só

| fato do dossiê | o que os módulos fizeram |
|---|---|
| "faturamento médio mensal estável" | m4 linha 843: **R$ 35.000,00** · m4 linha 1060: **R$ 40.000,00** |
| "não há controle de custos" | m3: custo fixo **R$ 12.000,00** · m4: **R$ 10.000,00** |
| "adquirir equipamento de imagem" | m4 l.845: **R$ 20.000,00** · m4 l.915: **R$ 45.000,00** · m7 (5×): **R$ 80.000,00** |

O equipamento é o caso mais grave e o portão **não o apontou**: três preços para
o mesmo objeto nomeado, dois deles no mesmo módulo, 70 linhas de distância. O
portão apontou R$ 70.000 ≠ R$ 35.000, que são dois investimentos DIFERENTES —
errou nas duas direções.

O faturamento também se contradiz **dentro do módulo 4**, onde a comparação
entre módulos da ponte não chega por construção.

## MEDIDO: quanto de um curso uma ficha pode legitimamente governar

Contagem crua com regex escrita do zero, sem compartilhar código com o extrator,
sobre os 12 cursos da bancada:

    964 valores numéricos distintos
    166 (17%) aparecem em 2+ módulos   ← o que a coerência do caso disputa
    798 (83%) vivem num módulo só      ← exercício local, e devem continuar livres

Uma ficha que tentasse conter tudo teria ~80 números por curso. A faixa certa é
a dos compartilhados: 6 a 35 por curso, mediana 12 — que é exatamente os "8 a 12
fatos" que o prompt já pede.

### O teto da ponte, medido

Dos 166 compartilhados, só **59 (36%)** aparecem pela primeira vez nos módulos 1
ou 2 — tudo o que `MODULOS_DA_PONTE = 2` alcança, já que os módulos 3 a 8 partem
juntos e não se vêem. Os outros 107 (64%) nascem no módulo 3 ou depois e são
estruturalmente invisíveis para a ponte.

**36% é o teto da ponte. A ficha cobre 100% por construção**, porque é escrita
antes de qualquer módulo existir.

## MEDIDO: a ficha à mão, em três cursos

Classificação à mão dos valores compartilhados de três cursos de domínios
diferentes. O julgamento é meu, lendo o contexto de cada valor; pode estar
errado, e o lugar de corrigir é aqui.

| | clínica | estoque | preço | total |
|---|---|---|---|---|
| valores em 2+ módulos | 22 | 22 | 13 | **57** |
| a ficha seria dona | 14 | 14 | 5 | **33 (58%)** |
| derivados da ficha por conta explícita | 2 | 3 | 3 | **8 (14%)** |
| parâmetro da disciplina ou cenário de exercício | 2 | 5 | 5 | **12 (21%)** |
| contradição que só existe por falta de ficha | 4 | 0 | 0 | **4 (7%)** |

O critério que eu havia escrito antes de medir era "se cobrir menos de ~70% dos
compartilhados, a tese está fraca". Pela letra, **58% e reprova**. Contando o que
a ficha governa direta ou aritmeticamente (33 + 8 = 41), **72% e passa**.

Registro os dois números porque mover a trave depois de ver o resultado é
exatamente o vício que esta bancada existe para impedir. O leitor decide.

### O teste que vale mais que a porcentagem

Das contradições VERDADEIRAS conhecidas do acervo, quantas são valores que a
ficha seria dona?

| curso | contradição verdadeira | é valor de ficha? |
|---|---|---|
| Pão Quente | Custo de Pedido R$ 185,00 x R$ 50,00 | sim |
| Finanças Inteligentes | CVU R$ 5,00 x R$ 4,90 (e os dois MCU que saem dali) | sim |
| TechInov | Lead Time 20 x 10 x 15 dias, mesmo produto | sim |
| Clínica (09/09) | faturamento 35.000 x 40.000 | sim |
| Clínica (09/09) | custo fixo 12.000 x 10.000 | sim |
| Clínica (09/09) | equipamento 20.000 x 45.000 x 80.000 | sim |

**Seis de seis.** Nenhuma contradição verdadeira do acervo é sobre um número de
cenário local. Todas são sobre uma premissa do caso — e premissa do caso é
precisamente o que uma ficha fixa.

## A ficha escrita à mão para o curso da clínica

O que o planejamento teria de produzir, a partir do mesmo `case_thread`:

    - Faturamento médio mensal: R$ 40.000,00
    - Custos fixos mensais: R$ 12.000,00 (aluguel R$ 3.000,00; salários
      administrativos R$ 5.000,00; energia, água e internet R$ 2.000,00;
      contabilidade R$ 1.000,00; outros R$ 1.000,00)
    - Despesas fixas mensais: R$ 3.000,00 (contabilidade e marketing fixo)
    - Custo indireto mensal: R$ 5.000,00
    - Depreciação mensal de equipamentos (não desembolsável): R$ 500,00
    - Comissão de dentistas parceiros: 20% da receita do procedimento
    - Margem de lucro padrão na precificação: 30%
    - Saldo de caixa operacional diário típico: R$ 1.500,00
    - Consulta: preço R$ 250,00
    - Clareamento: gel R$ 50,00; barreira gengival R$ 10,00
    - Equipamento de diagnóstico por imagem pretendido: R$ 80.000,00
    - Prazo médio de pagamento a fornecedores: 30 dias
    - Crescimento de pacientes no último ano: 5%

Treze fatos, **980 caracteres ≈ 245 tokens**. Sobre a parte estática do prompt
de módulo (6.376 chars ≈ 1.594 tokens), **+15%**. Em 32 chamadas por curso (8
envelopes + 24 lições), ≈ 7.800 tokens de entrada a mais. Em tempo, zero — é
entrada, não saída, e não há chamada nova.

## O risco que a medição tem de vigiar

Não é tamanho de prompt. É **truncamento do blueprint**. O prompt de
planejamento tem uma seção "TAMANHO — RESTRIÇÃO RÍGIDA" que existe porque
respostas longas eram cortadas no meio, e o `COURSE_BLUEPRINT_SCHEMA` já teve
`maxItems` removido para o autômato não explodir (152.992 → 364 estados, medido
no comentário do código). Engordar `case_facts` empurra exatamente nesse limite.

Segundo risco: `buildModuleRepairPrompt` (`:4095`) **não recebe o dossiê**. Um
reparo pode reintroduzir um número fora da ficha. É uma linha de conserto, mas
só depois de a ficha existir.

## Métrica pré-registrada do curso de teste

Mesmo tema e parâmetros dos dois cursos de clínica — o terceiro gêmeo.

**Do lado do planejamento:**
1. quantos `case_facts` vieram, e quantos carregam valor em R$ ou percentual;
2. o blueprint truncou? (`finish=length` na chamada de estrutura);
3. tempo da fase 1.

**Do lado do curso:**
4. dos valores da ficha, quantos aparecem no curso com o valor da ficha;
5. quantos aparecem com valor DIFERENTE da ficha — desobediência, o número que
   decide se o gabarito vale a pena;
6. o faturamento mensal é único no curso inteiro? o custo fixo? o equipamento?
7. valores compartilhados entre módulos que NÃO estão na ficha — a terceira
   categoria que hoje não existe: número que um módulo tardio reusa sem
   autorização;
8. o laudo do portão: quantos achados, quantos verdadeiros.

**Comparação:** contra `financas-clinica-sorriso-perfeito-2.md`, que é o gêmeo
sem ficha, gerado no mesmo dia em que a métrica acima foi escrita.

## O que NÃO se mexe até a medição mandar

A ponte, a serialização (`MODULOS_DA_PONTE = 2`), a âncora e o portão. O passo 2
é **só a frase do prompt de planejamento**. Se o dossiê numérico se confirmar, a
ponte e a serialização são as primeiras candidatas a sair — o ganho medido é de
~120 s por curso —, mas desligar a única prevenção existente no mesmo deploy em
que a substituta estreia deixaria o projeto sem par de comparação.
