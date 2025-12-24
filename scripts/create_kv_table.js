// scripts/create_kv_table.js
// Run with: NEON_DATABASE_URL="..." node scripts/create_kv_table.js
(async () => {
  const conn = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) {
    console.error('NEON_DATABASE_URL or DATABASE_URL is required');
    process.exit(1);
  }
  try {
    // dynamic require so local dev without pg won't fail earlier
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require('pg');
    const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await client.connect();
    console.log('Connected to DB, creating kv_store_history...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS kv_store_history (
        id BIGSERIAL PRIMARY KEY,
        key TEXT NOT NULL,
        value JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_kv_store_history_key_created_at ON kv_store_history(key, created_at DESC);
    `);
    console.log('kv_store_history ensured');
    await client.end();
    process.exit(0);
  } catch (e) {
    console.error('Migration failed:', e?.message || e);
    process.exit(2);
  }
})();
