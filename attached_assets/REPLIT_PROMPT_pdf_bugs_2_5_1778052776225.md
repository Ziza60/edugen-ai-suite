# REPLIT PROMPT — export-pdf: Fix cirúrgico nos Bugs #2 e #5 (fence markdown + operadores SQL)

**Contexto:** Segunda rodada de correções. Os bugs #1 e #6 foram resolvidos na iteração anterior.
Este prompt trata exclusivamente dos bugs #2 e #5, que têm **a mesma causa raiz** e devem ser
resolvidos juntos no mesmo trecho de código.

**Diagnóstico confirmado por pdfplumber (PDF v2):**
- Bug #2: palavra `sql` com `size=10.5 font=Helvetica` aparece como texto comum em 28 ocorrências, distribuídas por 15 páginas.
- Bug #5: nas páginas 12 e 30, o código SQL exibe `Preco 100.00` e `HAVING COUNT(P.id_pedido) 0;` — os operadores `>` foram removidos.

---

## DIAGNÓSTICO: POR QUE OS DOIS BUGS SÃO A MESMA CAUSA

O pipeline de geração do PDF processa o conteúdo markdown em etapas. Existe uma etapa de
**sanitização/escape** que roda **antes ou durante** o parsing dos blocos de código. Essa etapa:

1. Não identifica que está dentro de um bloco de código (` ```sql ... ``` `)
2. Faz strip ou escape do language identifier (`sql`, `python`, etc.) e o emite como texto
3. Remove ou escapa os operadores `>` e `<` (tratando-os como HTML)

O fix correto é garantir que **o conteúdo dentro de code fences seja extraído verbatim, sem nenhum
processamento, antes de qualquer sanitização**.

---

## PASSO 1: ENCONTRAR O PONTO EXATO NO CÓDIGO

Antes de qualquer alteração, execute esta busca no repositório para localizar os arquivos relevantes:

```bash
# Buscar onde code fences são processados:
grep -rn "```" --include="*.js" --include="*.ts" --include="*.py" .
grep -rn "fenced\|fence\|code_block\|codeBlock\|code-block" --include="*.js" --include="*.ts" --include="*.py" .

# Buscar onde sanitização/escape acontece:
grep -rn "sanitize\|escape\|htmlspecialchars\|html\.escape\|replace.*<\|replace.*>" --include="*.js" --include="*.ts" --include="*.py" .

# Buscar onde o markdown é convertido para o formato do PDF:
grep -rn "markdown\|marked\|remark\|unified\|mistune\|markdown-it\|python-markdown" --include="*.js" --include="*.ts" --include="*.py" --include="*.json" --include="requirements*.txt" .
```

Identifique:
- **Qual biblioteca de markdown** é usada (marked.js, markdown-it, remark, mistune, python-markdown, etc.)
- **Onde** o markdown é convertido (nome do arquivo + número da linha)
- **Se há** algum pré-processamento do markdown antes de passar para a biblioteca

---

## PASSO 2A — SE O MOTOR FOR JavaScript / TypeScript (marked.js, markdown-it, remark)

### Situação mais comum: pré-processamento manual do markdown

**LOCALIZAR** qualquer função que processa o conteúdo markdown como string antes de passar
para a biblioteca. Procurar por padrões como:

```javascript
// Padrão problemático 1 — replace global sem respeitar code blocks:
content = content.replace(/</g, '&lt;').replace(/>/g, '&gt;')
// ou
content = sanitizeHtml(content)
// ou
content = DOMPurify.sanitize(content)

// Padrão problemático 2 — parsing ingênuo de code fences:
const lines = content.split('\n')
lines.forEach(line => {
  if (line.startsWith('```')) { /* toggle code mode */ }
  else { processLine(line) }  // ← não ignora o language identifier
})
```

**SUBSTITUIR** pela abordagem de extração-primeiro:

```javascript
/**
 * Extrai todos os blocos de código ANTES de qualquer processamento.
 * Substitui cada bloco por um placeholder único.
 * Depois do processamento do resto do markdown, restaura os blocos intactos.
 */
function processMarkdownSafely(markdown) {
  const codeBlocks = []
  const PLACEHOLDER = '\x00CODE_BLOCK_\x00'

  // Passo 1: extrair todos os code fences (com ou sem language identifier)
  // O grupo 1 captura o language identifier (ex: "sql", "python") — é descartado na renderização
  // O grupo 2 captura o conteúdo verbatim — preservado exatamente como está
  const withPlaceholders = markdown.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (fullMatch, lang, code) => {
      const index = codeBlocks.length
      codeBlocks.push({ lang: lang || '', code: code.trimEnd() })
      return `${PLACEHOLDER}${index}\x00`
    }
  )

  // Passo 2: processar o markdown restante (sanitização, parsing, etc.)
  // Agora é seguro porque não há mais code fences nem operadores SQL no texto
  let processed = processRegularMarkdown(withPlaceholders)

  // Passo 3: restaurar os blocos de código com o conteúdo original intacto
  processed = processed.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)\x00`, 'g'),
    (_, index) => {
      const block = codeBlocks[parseInt(index)]
      return renderCodeBlock(block.code, block.lang)
    }
  )

  return processed
}
```

### Se estiver usando marked.js

```javascript
import { marked } from 'marked'

// LOCALIZAR onde marked é configurado. Adicionar um renderer customizado para code:
const renderer = new marked.Renderer()

// SUBSTITUIR ou ADICIONAR este método:
renderer.code = function(code, language, escaped) {
  // 'code' já vem decodificado pelo marked — usar diretamente, sem escape adicional
  // 'language' é o identifier (ex: 'sql') — NÃO renderizar como texto, só usar como metadado
  return renderCodeBlockForPDF(code, language)
}

marked.use({ renderer })

// A função de renderização do code block para o PDF:
function renderCodeBlockForPDF(code, language) {
  // Implementar conforme o motor de PDF usado (WeasyPrint, ReportLab, Puppeteer, etc.)
  // O ponto crítico: 'code' deve ser usado verbatim, sem nenhum replace ou escape
  return buildPDFCodeBlock(code)  // sua função existente, chamada com o código puro
}
```

### Se estiver usando markdown-it

```javascript
const md = require('markdown-it')()

// markdown-it já extrai code fences corretamente.
// Verificar se o renderer padrão está sendo sobrescrito em algum lugar.
// LOCALIZAR qualquer override de md.renderer.rules.fence ou md.renderer.rules.code_block

// Se não houver override, o problema está no pós-processamento do HTML gerado.
// LOCALIZAR onde o HTML gerado pelo markdown-it é processado antes de virar PDF
// e garantir que não há sanitização global do HTML inteiro.

// Forma correta de capturar o code fence:
md.renderer.rules.fence = function(tokens, idx) {
  const token = tokens[idx]
  const code = token.content  // conteúdo verbatim, sem language identifier
  const lang = token.info.trim()  // language identifier separado
  return renderCodeBlockForPDF(code, lang)
}
```

---

## PASSO 2B — SE O MOTOR FOR Python (WeasyPrint, ReportLab, xhtml2pdf)

### Se usar python-markdown ou mistune

```python
# LOCALIZAR onde o markdown é processado. Procurar por:
# import markdown / import mistune / md.convert() / md(content)

# --- Para python-markdown ---
import markdown
from markdown.extensions.fenced_code import FencedCodeExtension

# VERIFICAR se a extensão fenced_code está sendo usada:
md = markdown.Markdown(extensions=[
    'fenced_code',   # ← ESSENCIAL: sem isso, ```sql é tratado como texto
    'tables',
    # outras extensões...
])

# A extensão fenced_code processa ```sql automaticamente:
# - Descarta o language identifier do corpo do texto
# - Preserva o conteúdo do bloco verbatim
# - Envolve em <code class="language-sql">...</code>

# Se a extensão JÁ está sendo usada mas o bug persiste, o problema está
# no pós-processamento do HTML. LOCALIZAR onde o HTML é processado após
# md.convert() e verificar se há escape de entidades:

html_output = md.convert(markdown_content)

# VERIFICAR se há algum replace ou escape aplicado ao html_output DEPOIS desta linha:
# html_output = html.escape(html_output)  ← ISSO QUEBRARIA OS OPERADORES
# html_output = sanitize(html_output)     ← ISSO TAMBÉM

# Se houver, REMOVER ou LIMITAR o escape para não afetar tags <code>:
import re

def safe_escape(html):
    # Preservar conteúdo de tags <code> e <pre> sem escape
    code_blocks = []
    PLACEHOLDER = '\x00CODE\x00'

    def extract_code(m):
        code_blocks.append(m.group(0))
        return f'{PLACEHOLDER}{len(code_blocks)-1}\x00'

    # Extrair blocos de código antes do escape
    safe = re.sub(r'<(?:pre|code)[^>]*>[\s\S]*?</(?:pre|code)>', extract_code, html)

    # Aplicar escape/sanitização apenas no restante
    safe = your_existing_sanitizer(safe)

    # Restaurar blocos de código
    for i, block in enumerate(code_blocks):
        safe = safe.replace(f'{PLACEHOLDER}{i}\x00', block)

    return safe
```

### Se processar markdown manualmente (parsing linha a linha)

```python
# LOCALIZAR a função que itera sobre as linhas do markdown.
# Padrão problemático mais comum:

def parse_markdown(content):
    lines = content.split('\n')
    in_code_block = False
    result = []

    for line in lines:
        if line.startswith('```'):
            in_code_block = not in_code_block
            # ← PROBLEMA: esta linha não trata o language identifier
            # Quando in_code_block vira True, a linha '```sql' foi "consumida"
            # mas o 'sql' ainda pode ser emitido como texto dependendo da implementação
            continue
        if in_code_block:
            result.append(render_code_line(line))
        else:
            result.append(render_text_line(line))  # ← sanitização acontece aqui

# SUBSTITUIR por:

import re

def parse_markdown(content):
    # Passo 1: extrair todos os blocos de código com regex
    # Grupo 1 = language identifier (ex: "sql") — ignorar na renderização
    # Grupo 2 = conteúdo do bloco — usar verbatim
    code_pattern = re.compile(r'```(\w*)\n([\s\S]*?)```', re.MULTILINE)

    code_blocks = {}
    PLACEHOLDER = '\x00CODEBLOCK{}\x00'

    def extract(m):
        lang = m.group(1)        # ex: "sql"
        code = m.group(2)        # conteúdo verbatim
        idx = len(code_blocks)
        code_blocks[idx] = (lang, code.rstrip('\n'))
        return PLACEHOLDER.format(idx)

    # Substituir code fences por placeholders
    safe_content = code_pattern.sub(extract, content)

    # Passo 2: processar o restante do markdown normalmente
    # (sanitização, parsing de headers, listas, etc.)
    processed_parts = []
    for chunk in safe_content.split('\x00'):
        if chunk.startswith('CODEBLOCK') and chunk.endswith('\x00'):
            # Não deve acontecer aqui — tratado abaixo
            pass
        else:
            processed_parts.append(process_text_chunk(chunk))

    result = ''.join(processed_parts)

    # Passo 3: restaurar blocos de código com conteúdo intacto
    for idx, (lang, code) in code_blocks.items():
        result = result.replace(
            PLACEHOLDER.format(idx),
            render_code_block_for_pdf(code, lang)
            # render_code_block_for_pdf usa 'code' verbatim, sem escape
        )

    return result
```

---

## PASSO 3: VERIFICAR A FUNÇÃO DE RENDERIZAÇÃO DO CODE BLOCK

Independentemente do motor, **localizar a função que recebe o conteúdo do bloco de código e
gera o elemento PDF correspondente**. Ela pode se chamar algo como:
`renderCodeBlock`, `buildCodeBlock`, `createCodeElement`, `formatCodeSection`, etc.

**VERIFICAR** se há qualquer chamada a funções de escape dentro dela:

```python
# Python — padrões a remover dentro da função de code block:
import html
code = html.escape(code)           # ← REMOVER
code = code.replace('<', '&lt;')   # ← REMOVER
code = code.replace('>', '&gt;')   # ← REMOVER
code = bleach.clean(code)          # ← REMOVER ou mover para fora
```

```javascript
// JavaScript — padrões a remover dentro da função de code block:
code = code.replace(/</g, '&lt;')  // ← REMOVER
code = code.replace(/>/g, '&gt;')  // ← REMOVER
code = escapeHtml(code)            // ← REMOVER
code = DOMPurify.sanitize(code)    // ← REMOVER
```

O conteúdo de um bloco de código **nunca deve ser sanitizado como HTML**. Ele é texto pré-formatado
que vai direto para um elemento visual com fonte monoespaçada — não é interpretado como markup.

---

## PASSO 4: CHECKLIST DE VALIDAÇÃO

Após aplicar as correções, gerar o PDF e verificar:

**Bug #2 — prefixo `sql` eliminado:**
- [ ] Pág. 6 (Módulo 1): o bloco de código começa com `-- Criar um novo banco de dados`, sem linha `sql` antes
- [ ] Pág. 12 (Módulo 2): o bloco começa com `SELECT NomeProduto...`, sem linha `sql`
- [ ] Pág. 18 (Módulo 3): os 4 blocos de código (CREATE, INSERT, UPDATE, DELETE) começam direto com a instrução SQL
- [ ] Pág. 24 (Módulo 4): o bloco começa com `-- Criar a tabela Autores`, sem linha `sql`
- [ ] Pág. 30 (Módulo 5): o bloco começa com `SELECT C.nome_cliente...`, sem linha `sql`

**Bug #5 — operadores `>` presentes:**
- [ ] Pág. 12: o código exibe `WHERE Categoria = 'Eletrônicos' AND Preco > 100.00`
- [ ] Pág. 30: o código exibe `HAVING COUNT(P.id_pedido) > 0;`

**Regressão — verificar que o fix não quebrou nada:**
- [ ] Texto normal (fora de code blocks) continua renderizando corretamente
- [ ] Tabelas continuam sem coluna fantasma
- [ ] Fontes de títulos continuam com tamanho correto (12px) ao transbordar de página

---

## NOTA IMPORTANTE

Se ao procurar o código for identificado que **o motor usa uma biblioteca de markdown consolidada**
(marked.js, markdown-it, python-markdown com extensão fenced_code, mistune com plugin de fences)
**e ela já está configurada corretamente**, então o problema está **no pós-processamento** — alguma
função que recebe o output da biblioteca e aplica transformações adicionais.

Nesse caso, o diagnóstico muda: **não mexer na configuração da biblioteca**. Em vez disso, localizar
onde o output é transformado depois e blindar o conteúdo de `<code>` e `<pre>` nessa etapa,
conforme mostrado na função `safe_escape()` do Passo 2B acima.
