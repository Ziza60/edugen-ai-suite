# REPLIT PROMPT — export-pdf: Correção de 7 Bugs de Renderização

**Motor alvo:** `export-pdf` (edge function ou serviço que gera o PDF do aluno)
**Prioridade:** Alta — afeta 100% dos PDFs gerados
**Método de diagnóstico:** Análise com pdfplumber (`size` e `fontname` de cada palavra) + inspeção visual do PDF gerado

---

## CONTEXTO ANTES DE COMEÇAR

Antes de aplicar qualquer fix, leia o código atual do `export-pdf` e confirme:
1. Qual biblioteca/motor é usado para renderizar o PDF (WeasyPrint, ReportLab, Puppeteer/HTML, etc.)
2. Onde ocorre o parsing do markdown (qual função converte markdown → estrutura renderizável)
3. Onde ocorre a quebra de página (page break logic)
4. Onde os estilos de fonte são definidos por tipo de elemento (heading, body, code, etc.)

> **NUNCA** aplicar os fixes sem antes localizar exatamente os trechos descritos abaixo.
> Se o snippet a substituir não existir exatamente como descrito, reportar antes de prosseguir.

---

## BUG #1 — ALTA SEVERIDADE
### Metadados de geração visíveis na capa do aluno (Página 1)

**Sintoma:** A capa do PDF exibe "Idioma: pt-BR" e "Gerado em: 06/05/2026", informações de sistema sem valor para o aluno.

**Onde está:** Template/função que monta o bloco de capa do PDF.

**LOCALIZAR** o bloco que renderiza os metadados na capa. Será algo como:

```
// Exemplos de como pode aparecer (adaptar ao motor real):
"Idioma"  + course.language
"Gerado em" + generatedAt
locale / language / generated_at / created_at
```

**SUBSTITUIR POR:** Remover completamente o bloco de metadados (idioma + data de geração) da renderização da capa. Esses dados não devem aparecer no PDF do aluno em nenhuma circunstância.

**Resultado esperado:** Capa exibe apenas título do curso e subtítulo/descrição, sem nenhuma linha de metadados técnicos.

---

## BUG #2 — ALTA SEVERIDADE
### Prefixo `sql` (e outras linguagens) aparece como texto literal antes dos blocos de código

**Sintoma:** Em vez de renderizar um bloco de código limpo, o PDF exibe a palavra `sql` como uma linha de texto antes do código. Afeta 100% dos blocos de código do documento (páginas 6, 12, 16, 19, 25, 31).

**Causa raiz confirmada:** O parser trata ` ```sql ` como duas linhas separadas:
- Linha 1 → `sql` (renderizada como texto comum)
- Linha 2+ → código (renderizado em bloco separado)

O language identifier da fence markdown não está sendo consumido/descartado.

**LOCALIZAR** a função que faz o parsing de blocos de código markdown. Será algo como:

```javascript
// Padrão atual (incorreto) — pode variar:
content.replace(/```\n([\s\S]*?)```/g, ...)
// ou
if (line === '```') { inCodeBlock = !inCodeBlock; }
// ou qualquer regex que não capture o language identifier
```

**SUBSTITUIR POR** uma regex que capture e descarte o identificador de linguagem:

```javascript
// CORRETO — captura e descarta o language identifier:
content.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
  return renderCodeBlock(code.trim());
});

// Se o motor usa parsing linha a linha (ex: WeasyPrint com markdown-it):
// Garantir que a linha que abre o fence (```sql, ```python, etc.)
// seja inteiramente consumida como marcador de abertura,
// sem que seu conteúdo textual ("sql", "python") seja emitido como parágrafo.
```

**Adaptar ao motor real** — o princípio é: o identificador de linguagem após ` ``` ` deve ser lido e ignorado (ou usado para syntax highlight), nunca renderizado como texto.

**Resultado esperado:** Blocos de código aparecem sem nenhuma linha "sql" / "python" / "javascript" antes deles.

---

## BUG #3 — ALTA SEVERIDADE
### Página 33 quase em branco — último item isolado (overflow de viúva)

**Sintoma:** O último item da seção "Principais Aprendizados" do Módulo 5 ("Criar índices em colunas frequentemente consultadas para acelerar a busca de dados.") transbordou sozinho para uma página inteira, deixando-a com apenas uma linha de conteúdo.

**Causa raiz:** Ausência de controle de orfão/viúva no layout de listas.

**LOCALIZAR** a configuração de estilos de parágrafo/lista do motor de PDF.

**Se o motor for WeasyPrint (CSS):**

```css
/* LOCALIZAR — arquivo CSS do template PDF */
/* Pode estar em qualquer seletor de lista/parágrafo */

/* ADICIONAR nas regras de li, p, .list-item ou equivalente: */
orphans: 3;
widows: 3;

/* Para seções inteiras não quebrarem em posição ruim: */
.section-content {
  break-inside: avoid-page;  /* evita quebrar seções pequenas no meio */
}
```

**Se o motor for ReportLab (Python):**

```python
# LOCALIZAR — onde os estilos de parágrafo são definidos
# (ParagraphStyle, ListFlowable, etc.)

# ADICIONAR nos estilos de item de lista:
from reportlab.platypus import ListFlowable, ListItem, KeepTogether

# Agrupar os últimos N itens de uma seção com KeepTogether
# para evitar que o último item fique isolado:
# Antes de adicionar ao story:
if len(items) > 0:
    last_items = items[-2:]  # últimos 2 itens
    story.append(KeepTogether(last_items))
```

**Se o motor for Puppeteer/HTML:**

```css
/* No CSS do template HTML que alimenta o Puppeteer: */
li {
  orphans: 3;
  widows: 3;
  break-inside: avoid;
}

ul, ol {
  break-inside: avoid-page;
}
```

**Resultado esperado:** Nenhuma página com menos de 3 linhas de conteúdo isolado.

---

## BUG #4 — MÉDIA SEVERIDADE
### Coluna fantasma vazia em todas as tabelas (4ª coluna inexistente)

**Sintoma confirmado por pdfplumber:** Todas as tabelas do documento (páginas 5, 17, 30) retornam uma 4ª coluna com valores `None`/`''`. As tabelas no markdown são de 3 colunas, mas renderizam com 4.

**Causa raiz:** O número de colunas está hardcoded como 4 (ou calculado como `max(cols, 4)`) em vez de ser extraído dinamicamente do markdown.

**LOCALIZAR** a função que cria o layout de tabelas. Será algo como:

```python
# Padrão incorreto — número de colunas hardcoded:
col_widths = [120, 120, 120, 120]  # sempre 4 colunas
# ou
num_cols = 4
# ou
table_style = TableStyle([('GRID', (0,0), (-1,-1), ...)])
# onde o -1 assume 4 colunas
```

**SUBSTITUIR POR** extração dinâmica do número de colunas:

```python
# CORRETO — extrair número de colunas do próprio conteúdo da tabela:
def parse_markdown_table(markdown_text):
    lines = [l.strip() for l in markdown_text.strip().split('\n')]
    # Linha do header define o número de colunas
    header_cols = [c.strip() for c in lines[0].split('|') if c.strip()]
    num_cols = len(header_cols)

    # Ignorar linha separadora (---|---|---)
    rows = []
    for line in lines[2:]:  # pular header e separador
        cols = [c.strip() for c in line.split('|') if c.strip()]
        # Garantir que cada linha tenha exatamente num_cols células
        while len(cols) < num_cols:
            cols.append('')
        rows.append(cols[:num_cols])  # truncar se tiver colunas extras

    return header_cols, rows, num_cols

# Usar num_cols para definir col_widths dinamicamente:
available_width = page_width - margins
col_width = available_width / num_cols
col_widths = [col_width] * num_cols
```

**Resultado esperado:** Tabelas de 3 colunas renderizam com 3 colunas, tabelas de 4 com 4, sem coluna fantasma.

---

## BUG #5 — MÉDIA SEVERIDADE
### Operadores `>` e `<` cortados nos blocos de código SQL

**Sintoma:** Nas páginas 12 e 31, os operadores de comparação desaparecem:
- `WHERE ... AND Preco > 100.00` aparece como `WHERE ... AND Preco 100.00`
- `HAVING COUNT(P.id_pedido) > 0` aparece como `HAVING COUNT(P.id_pedido) 0`

**Causa raiz:** O motor aplica sanitização/escape de HTML (`>` → `&gt;`) ou stripping de tags (`<`, `>` tratados como delimitadores de tag HTML) dentro de blocos de código, onde não deveria.

**LOCALIZAR** a função de sanitização ou escape que processa o conteúdo antes da renderização. Será algo como:

```javascript
// Padrão incorreto — sanitização aplicada globalmente, inclusive dentro de code blocks:
function sanitize(text) {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
// chamada sem verificar se está dentro de um bloco de código
```

**SUBSTITUIR POR** sanitização que respeita o contexto de code block:

```javascript
// CORRETO — sanitizar apenas fora de blocos de código:
function processContent(markdown) {
  // Separar blocos de código antes de sanitizar
  const parts = markdown.split(/(```[\w]*\n[\s\S]*?```)/g);

  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // É um bloco de código — NÃO sanitizar, renderizar verbatim
      return renderCodeBlock(part);
    } else {
      // É texto normal — pode sanitizar
      return sanitizeAndRender(part);
    }
  }).join('');
}
```

**Se o motor for Python/WeasyPrint com markdown parser:**

```python
# Garantir que o parser markdown trate code fences como raw:
# A maioria dos parsers (markdown-it, mistune, python-markdown)
# tem opção de não processar entidades dentro de code blocks.

# Verificar se a extensão/plugin de code blocks está ativada:
import markdown
md = markdown.Markdown(extensions=['fenced_code'])
# fenced_code preserva o conteúdo verbatim, sem escape de HTML
```

**Se o motor for ReportLab com parsing manual:**

```python
# LOCALIZAR onde o conteúdo do code block é extraído e renderizado
# Garantir que NÃO haja chamada a html.escape() ou similar:
import html

# INCORRETO:
code_content = html.escape(raw_code)  # REMOVER esta linha dentro de code blocks

# CORRETO:
code_content = raw_code  # usar o texto original sem escape
```

**Resultado esperado:** Operadores `>`, `<`, `>=`, `<=` aparecem corretamente dentro de todos os blocos de código.

---

## BUG #6 — MÉDIA SEVERIDADE
### Conteúdo transbordado para início de página seguinte herda fonte errada (8px Bold)

**Sintoma confirmado por pdfplumber:** Todo conteúdo que transborda do final de uma página para o início da página seguinte é renderizado com `size=8.00 font=Helvetica-Bold` — o mesmo tamanho/estilo do número de página. O mesmo elemento, quando renderizado inteiramente dentro de uma página, usa os tamanhos corretos (12px para títulos de seção, 10.5px para corpo de texto).

**Páginas afetadas com valores exatos:**

| Página | Elemento afetado | Fonte real no PDF | Fonte correta |
|--------|-----------------|-------------------|---------------|
| 4 | "Como funciona" (título H2) | 8px Helvetica-Bold | 12px Helvetica-Bold |
| 6 | "Exemplo prático" (título H2) | 8px Helvetica-Bold | 12px Helvetica-Bold |
| 7 | "Desafios e cuidados" (título H2) | 8px Helvetica-Bold | 12px Helvetica-Bold |
| 8 | "Principais Aprendizados" (título H2) | 8px Helvetica-Bold | 12px Helvetica-Bold |
| 11 | "FROM: Indica a tabela..." (bullet body) | 8px Helvetica-Bold | 10.5px Helvetica |
| 16 | "INSERT INTO Tabela..." (bloco de código) | 8px Helvetica-Bold | 10.5px Helvetica |
| 20 | "Desafios e cuidados" (título H2) | 8px Helvetica-Bold | 12px Helvetica-Bold |
| 21 | "Principais Aprendizados" (título H2) | 8px Helvetica-Bold | 12px Helvetica-Bold |
| 24 | "ALTER TABLE: Permite..." (bullet body) | 8px Helvetica-Bold | 10.5px Helvetica |
| 27 | "Principais Aprendizados" (título H2) | 8px Helvetica-Bold | 12px Helvetica-Bold |
| 30 | "Resolvendo Problemas..." (bullet body) | 8px Helvetica-Bold | 10.5px Helvetica |
| 31 | "Alimentar ferramentas de BI..." (bullet body) | 8px Helvetica-Bold | 10.5px Helvetica |
| 32 | "Subconsultas ineficientes..." (bullet body) | 8px Helvetica-Bold | 10.5px Helvetica |
| 33 | "Criar índices em colunas..." (último bullet) | 8px Helvetica-Bold | 10.5px Helvetica |

**Causa raiz:** Ao calcular a quebra de página, o motor renderiza o fragmento que sobrou para a página seguinte dentro do contexto de renderização do rodapé/número de página (que usa 8px Bold), em vez de restaurar o estilo do elemento original antes de continuar.

**LOCALIZAR** a lógica de quebra de página e renderização de fragmentos continuados. Procurar por:

```python
# Termos a buscar no código:
# page_break, new_page, add_page, showPage (ReportLab)
# @page, break-before, break-after (WeasyPrint CSS)
# header, footer, pageNumber (Puppeteer)
# canv.setFont, setFontSize (ReportLab canvas direto)
```

**Se o motor for ReportLab (canvas direto):**

```python
# PROBLEMA: após renderizar o número de página no rodapé,
# o canvas fica com a fonte do rodapé (8pt Bold) ativa.
# Quando o próximo elemento começa a ser desenhado na nova página,
# herda essa fonte.

# LOCALIZAR — função que desenha o número de página (footer/header):
def draw_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica-Bold', 8)
    canvas.drawString(x, y, str(doc.page))
    canvas.restoreState()  # ← VERIFICAR SE restoreState() está presente

# Se restoreState() estiver ausente, adicionar.
# Se estiver presente mas o bug persiste, o problema está em outro lugar —
# verificar se os Flowables restauram o estilo antes de desenhar.
```

**Se o motor for ReportLab (Platypus/Flowables):**

```python
# PROBLEMA: ao quebrar um Paragraph ou ListItem entre páginas,
# o fragmento continuado pode perder o ParagraphStyle.

# LOCALIZAR — onde Paragraphs e ListItems são criados:
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

# GARANTIR que cada Paragraph é criado com seu style explícito:
# INCORRETO (herda estilo do contexto atual):
p = Paragraph(text)

# CORRETO (estilo explícito sempre):
p = Paragraph(text, style=heading_style)   # para títulos H2
p = Paragraph(text, style=body_style)      # para corpo de texto
p = Paragraph(text, style=code_style)      # para código

# Os estilos devem estar definidos com os valores corretos:
heading_style = ParagraphStyle(
    'Heading2',
    fontName='Helvetica-Bold',
    fontSize=12,
    leading=16,
    spaceAfter=8,
)

body_style = ParagraphStyle(
    'Body',
    fontName='Helvetica',
    fontSize=10.5,
    leading=15,
    spaceAfter=6,
)
```

**Se o motor for WeasyPrint (CSS + HTML):**

```css
/* PROBLEMA: o CSS do rodapé/número de página pode estar
   sobrescrevendo estilos de elementos na mesma região.
   Ou: o margin-box do rodapé está vazando para o conteúdo. */

/* LOCALIZAR — regras @page e @bottom-center no CSS: */
@page {
  @bottom-center {
    content: counter(page);
    font-family: Helvetica, sans-serif;
    font-size: 8pt;
    font-weight: bold;
  }
}

/* GARANTIR que h2 e p têm font-size explícito e não herdam do @page: */
h2 {
  font-family: Helvetica, sans-serif;
  font-size: 12pt !important;
  font-weight: bold;
}

p, li {
  font-family: Helvetica, sans-serif;
  font-size: 10.5pt !important;
  font-weight: normal;
}
```

**Se o motor for Puppeteer (HTML → PDF):**

```javascript
// PROBLEMA: o header/footer template do Puppeteer usa um contexto
// de renderização separado — mas se o PDF é gerado via HTML puro
// (sem header/footer template), o problema está no CSS.

// GARANTIR que os estilos de heading e body são !important
// e não podem ser sobrescritos por herança do rodapé:
const css = `
  h2 { font-size: 12pt !important; font-weight: bold !important; }
  p, li { font-size: 10.5pt !important; font-weight: normal !important; }
  .page-number { font-size: 8pt; font-weight: bold; }
`;
```

**Resultado esperado:** Todo conteúdo — independente de estar no meio ou no início de uma página — renderiza com o tamanho de fonte correto para seu tipo (12px para H2, 10.5px para corpo).

---

## BUG #7 — BAIXA SEVERIDADE
### Texto da seção "Aplicações reais" colado no fim da tabela sem espaçamento (Página 17)

**Sintoma:** Na página 17, o parágrafo que segue a tabela "DELETE FROM vs TRUNCATE TABLE" não tem espaçamento adequado — o texto começa imediatamente após a tabela, sem respiro visual.

**LOCALIZAR** a regra de espaçamento pós-tabela no motor de PDF.

**Se WeasyPrint (CSS):**

```css
/* LOCALIZAR — regras de table no CSS: */
table {
  /* ADICIONAR: */
  margin-bottom: 16px;
}

/* OU garantir que o primeiro parágrafo após tabela tem margem: */
table + p,
table + h2,
table + h3 {
  margin-top: 16px;
}
```

**Se ReportLab:**

```python
# LOCALIZAR — onde tabelas são adicionadas ao story:
from reportlab.platypus import Table, Spacer

# APÓS cada Table, adicionar um Spacer:
story.append(table_flowable)
story.append(Spacer(1, 12))  # 12 pontos de espaço após tabela
```

**Se Puppeteer/HTML:**

```css
table {
  margin-bottom: 16px;
}
```

**Resultado esperado:** Seções após tabelas têm 16px de espaço visual antes do próximo elemento.

---

## CHECKLIST DE VALIDAÇÃO PÓS-FIX

Após aplicar todas as correções, gerar o PDF do curso "Introdução à linguagem SQL" e verificar:

- [ ] **Capa:** sem "Idioma" e sem "Gerado em"
- [ ] **Pág. 6:** bloco de código começa com `-- Criar um novo banco de dados`, sem linha `sql` antes
- [ ] **Pág. 12:** código exibe `AND Preco > 100.00` (com o `>` visível)
- [ ] **Pág. 31:** código exibe `HAVING COUNT(P.id_pedido) > 0` (com o `>` visível)
- [ ] **Pág. 4:** "Como funciona" renderiza em fonte maior que o corpo de texto (visualmente igual ao "Fundamentos" na pág. 3)
- [ ] **Pág. 8:** "Principais Aprendizados" renderiza na mesma fonte/tamanho que "Resumo do Módulo" na pág. 7
- [ ] **Pág. 5:** tabela de SGBDs tem exatamente 4 colunas (SGBD, Tipo Principal, Características Principais, Uso Comum) — sem 5ª coluna vazia
- [ ] **Pág. 17:** tabela DELETE vs TRUNCATE tem exatamente 2 colunas de conteúdo — sem coluna vazia extra
- [ ] **Pág. 17:** há espaço visível entre a tabela e o texto "Aplicações reais"
- [ ] **Pág. 33:** última página tem mais de 1 linha de conteúdo (o item de índices não está sozinho)

---

## NOTAS ADICIONAIS

- Os bugs #2 e #5 têm a mesma origem conceitual: processamento incorreto de conteúdo dentro de blocos de código. Se o fix do #2 for feito corretamente (renderização verbatim do conteúdo do code block), o #5 provavelmente se resolve junto.
- O bug #6 é o mais impactante visualmente e afeta 14 páginas. Priorizar seu diagnóstico antes dos demais.
- O bug #4 (coluna fantasma) aparece em TODAS as tabelas — confirmar se há apenas um ponto de criação de tabelas no código ou múltiplos (um por tipo de tabela).
- Não alterar o motor `export-pptx-*` — este prompt é exclusivo para `export-pdf`.
