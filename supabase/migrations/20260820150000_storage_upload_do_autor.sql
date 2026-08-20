-- ═══════════════════════════════════════════════════════════════════════════
-- Permite que o AUTOR envie imagem do próprio computador
--
-- O SINTOMA
--
-- "new row violates row-level security policy" ao escolher uma imagem do PC no
-- seletor de imagem do módulo.
--
-- POR QUE SÓ APARECEU AGORA
--
-- O bucket course-exports existe desde o começo e nunca deu problema — mas
-- nada, até hoje, gravava nele a partir do NAVEGADOR. A geração por IA sobe o
-- arquivo dentro da edge function generate-module-image, usando a chave de
-- serviço, que passa por cima da RLS. A busca no Pexels não sobe nada: guarda a
-- URL do banco de imagens. O envio do autor é a primeira escrita que chega ao
-- bucket como usuário autenticado, e foi ela que encostou na política.
--
-- Ou seja: a lacuna estava lá desde sempre, invisível, porque todo o resto do
-- produto passava por fora dela.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--
-- Declara, de forma explícita e por comando, o que o autor pode fazer com os
-- próprios arquivos. A política antiga era `FOR ALL USING (...)` sem
-- `WITH CHECK`. Em teoria o Postgres reaproveita o USING como verificação de
-- inserção; na prática, depender desse reaproveitamento para a única operação
-- de escrita que temos é frágil demais — e é justamente onde estamos travados.
-- Escrito por extenso, o INSERT tem a sua própria condição e não há o que
-- interpretar.
--
-- O RECORTE NÃO MUDA
--
-- Continua valendo a mesma regra de sempre: o autor alcança apenas o que está
-- na pasta com o seu próprio id. `(storage.foldername(name))[1]` é o primeiro
-- segmento do caminho, e `${user.id}/module-upload-...` é exatamente o formato
-- que o aplicativo monta — a função caminhoDoUpload existe para garantir isso,
-- e tem teste com id hostil tentando escapar da pasta.
--
-- IDEMPOTENTE
--
-- DROP antes de CREATE porque o histórico de migrações deste projeto já esteve
-- vazio uma vez, e não dá para afirmar com certeza o que existe no servidor.
-- Rodar duas vezes não quebra.
-- ═══════════════════════════════════════════════════════════════════════════

-- A política antiga cobria os dois buckets no mesmo estilo. Recriamos as duas
-- por extenso; a de course-sources segue o mesmo raciocínio (o upload de fontes
-- do curso também chega pelo navegador).
drop policy if exists "Users can access their own course exports" on storage.objects;
drop policy if exists "Users can access their own course sources" on storage.objects;

drop policy if exists "author reads own storage" on storage.objects;
drop policy if exists "author inserts own storage" on storage.objects;
drop policy if exists "author updates own storage" on storage.objects;
drop policy if exists "author deletes own storage" on storage.objects;

create policy "author reads own storage"
on storage.objects for select
to authenticated
using (
  bucket_id in ('course-exports', 'course-sources')
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- É esta que faltava na prática: sem WITH CHECK não há inserção autorizada.
create policy "author inserts own storage"
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('course-exports', 'course-sources')
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- upsert: reenviar a imagem do módulo substitui a anterior no mesmo caminho, em
-- vez de acumular arquivo órfão no bucket. Precisa de USING (qual linha pode ser
-- alterada) e de WITH CHECK (como ela pode ficar depois) — sem o segundo, um
-- update poderia mover o arquivo para a pasta de outro usuário.
create policy "author updates own storage"
on storage.objects for update
to authenticated
using (
  bucket_id in ('course-exports', 'course-sources')
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id in ('course-exports', 'course-sources')
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "author deletes own storage"
on storage.objects for delete
to authenticated
using (
  bucket_id in ('course-exports', 'course-sources')
  and auth.uid()::text = (storage.foldername(name))[1]
);
