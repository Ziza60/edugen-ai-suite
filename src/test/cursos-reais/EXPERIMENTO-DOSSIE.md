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

## A decisão

**Passo 2 aprovado em 10/09/2026.** Os fundamentos, como foram dados:

- **pelo teste das contradições**: 6 de 6 contradições verdadeiras do acervo
  seriam prevenidas pela ficha;
- **pelo custo reversível**: a mudança é uma frase no prompt de planejamento;
- **com o critério de cobertura reprovando pela letra (58%) e passando com os
  derivados (72%)**. Os dois números ficam registrados. A trave não foi movida.

O que entrou no passo 2, e só isto:

1. a frase de `CASO CONDUTOR` em `buildStructurePrompt` passa a exigir os
   números-base do caso em `case_facts`, com composição onde couber, e a dizer em
   separado que fato do mundo continua proibido de inventar — as duas metades
   explícitas, para a confusão não voltar invertida;
2. a faixa pedida subiu de **8–12 para 10–16 fatos**. Justificativa medida: os
   valores compartilhados por curso vão de 6 a 35, mediana 12, e a ficha escrita
   à mão para a clínica precisou de 13. O teto do código (`asStringArray(..., 20)`)
   já é 20, então nada mais muda;
3. com fontes anexadas, os números do caso têm de sair das fontes — a regra de
   números antiga continua valendo nesse caminho, e a ficha não autoriza palpite
   sobre o negócio de quem anexou o documento.

Ponte, serialização, âncora, portão e despacho: intocados.

### Um segundo olho no prompt de módulo, sem mexer nele

O prompt de módulo já declara o dossiê como vinculante, em `INTEGRIDADE FACTUAL`:
*"Se houver caso condutor, use apenas os fatos do dossiê."* Hoje essa frase é
inobedecível — um dossiê sem números não permite obedecer — e o modelo a lê
frouxo, inventando 83% dos valores localmente.

Com a ficha numerada, ela passa a ser obedecível para as premissas. O risco é ela
ser lida ao pé da letra e **empobrecer os exercícios**, que legitimamente precisam
de cenários novos. Nada foi mudado ali de propósito: se o curso de teste voltar
com exercícios pobres, a causa é esta frase, e o conserto é de uma linha no
passo 2.5.

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
9. **algum reparo reintroduziu número fora da ficha?** `buildModuleRepairPrompt`
   (`:4095`) não recebe o dossiê, então um reparo reescreve a lição sem saber as
   premissas. As lições reparadas são nomeadas no log (`Reparo da lição X.Y:
   aceito`); a medição é conferir, nessas lições e só nessas, se apareceu valor do
   caso divergente da ficha. O conserto fica para o passo 2.5 — a medição começa
   neste curso, para o conserto entrar com número e não com suposição.

**Comparação:** contra `financas-clinica-sorriso-perfeito-2.md`, que é o gêmeo
sem ficha, gerado no mesmo dia em que a métrica acima foi escrita.

## RESULTADO: o passo 2 passou nos três itens

Curso de teste gerado depois do deploy do `4c02bad`, mesmo tema e mesmos
parâmetros dos dois anteriores. Está na bancada como
`financas-clinica-sorriso-saudavel-ficha.md`. O caso mudou de nome entre as
gerações — agora é `'Clínica Sorriso Saudável'`.

A primeira verificação foi feita pelo autor do projeto, sobre o `SELECT` do
blueprint, o log e o PDF. **A segunda opinião, exigida pelo `CLAUDE.md`, foi
feita depois, sobre o arquivo do curso, com regex escrita do zero e lendo as
frases onde cada grandeza é definida.** As duas concordam no essencial e
divergem na contagem bruta, por unidade de contagem:

| | autor (PDF) | contagem crua (arquivo) |
|---|---|---|
| faturamento R$ 60.000,00 | 45 menções | 44 ocorrências, 14 frases definidoras |
| custos fixos R$ 30.000,00 | 5 módulos | 65 ocorrências, 16 frases definidoras |
| equipamento R$ 80.000,00 | 48 menções | 51 ocorrências, 16 frases definidoras |

A divergência é de método, não de achado: o que importa não é quantas vezes o
número aparece, é se **algum** valor concorrente aparece. Nenhum aparece.

| item pré-registrado | gêmeo sem ficha | com ficha |
|---|---|---|
| 1. fatos com valor | **0 de 10** | **12 de 12** |
| 2. blueprint truncou? | — | não: `finish=stop`, 41,1 s, "restam 79s para 8 módulos" |
| 3. um valor por grandeza | faturamento 35.000 **e** 40.000 (mesmo módulo) | faturamento **R$ 60.000** em 45 menções |
| | custo fixo 12.000 **e** 10.000 | custos fixos **R$ 30.000** em 5 módulos |
| | equipamento 20.000, 45.000 **e** 80.000 | equipamento **R$ 80.000** em 48 menções, sem variante |

A ficha não veio só numerada: veio **internamente coerente**. A composição fecha
(5.000 + 15.000 + 8.000 + 2.000 = 30.000) e o faturamento é consistente com os
próprios fatos (ticket R$ 300 × 200 atendimentos = R$ 60.000). A instrução
"composição que não soma é defeito" foi obedecida.

O risco de truncamento com 10–16 fatos **não se materializou**.

### E o modelo não só repetiu a ficha — derivou dela

O aviso "Entradas R$ 73.500 ≠ R$ 60.000" é, no texto,
`73.500 = 60.000 + 13.500`, com `13.500 = 15.000 × 90%` — e os 90% saem da
ficha, que fixa 10% de atraso nos recebimentos. O curso fez aritmética a partir
das premissas em vez de inventar um número novo. É o comportamento que a ficha
pretendia produzir, e não estava entre os itens pré-registrados.

## RESULTADO: os sete avisos do laudo são TODOS falsos positivos

Conferidos um a um no texto, pelo autor:

| aviso | o que é no texto |
|---|---|
| custos variáveis 35% ≠ 40% | 40% = "Novos Custos Variáveis: 40% do faturamento adicional" — cenário de expansão (harmonização orofacial), rotulado como novo |
| custos fixos 30.000 ≠ 4.000 | 4.000 = "Novo Custo Fixo (Contratação Dentista)", mesmo cenário |
| "como o aumento" 20% ≠ 15% | 20% é a meta da ficha; 15% são "radiografias aumentaram 15%" e "aumento de 15% no custo dos materiais" — grandezas diferentes, e o rótulo é lixo de extração |
| faturamento 60.000 ≠ 25.200 | 25.200 = 35% × 72.000, custo variável do cenário projetado: conta certa, grandeza errada |
| Entradas 73.500 ≠ 60.000 | 73.500 = 60.000 + 13.500, com 13.500 = 15.000 × 90% derivado da ficha |
| Saídas | cenário de exercício distinto |
| Fluxo de Caixa | payback com fluxos anuais projetados; local por desenho |

**Zero contradição de premissa do caso.** O gêmeo sem ficha, no mesmo tema e com
o mesmo prompt, tinha dois faturamentos no mesmo módulo, dois custos fixos e três
preços de equipamento. A cadeia causal fechou nas duas direções: **sem número na
ficha, cada módulo inventa; com número, todos repetem e derivam.**

O que isso faz com o laudo é o argumento medido do passo 3. O portão agora
produz **só falso positivo** neste curso, porque compara valor contra valor sem
saber o que é premissa, o que é derivado e o que é cenário. Com a ficha como
gabarito, os sete se resolvem mecanicamente: 60.000 está na ficha; 25.200 é
35% × 72.000; 40% é valor novo nomeado como novo. O gabarito não é melhoria do
portão — é o que falta para o laudo voltar a ser legível.

### Os sete, reconferidos linha a linha no arquivo

Rodei `inspectCourse` no curso: ele reproduz os sete avisos exatamente, escore
94, zero bloqueador e **zero check reprovado fora de coerência**. Cada um,
conferido no texto por este lado:

| aviso | a frase no curso | veredito |
|---|---|---|
| custos variáveis 35% ≠ 40% | "Novos Custos Variáveis (**40% do faturamento adicional**)" | falso — rotulado como novo |
| Custos fixos 30.000 ≠ 4.000 | "**Novo Custo Fixo (Contratação Dentista)** \| R$ 4.000,00", e o curso soma: "34.000 = 30.000 + 4.000" | falso — e a conta está certa |
| "como o aumento" 20% ≠ 15% | m3 "radiografias externas aumentaram em 15%"; m8 "aumento inesperado de 15% no custo dos materiais"; m8 "\| Análise de Viabilidade \| **15%** \|" (peso de rubrica) | falso — três grandezas, e o rótulo é lixo |
| faturamento 60.000 ≠ 25.200 | "35% do novo faturamento projetado (R$ 72.000,00) = R$ 25.200,00" | falso — derivação explícita |
| Entradas 73.500 ≠ 60.000 | "Entradas de Caixa = R$ 60.000,00 + R$ 13.500,00 = R$ 73.500,00" | falso — derivação |
| Saídas 63.500 ≠ 61.000 | "Saídas = 30.000 + 21.000 + 2.500 + 10.000 = 63.500" e, sem financiamento, "= 61.000" | falso — dois cenários |
| Fluxo de Caixa (4 valores) | payback com fluxos anuais projetados | falso — cenários locais |

**7 de 7 falsos positivos, confirmados por duas leituras independentes.**

E a âncora da ponte, medida nos dois primeiros módulos: `'Clínica Sorriso
Saudável'` — o caso, com nome de três palavras. Terceira geração seguida em que
a âncora acerta.

### Uma classe nova de falso positivo: peso de rubrica

Um dos três "15%" é `| Análise de Viabilidade de Investimentos | 15% |` — **o
peso de um critério na rubrica de avaliação**, não um dado do caso. Tabela de
rubrica não é informação do negócio, e a exclusão é mecânica e de alta precisão.
Entra na lista de guardas do passo 3.

### O objeto passou a ser nomeado — e isso ninguém pediu neste passo

No gêmeo sem ficha, o equipamento era "um novo equipamento de diagnóstico por
imagem", sem nome e com três preços. Aqui ele é **"equipamento de raio-x
panorâmico"** em praticamente toda menção, com um preço só. A regra
`TODO NÚMERO DO CASO CARREGA O SEU OBJETO`, que estava no prompt desde 09/09 e
era medida como desobedecida, passou a ser obedecida quando a ficha deu o objeto
a que o número pertence.

Isso tem consequência para o passo 3: parte da dívida do rótulo pode se resolver
a montante, na geração, e não no extrator.

**E é um padrão, não um caso.** É a SEGUNDA regra de prompt deste projeto que só
passou a funcionar quando algo a montante forneceu o material de que ela
precisava:

| regra | quando entrou | por que não funcionava | o que a destravou |
|---|---|---|---|
| `O NOME DO CASO VEM ENTRE ASPAS` | 08/09 | funcionava desde o início; quem falhava era o reconhecedor, com teto de três palavras | o conserto do `NOME_CITADO_RE` (`dd13d83`) |
| `TODO NÚMERO DO CASO CARREGA O SEU OBJETO` | 09/09 | o modelo não tem como nomear o dono de um número que ele mesmo acabou de inventar | a ficha, que dá o objeto junto do valor |

A lição que as duas compartilham: **uma instrução de prompt que depende de
informação que o modelo não tem não é desobedecida — é inexecutável.** Medir sua
obediência antes de verificar se o insumo existe gasta medição e produz a
conclusão errada, que foi exatamente o que aconteceu no caso das aspas.

## Nota: o curso de 5 módulos no log

O log do deploy da ficha mostra um segundo curso, de 5 módulos, gerado ~4 minutos
antes. **Era do autor**: gerado sem intenção pelo modo simplificado da tela
inicial, que fixa 5 módulos, e refeito no modo completo com 8 para comparar com
os anteriores. Não há outra conta gerando curso no projeto. Item de segurança
encerrado.

O curso de 5 módulos fica guardado: é o único espécime do modo simplificado
gerado DEPOIS da ficha, e pode servir para medir se o dossiê numérico se comporta
igual num curso curto.

## MEDIDO: o estado do portão na bancada inteira, antes do passo 3

`inspectCourse` rodado nos 12 cursos (`__gabarito`, descartado depois de medir):

```
29 achados de coerência em 12 cursos
 0 nos dois cursos limpos (transformação digital, Doces da Vovó encadeado)
```

Por curso: Delícias 2 · Padaria do Bairro 2 · Pão Quente 1 · Sabor Caseiro 1 ·
Sabor da Vovó 2 · TechInov 2 · clínica-1 6 · clínica-2 3 · Doceria 5 ·
Finanças Inteligentes 5.

### Os rótulos dos 29 achados, lidos à mão

**Zero dos 29 nomeia o objeto a que o número se refere.** Nenhum diz de qual
item, produto, fornecedor ou investimento se trata:

```
Custo de Pedido · Custo de Manutenção · demanda média · tempo de ressuprimento
prazo de entrega · Lead Time · nível de serviço · estoque de segurança
Custos Fixos · Payback Investimento · Receita Bruta · Serviços Prestados
Receita Líquida · Lucro Líquido · Ativo Circulante · Custo Total Unitário
Margem de Contribuição · Custo Variável · Taxa Cartão · Despesas Fixas
preço de venda · custos variáveis · custos fixos
```

E **3 dos 29 (10%) não são nem grandeza**: `'Dra Ana'` (nome da pessoa),
`'________________ Saldo'` (campo em branco de formulário) e
`'equipe de marketing'` (quem sugeriu o preço, não o que foi medido).

Isso dimensiona a dívida do rótulo-pessoa com número: ela é real e é **10%**,
não o modo de falha dominante. O dominante é o rótulo que nomeia a grandeza e
não o objeto — 26 dos 29 —, e é exatamente ele que o gabarito dispensa, porque a
ficha nomeia o objeto e a comparação passa a ser contra a ficha.

### MEDIDO: os 20 achados lidos, um a um

Leitura autorizada e feita. Para cada um: o trecho que decide, o veredito, e se
um gabarito de ficha também o acharia.

| curso | achado | o que o texto diz | veredito | gabarito pega? |
|---|---|---|---|---|
| Delícias | Custo de Manutenção 0,50 ≠ 2,00 | 0,50/kg é do **açúcar cristal** ("10% do custo do kg"); 2,00 é "por unidade por ano" em exercício do m8 | falso | não |
| Padaria do Bairro | demanda média 100 ≠ 10 un | 100 é **bolo de Páscoa**; 10 é exemplo didático ("se a demanda mensal é 300 e o mês tem 30 dias") | falso | não |
| Padaria do Bairro | ressuprimento 3 ≠ 5 dias | **a mesma frase explica**: "normalmente de 3 dias, mas já houve casos de atraso, estendendo-se para 5" — média e máximo, usados como tal na fórmula | falso | não, se a ficha trouxer a faixa |
| Sabor da Vovó | nível de serviço 95% ≠ 100% | ambos em **alternativa de quiz e explicação de gabarito**: "próximo de 100%, a qualquer custo" / "100% é praticamente impossível" | falso | não |
| TechInov | Lead Time 15 ≠ 20 ≠ 5 dias | 15 é do fornecedor do 'Modelo X'; 20 é hipótese de procedimento ("**Se** o Lead Time for de 20 dias"); 5 é outro exercício no m3 | falso | não |
| TechInov | estoque de segurança 8 ≠ 55 un | 8 é **derivado** (1,645 × 1,5 × √10 ≈ 7,79) para o 'Smartphone Z'; 55 é outro cenário no m8 | falso | não |
| clínica-1 | Receita Bruta 300.000 ≠ 350.000 | 300.000 é o DRE atual; 350.000 é o **orçamento do próximo ano** | falso | não |
| clínica-1 | Serviços Prestados 90.000 ≠ 144.000 ≠ 200.000 | o m7 enuncia **dois "último DRE"** da mesma clínica: 144.000 e 200.000 | **VERDADEIRA** | sim |
| clínica-1 | "____ Saldo" 10.000 ≠ 25.000 | blocos 4 e 5 são **o mesmo módulo gravado duas vezes** — o portão comparou um módulo com a própria cópia | **artefato de gêmeo** | — |
| clínica-1 | Receita Líquida 285.000 ≠ 360.000 ≠ 500.000 | mesmos dois "último DRE" do m7 | **VERDADEIRA** | sim |
| clínica-1 | Lucro Líquido 95.000 ≠ 72.000 ≠ 100.000 | mesmos dois "último DRE" do m7 | **VERDADEIRA** | sim |
| clínica-1 | Ativo Circulante 130.000 ≠ 90.000 | 130.000 é calculado no m6; 90.000 vem com "**valores hipotéticos para fins deste exemplo**" | falso | não |
| Doceria | CTU 6,07 ≠ 1,50 ≠ 8,00 ≠ 12,00 | m2 calcula **6,075 para o brigadeiro**; m3 diz "**com base nos cálculos do módulo anterior**, o CTU de cada brigadeiro é de **R$ 1,50**" — e 1,50 é o **leite condensado** do m2. 8,00 (cupcake) e 12,00 (pudim) são outros produtos | **VERDADEIRA**, a mais grave do acervo | só com objeto |
| Doceria | Margem de Contribuição 4,11 ≠ 22,40 | 4,11 = 9,00 − 4,89 (brigadeiro); 22,40 = 40,00 − 17,60 (outro produto). Ambas derivadas e corretas | falso | não |
| Doceria | Custo Variável 9,00 ≠ 12,00 ≠ 4,00 | o 9,00 é o **Preço de Venda Sugerido**, que no texto vem imediatamente antes de "Custo Variável Unitário Total" — o extrator pegou o número do vizinho | falso | não |
| Doceria | Taxa Cartão 9,00 ≠ 40,00 ≠ 15,00 | 40,00 é o **PVU do bolo de cenoura**; 15,00 é a base em "Taxa de cartão = R$ 15,00 × 0,02 = R$ 0,30" — o extrator pegou o operando, não o resultado | falso | não |
| Doceria | Despesas Fixas 4.000 ≠ 3.200 | 3.200 vem como "**(ex: R$ 3.200,00)**", valor ilustrativo de um template de preenchimento | falso | não |
| Finanças | Margem de Contribuição 14,90 ≠ 15,00 | ambos no m1: 19,90 − **5,00** = 14,90 e 19,90 − **4,90** = 15,00. O CVU se contradiz, e as duas MCU são consequência | **VERDADEIRA** | sim |
| Finanças | custos fixos 25.000 ≠ 28.000 | **o texto soma na mesma frase**: "R$25.000 (salários) + R$3.000 (administrativos) = R$28.000" — parte e total | falso | não, com composição |
| Finanças | "equipe de marketing" 24,90 ≠ 29,90 | 24,90 é cenário de aumento no m2; 29,90 é o plano premium no m4 e a versão Family no m5 | falso | não |

### O placar que decide o desenho

Somando com os 9 que já tinham julgamento:

```
29 achados de coerência na bancada
 8 contradições VERDADEIRAS  (3 já apuradas + 5 achadas nesta leitura)
20 falsos positivos / diferenças legítimas
 1 artefato de gêmeo (classe extinta pelo índice único)

precisão da comparação entre pares: 8 em 29 = 28%
```

**Das 8 verdadeiras, o gabarito de ficha acha 7 sozinho.** A única que ele
perderia é a do brigadeiro — e por um motivo que importa: o valor errado
(R$ 1,50) **está na ficha**, como custo do leite condensado. Um gabarito que
pergunte apenas "este número está na ficha?" aprova a frase que chama o
componente de total. Ele precisa do **objeto**, não só do valor.

Isso é o requisito mais forte que esta leitura produziu, e nenhuma das análises
anteriores o tinha: **gabarito só de valor é fraco; gabarito de objeto+valor é o
que pega a contradição mais grave do acervo.**

### Os falsos positivos têm classes, e sete delas são mecânicas

| classe | achados | detectável sem ler? |
|---|---|---|
| valor ilustrativo de template — `(ex: …)` | 2 | sim |
| alternativa de quiz ou explicação de gabarito | 1 | sim |
| declarado hipotético ("valores hipotéticos para fins deste exemplo") | 1 | sim |
| parte × total, com a soma no próprio texto | 1 | sim |
| média × máximo, explicados na mesma frase | 1 | sim |
| período diferente (atual × orçamento do próximo ano) | 1 | sim |
| valor derivado, resultado de conta exibida | 2 | sim |
| peso de rubrica (achado na clínica-3) | 1 | sim |
| item, produto ou plano diferente | 6 | **precisa do objeto** |
| extrator pegou o número do vizinho ou o operando | 2 | **precisa do objeto** |

**9 dos 20 falsos positivos saem com guarda mecânica, sem perder nenhuma
verdadeira.** Os outros 11 precisam do objeto — que é exatamente o que a ficha
passou a fornecer e que o curso com ficha passou a nomear ("equipamento de
raio-x panorâmico").

### A decisão, com dado

**A comparação entre pares não sobrevive como está: 28% de precisão é o que
torna o laudo ilegível.** Mas ela também não deve morrer, por uma razão medida:
ela é o único caminho que achou a contradição do brigadeiro quando o gabarito
não existia, e três das cinco verdadeiras novas são **intra-módulo** (os dois
"último DRE" do m7), onde a comparação entre módulos chegou por acidente.

O desenho que a medição sustenta:

1. **gabarito de objeto+valor** como camada principal — acha 7 das 8;
2. **as sete guardas mecânicas** aplicadas antes de qualquer comparação — tiram
   9 dos 20 falsos sem custo;
3. **comparação entre pares como terceira camada, nunca bloqueador e rotulada
   como tal** — fica pelo caso do brigadeiro, com a precisão declarada no laudo.

O que eu NÃO recomendo é o que parecia óbvio antes de ler: desligar os pares. A
leitura mostrou que eles acham o que o gabarito de valor perde.

## Passo 3, primeira metade: as guardas, medidas

Implementadas em `_shared/guardas-do-caso.ts`, aplicadas **antes** do
agrupamento (excluir depois não serve: o valor guardado continuaria criando o
segundo grupo que faz o achado existir). Travadas em
`src/test/guardas-do-portao.test.ts`.

### O placar

```
                        antes      depois
achados de coerência       36          26
contradições verdadeiras    9           9
falsos positivos           26          16
artefato de gêmeo           1           0
precisão                  25%         35%
```

**10 falsos positivos removidos, nenhuma verdadeira perdida.** A previsão
registrada antes de medir era "remove 9, perde 0"; errou por um, para baixo.

Por curso, o que saiu: Custo de Manutenção (Delícias), tempo de ressuprimento
(Padaria do Bairro), nível de serviço (Sabor da Vovó), Receita Bruta + Saldo do
gêmeo + Ativo Circulante (clínica-1), Custo Variável + Taxa Cartão + Despesas
Fixas (Doceria), "como o aumento" (clínica-3).

Exclusões por guarda, em 1.519 grandezas da bancada: 215 (14%).
`periodo-projetado` 91 → 22 depois do aperto, `valor-de-exemplo` 42,
`faixa-declarada` 32, `alternativa-de-quiz` 20, `declarado-hipotetico` 13,
`condicional-hipotetica` 9, `operando-de-soma` 7, `peso-de-rubrica` 1.

### Três coisas que a medição consertou no caminho

**1. A guarda de "valor derivado" foi testada e REJEITADA.** Parecia a mais
obvia das nove — e apagaria a melhor evidência do acervo: a contradição
verdadeira do 'Pão Quente' tem `R$ 610,00 / 4 = R$ 152,50` de um lado. Nos dois
casos em que "derivado" parecia explicar o falso positivo (estoque de segurança
8 ≠ 55; MCU 4,11 ≠ 22,40), o que separava era o **objeto**, não a derivação.

**2. `periodo-projetado` nasceu cega.** A primeira versão aceitava `estima\w*`
e `projet\w*` soltos e disparou **91 vezes** — 43 só no curso com ficha, onde
"estimar" aparece em toda instrução de orçamento. Uma guarda que exclui 6% das
grandezas de um curso não é guarda, é cegueira. Apertada para marcador de
período explícito.

**3. `peso-de-rubrica` nasceu inerte, e eu quase a registrei como funcionando.**
A primeira versão exigia "rubrica", "critério" ou "peso" na própria linha — e
numa tabela de rubrica essas palavras estão no **cabeçalho**, que a oração não
carrega. Disparou UMA vez na bancada inteira. Agora detecta a *forma* da linha:
percentual sozinho numa célula, entre células de prosa.

### E uma reclassificação: eu errei o veredito do Finanças

Na tabela dos 20 eu classifiquei **"custos fixos R$25.000 ≠ R$28.000"** como
falso positivo, parte contra total, citando a frase do m1:

> "Os Custos Fixos Totais (CFT) são R$25.000 (salários) + R$3.000
> (administrativos) = R$28.000."

A guarda `operando-de-soma` **não disparou ali**, e foi investigar o porquê que
mostrou o erro: o R$25.000 do achado não vem dessa frase. Vem de outras duas,
assertivas, e o curso afirma o custo fixo mensal da MESMA empresa três vezes,
com três valores:

| módulo | frase | total |
|---|---|---|
| m1 | "salários dos 5 engenheiros (R$5.000 cada), totalizando R$25.000, e outras despesas administrativas fixas de R$3.000" | **R$ 28.000** |
| m3 | "salários dos 5 engenheiros (R$ 8.000 cada) … Salários (5 × R$ 8.000 = R$ 40.000) + Marketing Fixo (R$ 10.000)" | **R$ 50.000** |
| m5 | "Os custos fixos mensais (salários, aluguel) são de R$25.000" | **R$ 25.000** |

É **contradição verdadeira**, da mesma classe que a do custo variável que a
verdade de referência já registrava para este curso (5,00 ≠ 2,50 ≠ 4,90). E o
salário do engenheiro também muda: R$5.000 no m1, R$8.000 no m3.

Eu classifiquei lendo **uma** oração e parando. É exatamente o que a convenção
nova do `CLAUDE.md` manda não fazer — verificar o insumo antes de concluir —
aplicada a mim mesmo. As verdadeiras do acervo passam de 8 para **9**, e o
portão continua achando esta (o par 25.000 ≠ 28.000 sobrevive às guardas), ainda
que pelo ângulo errado: ele não cita os R$ 50.000 do m3.

### Um achado melhorou sozinho

O Lead Time da TechInov era `15 ≠ 20 ≠ 5 dias`; com as guardas virou
`15 ≠ 10 ≠ 20 ≠ 5 dias`. Os **10 dias** entraram porque as exclusões mudaram a
espécie dominante do grupo. O README registra desde 05/09 que a contradição
verdadeira daquele curso é 20/10/15 para o mesmo produto e que o portão **não
citava os 10**. Agora cita. Não foi projetado; foi efeito colateral, e está
registrado como tal.

## O gabarito: o que falta para medi-lo, e é bloqueante

O desenho aprovado é **objeto+valor**, e o caso de teste é o brigadeiro: o
R$ 1,50 existe na ficha como custo do leite condensado e tem de ser acusado
quando rotulado de Custo Total Unitário.

**O gabarito não pode ser medido na bancada hoje, por falta de ficha.** De 13
cursos, só um foi gerado com ficha numérica (`...-saudavel-ficha.md`), e o
`case_facts` dele não está no repositório — ele vive em
`courses.generation_blueprint`, no banco. Os outros 12 foram gerados antes do
passo 2 e não têm ficha nenhuma.

Sem ficha, o gabarito não tem com o que comparar e o placar
achados/perdidos/falsos dele é vazio. As três saídas, com o custo de cada uma:

1. **`SELECT` do `case_facts` do curso com ficha** — barato, e dá a medição do
   gabarito em 1 curso, incluindo se o pareamento erra contra uma ficha real;
2. **fichas escritas à mão para os cursos da bancada** — é o que permite medir o
   brigadeiro, e custa uma ficha por curso. A da clínica já está escrita neste
   documento; a da Doceria é a que o caso de teste exige;
3. **gerar 2–3 cursos novos com ficha** nos temas da bancada — mede de verdade,
   custa geração e tempo.

A 1 e a 2 juntas dão o caso de teste do brigadeiro e uma ficha real. Nenhuma das
três é decisão minha.

## O positivo limpo da aritmética

As cadeias do curso de teste, conferidas pelo autor, fecham todas:

Conferidas de novo deste lado, sobre o arquivo, **14 de 14 fecham**:

```
ficha: 5.000 + 15.000 + 8.000 + 2.000 .......... 30.000   (composição)
ficha: 300 x 200 ............................... 60.000   (ticket x atendimentos)
m1: 60.000 + 13.500 ............................ 73.500   (entradas)
m1: 15.000 x 90% ............................... 13.500   (os 90% saem da ficha)
m1: 30.000 + 21.000 + 2.500 + 10.000 ........... 63.500   (saídas)
m1: 73.500 − 63.500 ............................ 10.000   (saldo)
m2: 30.000 + 21.000 + 10.000 ................... 61.000   (cenário sem financiamento)
m2: 21.000 + 4.000 ............................. 25.000   (novos variáveis)
m2: 30.000 + 4.000 ............................. 34.000   (novos fixos)
m2: 60.000 x 35% ............................... 21.000
m6: 60.000 x 1,20 .............................. 72.000   (meta da ficha)
m6: 72.000 x 35% ............................... 25.200
m6: 72.000 − 25.200 ............................ 46.800
m6: 46.800 − 30.000 − 2.500 .................... 14.300
```

Note o que isso diz sobre a ficha: **dez das quatorze cadeias partem de um valor
da ficha.** A verificação de aritmética, com gabarito, deixa de conferir só a
conta e passa a conferir o insumo.

É o espécime de **não-acusar** que faltava para calibrar a verificação de
aritmética fora do domínio de estoque e preço: um curso de serviços, denso em
conta, com todas as cadeias corretas. Entra na medição silenciosa da aritmética
como controle negativo.

## Passo 2.5: o dossiê no reparo

Aprovado e feito junto com este registro, antes do próximo curso de teste.

`repairLesson` reescreve a lição inteira, números incluídos, e **não recebia a
ficha** — era o único caminho capaz de desfazer o que a ficha fixou, e roda
justamente nas lições que já tinham defeito. MEDIDO nos cursos de 08 e 09/09: de
19 reparos executados, 13 foram aceitos e reescreveram texto.

A ficha passa a entrar no prompt do reparo de lição e no do reparo de envelope
(onde `key_takeaways` também carrega número), com três regras: o número do caso
na lição corrigida é o da ficha ou conta explícita a partir dela; se a lição
atual contradiz a ficha, o reparo corrige **para a ficha** em vez de preservar o
que estava lá; e cenário local continua permitido, mas nomeando o objeto.

## O que NÃO se mexe até a medição mandar

A ponte, a serialização (`MODULOS_DA_PONTE = 2`), a âncora e o portão. O passo 2
é **só a frase do prompt de planejamento**. Se o dossiê numérico se confirmar, a
ponte e a serialização são as primeiras candidatas a sair — o ganho medido é de
~120 s por curso —, mas desligar a única prevenção existente no mesmo deploy em
que a substituta estreia deixaria o projeto sem par de comparação.
