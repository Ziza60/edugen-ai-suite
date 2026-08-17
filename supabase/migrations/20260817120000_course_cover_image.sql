-- Imagem de capa do curso.
--
-- POR QUE ISTO PRECISOU EXISTIR
--
-- Até aqui só havia imagem por módulo, em `course_images`. A capa do PPTX não
-- tinha de onde tirar uma imagem escolhida pelo autor, então caía numa busca
-- automática no Pexels com o título do curso como consulta.
--
-- Medido num deck real de "Gestão de Controles Internos na Administração
-- Pública Municipal": a busca casou "administração pública municipal" e
-- devolveu a foto de um gari da Limpeza Pública de Curitiba, de costas, com
-- "CURITIBA", "Meio Ambiente" e o logotipo "CAVO" legíveis no uniforme.
--
-- O desalinhamento de tema seria contornável. A marca de terceiros na capa de
-- um curso vendido, não: ela sugere um vínculo institucional que não existe.
--
-- Fica em `courses`, e não em `course_images`, por duas razões: `course_images`
-- tem `module_id` obrigatório e é indexada por módulo — a capa não pertence a
-- módulo nenhum; e a capa é atributo do curso, com um valor só, sem histórico.
--
-- Nulo significa "o autor não escolheu capa". Quem consome decide o que fazer
-- nesse caso, e hoje as exportações caem na busca automática, como antes.

alter table public.courses
  add column if not exists cover_image_url text,
  add column if not exists cover_image_alt text;

comment on column public.courses.cover_image_url is
  'Imagem de capa escolhida pelo autor (Pexels ou gerada por IA). Nulo = sem capa escolhida.';

comment on column public.courses.cover_image_alt is
  'Descrição da imagem de capa. Serve a leitor de tela e vira legenda no PDF.';
