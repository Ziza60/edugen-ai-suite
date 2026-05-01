import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// CONFIGURAÇÃO - Preencha com os dados do seu NOVO projeto Supabase
const NEW_PROJECT_URL = 'SUA_NOVA_URL_DO_SUPABASE';
const NEW_PROJECT_SERVICE_ROLE = 'SEU_NOVO_SERVICE_ROLE_KEY';

// Dados do projeto ATUAL (Lovable Cloud) - Já preenchidos automaticamente
const OLD_PROJECT_URL = process.env.SUPABASE_URL;
const OLD_PROJECT_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const oldSupabase = createClient(OLD_PROJECT_URL, OLD_PROJECT_SERVICE_ROLE);
const newSupabase = createClient(NEW_PROJECT_URL, NEW_PROJECT_SERVICE_ROLE);

async function migrateStorage() {
  console.log('Iniciando migração de arquivos...');

  const buckets = ['course-exports', 'course-sources'];

  for (const bucket of buckets) {
    console.log(`\nProcessando bucket: ${bucket}`);
    
    // Lista todos os arquivos no bucket antigo
    const { data: files, error: listError } = await oldSupabase.storage.from(bucket).list('', { limit: 1000 });

    if (listError) {
      console.error(`Erro ao listar arquivos do bucket ${bucket}:`, listError.message);
      continue;
    }

    for (const file of files) {
      if (file.name === '.emptyFolderPlaceholder') continue;

      console.log(`Copiando: ${file.name}...`);
      
      // Download do projeto antigo
      const { data: blob, error: downloadError } = await oldSupabase.storage.from(bucket).download(file.name);

      if (downloadError) {
        console.error(`Erro no download de ${file.name}:`, downloadError.message);
        continue;
      }

      // Upload para o projeto novo
      const { error: uploadError } = await newSupabase.storage.from(bucket).upload(file.name, blob, {
        upsert: true,
        contentType: file.metadata?.mimetype
      });

      if (uploadError) {
        console.error(`Erro no upload de ${file.name}:`, uploadError.message);
      } else {
        console.log(`Sucesso: ${file.name}`);
      }
    }
  }

  console.log('\nMigração concluída!');
}

if (!NEW_PROJECT_URL || NEW_PROJECT_URL === 'SUA_NOVA_URL_DO_SUPABASE') {
  console.error('Erro: Você precisa editar o arquivo migrate_storage.mjs e colocar a URL e a Key do seu novo projeto.');
} else {
  migrateStorage();
}
