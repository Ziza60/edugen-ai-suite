import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
});

async function generateInserts() {
  await client.connect();
  const tablesResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name NOT IN ('ai_cache', 'usage_events'); -- Optional: exclude heavy/temp tables if needed
  `);
  
  const tables = tablesResult.rows.map(r => r.table_name);
  let sql = '-- Edugen Data Dump\n-- Note: Disable triggers before running this if needed: SET session_replication_role = \'replica\';\n\n';

  for (const table of tables) {
    const data = await client.query(`SELECT * FROM "${table}"`);
    if (data.rows.length === 0) continue;

    sql += `-- Data for ${table}\n`;
    const columns = data.fields.map(f => `"${f.name}"`).join(', ');
    
    for (const row of data.rows) {
      const values = data.fields.map(f => {
        const val = row[f.name];
        if (val === null) return 'NULL';
        if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
        if (val instanceof Date) return `'${val.toISOString()}'`;
        if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
        return val;
      }).join(', ');
      
      sql += `INSERT INTO "${table}" (${columns}) VALUES (${values}) ON CONFLICT DO NOTHING;\n`;
    }
    sql += '\n';
  }

  sql += '-- Re-enable triggers: SET session_replication_role = \'origin\';\n';
  console.log(sql);
  await client.end();
}

generateInserts();
