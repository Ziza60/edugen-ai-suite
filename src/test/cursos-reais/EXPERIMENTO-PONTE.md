# Experimento da ponte de valores — métrica fixada antes da primeira geração

Este arquivo foi escrito e commitado **antes** de qualquer curso do experimento
ser gerado. É proposital: sem a métrica fixada, eu escolho depois o recorte que
confirma o que eu já acho. Já aconteceu neste projeto — três regras pareceram
óbvias no papel e morreram na medição.

Se a métrica precisar mudar depois de os cursos existirem, a mudança entra aqui
com a data e o motivo, e o resultado anterior **não** é descartado em silêncio.

## A pergunta

A ponte de valores lê o que os módulos 1 e 2 gravaram e injeta os números do
caso condutor no prompt dos módulos seguintes. É a única PREVENÇÃO contra o
curso se contradizer; o portão de qualidade é detecção, chega depois.

**Ela previne alguma coisa?** Hoje não há resposta. O 'Doces da Vovó' saiu limpo
carregando ZERO valores, e o 'Sabor Caseiro' carregou oito e ainda produziu um
achado (falso). Nenhum dos dois separa a hipótese da sorte.

## Por que não é um A/B de cursos

A taxa base de contradição verdadeira nos cursos da bancada é **2 em 4**
(Pão Quente e Finanças Inteligentes têm; Delícias e Sabor da Vovó só têm
diferenças legítimas). Com 50% de base, distinguir 50% de 25% exigiria dezenas
de cursos por braço, a ~5 min e crédito de IA cada.

Mesmo o resultado ideal de um 3 contra 3 — 2/3 contra 0/3 — dá p ≈ 0,2. Não
conclui nada. **Um curso rende 1 observação; os valores rendem dezenas.** A
unidade de observação aqui é o VALOR, não o curso.

## Os dois braços

| braço | `MODULOS_DA_PONTE` | ponte carrega | duração esperada |
|---|---|---|---|
| **A (controle)** | `0` | nada — todos os 8 módulos em paralelo | ~110 s |
| **B (tratamento)** | `2` | módulos 1 e 2 | ~192 s |

Com `0`, `podeDespachar` devolve `true` para todo mundo e a consulta da ponte
volta vazia em todos os módulos: é a ponte desligada, não enfraquecida.

Condições que não podem ser relaxadas:

1. **Mesmo tema e mesma configuração** nos dois braços: `Gestão de Estoques para
   Pequenas e Médias Empresas`, público profissionais, nível básico, resultado
   **treinamento completo**, tom **profissional**, 8 módulos, densidade
   **Padrão**, quizzes + flashcards + imagens ligados.
2. **Rodados em seguida, no mesmo dia.** O modelo muda entre dias, e uma
   diferença de dia vira uma diferença de braço.
3. **Alternar a ordem**: A, B, B, A. Se todos os A vierem antes, qualquer
   deriva do provedor durante a sessão vira efeito.
4. Mínimo de **2 cursos por braço**; 3 se o resultado ficar ambíguo.

## A unidade de observação

Uma **grandeza do caso condutor**: um par (item, medida) enunciado com número em
algum módulo — `farinha / prazo de entrega`, `estoque médio / valor`,
`custo de armazenagem / percentual`.

Uma grandeza só entra na contagem se for **reenunciada com número em pelo menos
um módulo posterior**. Grandeza dita uma vez só não pode se contradizer e não
informa nada sobre a ponte.

Cada par (grandeza, reenunciação posterior) é **uma observação**, classificada
em exatamente uma de três:

- **CONSISTENTE** — mesmo número, ou número derivado por conta explícita no
  texto (`R$ 30.000 / R$ 5.000 = 6 vezes` conta como consistente com
  `R$ 5.000`).
- **DIVERGENTE** — número diferente para o **mesmo item**, sem o texto explicar
  a mudança.
- **ITEM DIFERENTE** — número diferente para item, fornecedor ou momento
  distintos. Não é defeito. É o caso do `prazo de entrega` do Sabor Caseiro:
  3 dias do açúcar, 2 dias do Fornecedor B, 4 dias da farinha negociada.

- **COLADO NO ITEM ERRADO** — mesmo número, item diferente, e o texto afirma
  continuidade que não existe. **Conta como defeito, e conta contra a ponte.**

A terceira classe existe porque, sem ela, o alarme falso vira evidência contra a
ponte — e três das minhas próprias regras já morreram por não distinguir isso.

### Por que a quarta classe existe (curso TechInov, 05/09)

Sem ela, a métrica contaria um defeito **como sucesso da ponte**. O caso:

O módulo 2 calcula uma previsão de demanda de **93 unidades** — resposta-modelo
de um exercício de média móvel ponderada. A frase não nomeia produto nenhum, e
'notebooks Modelo Y' aparece uma única vez no módulo inteiro, longe do número.

A ponte injetou, verificado no log de produção:

    Lead Time — previsão de demanda = 93 unidades (m2)

Rótulo sem produto. E o número reapareceu:

- módulo 3: *"A previsão de demanda para o **'Smartphone Z'** é de 93 unidades
  por mês"*
- módulo 8: *"revisamos a previsão de demanda para o **'Smartphone X'**, que
  **no Módulo 2** foi de 93 unidades por mês"*

O número é o mesmo nos três lugares — pela métrica das três classes, isso seria
**CONSISTENTE**, três vezes, e entraria a favor da ponte. Mas o objeto mudou em
cada aparição, e o módulo 8 ainda inventa uma procedência que confere com o
marcador `(m2)` do rótulo injetado e não confere com o texto do módulo 2.

O 93 é calculado dentro do módulo 2 e não pode estar no blueprint, escrito antes
dele. O único caminho do módulo 2 para os módulos 3 e 8 é a ponte. A atribuição
causal não é certa — o modelo poderia ter chegado ao mesmo número por acaso —,
mas é a explicação mais direta, e a citação "no Módulo 2" é difícil de explicar
de outro jeito.

**Consequência para o experimento:** consistência numérica não é o bem que se
quer. O bem é o curso não mentir. Uma ponte que preserva o número e troca o dono
dele piora o texto, e a métrica tem de conseguir dizer isso.

**Consequência para o produto, fora do experimento:** o rótulo injetado precisa
carregar a entidade — produto, item, fornecedor —, não só o nome da métrica. E
um valor cujo objeto não é identificável no texto de origem talvez não deva ser
injetado. As duas coisas são mudanças no extrator e serão medidas contra os oito
cursos da bancada antes de entrar.

## Como as observações são levantadas

Duas passadas, nesta ordem:

1. **Portão de qualidade como primeira peneira.** `inspectCourse` já agrupa
   grandezas repetidas entre módulos e devolve as divergentes em
   `coerencia.valores_entre_modulos` e
   `coerencia.valores_entre_modulos_inferidos`. Toda evidência que ele marca é
   lida à mão e classificada nas três classes acima. **O portão não decide
   nada** — ele aponta onde olhar.

2. **Amostra do que o portão NÃO marcou.** Sem isso eu mediria só o recall do
   portão. Para cada curso: tomar os valores que a ponte injetou (a linha de log
   `N valores canônicos herdados: rótulo=valor (mN)`, commit `25df732`) e
   rastrear **cada um** nos módulos posteriores, marcados ou não. No braço A não
   há injeção, então a lista de partida são os valores que
   `valoresDoCasoCondutor` extrai dos módulos 1 e 2 do próprio curso — a mesma
   régua, aplicada ao mesmo lugar.

A segunda passada é a que dá volume. No 'Sabor Caseiro' seriam 8 valores × 6
módulos posteriores = **até 48 rastreamentos**, dos quais 3 renderam
reenunciação (valor médio do estoque no m6, perdas no m7, custo de armazenagem
no m5 e m7). Estimativa honesta: **entre 3 e 20 observações por curso**, com
grande variação. Com 2 cursos por braço, algo entre 6 e 40 por braço.

Isso não é muito. É o suficiente para um efeito grande e insuficiente para um
efeito modesto, e essa limitação fica registrada aqui **antes** do resultado.

## O que conta como resposta

Escrito antes de ver qualquer dado:

- **A ponte previne** se a taxa `DIVERGENTE / (DIVERGENTE + CONSISTENTE)` cair
  no braço B e a queda for grande — de metade ou mais, com pelo menos 10
  observações no braço A.
- **A ponte não previne** se as taxas ficarem próximas, ou se o braço B tiver
  divergências **nos valores que a ponte comprovadamente injetou** (a linha de
  log diz quais). Uma divergência num valor injetado é a refutação mais direta
  possível: o número estava no prompt e o modelo escreveu outro.
- **A ponte piora** se o braço B tiver mais `COLADO NO ITEM ERRADO` que o A.
  Esse resultado é possível por construção — a injeção leva o número sem levar
  o dono dele — e já há um caso observado fora do experimento (TechInov, 93
  unidades). Se aparecer, o veredito não é "inconclusivo": é que a ponte, como
  está, troca um defeito por outro.
- **Inconclusivo** em qualquer outro caso — inclusive se o braço A não produzir
  divergência nenhuma, porque aí não há o que prevenir e o experimento não
  testou nada.

O terceiro resultado é o mais provável e não é fracasso. `ready` nos dois braços
com zero divergências dos dois lados significa que este tema não gera o defeito,
e o próximo passo seria escolher um tema que gere — não concluir que a ponte
funciona.

## O que o experimento NÃO responde

Causalidade com 2 cursos por braço. Se a diferença aparecer, ela é compatível
com a ponte funcionando e também com variação entre gerações. O resultado
positivo justifica continuar medindo; não justifica declarar o problema
resolvido.
