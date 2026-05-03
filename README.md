# EduGenAI

**Transforme conhecimento bruto em cursos completos, prontos para vender ou treinar equipes.**

EduGenAI é uma plataforma SaaS que converte PDFs, apostilas, vídeos do YouTube e materiais internos em pacotes educacionais completos — com módulos, quizzes, flashcards, certificado, landing page e tutor com IA — em minutos, não em semanas.

---

## Para quem é

- **Professores independentes** que querem lançar cursos online sem montar tudo do zero
- **Infoprodutores** que precisam transformar e-books e apostilas em produtos digitais
- **Consultores e coaches** que querem empacotar seu método em um curso estruturado
- **Treinadores corporativos e RH** que precisam converter manuais e documentos internos em treinamentos
- **Escolas livres e cursos livres** que querem digitalizar material didático existente
- **Profissionais autônomos** que têm conhecimento acumulado e querem monetizá-lo

---

## O que o EduGenAI entrega

O diferencial não é "gerar texto com IA". É pegar um material bruto e devolver um pacote educacional completo e pronto para uso:

| Entrada | Saída |
|---|---|
| PDF ou DOCX (apostila, manual, e-book) | Curso com módulos estruturados |
| Vídeo do YouTube | Transcrição analisada e transformada em aulas |
| Tema livre ou template | Curso gerado do zero com IA |

### O que vem no pacote gerado

- **Módulos com conteúdo completo** — texto estruturado, editável em blocos
- **Quizzes automáticos** — perguntas de múltipla escolha por módulo
- **Flashcards de revisão** — para retenção de conteúdo
- **Certificado personalizável** — emitido automaticamente ao aluno
- **Landing page** — página pública de vendas ou captação
- **Portal do aluno** — URL pública com navegação estilo Udemy
- **Tutor com IA** — alunos tiram dúvidas sobre o conteúdo do curso
- **Exportação** — PDF, PPTX (apresentações), SCORM, Markdown, Notion

---

## Funcionalidades principais

- Importação de PDF e DOCX com extração de texto via Gemini Vision
- Importação de vídeos do YouTube via transcrição automática
- Gerador de curso com IA (Gemini 2.5 Flash) a partir de tema, template ou material importado
- Editor de módulos com blocos (texto rico, edição inline)
- Auto-save com indicador de status
- Tradução de cursos para outros idiomas
- EduScore — avaliação pedagógica automática do conteúdo
- Verificação de qualidade e reformatação de conteúdo
- Script de narração para videoaulas
- Gerenciamento de planos (Free / Starter / Pro)
- Autenticação com e-mail e Google
- Dashboard com métricas de uso

---

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Frontend | React + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS |
| Backend | Express (Node.js) |
| Banco de dados | PostgreSQL via Supabase |
| Edge Functions | Supabase Functions (Deno) |
| IA | Google Gemini 2.5 Flash |
| Autenticação | Supabase Auth |
| Storage | Supabase Storage |

---

## Rodando localmente

```bash
# Clone o repositório
git clone <URL_DO_REPO>
cd <NOME_DO_PROJETO>

# Instale as dependências
npm install

# Configure as variáveis de ambiente
# Crie um arquivo .env com VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY

# Inicie o servidor de desenvolvimento
npm run dev
```

O app roda em `http://localhost:5000` por padrão.

---

## Variáveis de ambiente necessárias

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave anon pública do Supabase |

As edge functions utilizam `GEMINI_API_KEY` e as chaves de serviço do Supabase, configuradas nos secrets do projeto.

---

## Estrutura do projeto

```
src/
  pages/          # Páginas principais (Dashboard, CourseView, CourseWizard, StudentPortal…)
  components/     # Componentes reutilizáveis e de curso
  hooks/          # Hooks customizados (auth, subscription, theme…)
  integrations/   # Cliente Supabase
supabase/
  functions/      # Edge functions (geração, exportação, análise, tutor…)
```
