import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';

const envPath = new URL('../.env', import.meta.url);
const content = await readFile(envPath, 'utf8');
const line = content.split(/\r?\n/).find((entry) => entry.startsWith('DATABASE_URL='));
if (!line || content.includes('FLYWAY_DATABASE_URL=')) {
  throw new Error('Expected a local .env with only the administrator DATABASE_URL');
}
const adminUrl = new URL(line.slice('DATABASE_URL='.length));
if (adminUrl.hostname !== '127.0.0.1' || adminUrl.pathname !== '/collabcanvas') {
  throw new Error('Refusing to provision outside the local collabcanvas database');
}
const password = randomBytes(32).toString('base64url');
const appUrl = new URL(adminUrl);
appUrl.username = 'collabcanvas_app';
appUrl.password = password;

const maintenanceUrl = new URL(adminUrl);
maintenanceUrl.pathname = '/postgres';
maintenanceUrl.search = '';
const maintenance = new pg.Client({ connectionString: maintenanceUrl.toString() });
await maintenance.connect();
try {
  const existing = await maintenance.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['collabcanvas_app']);
  if (existing.rowCount) throw new Error('Role collabcanvas_app already exists; no password was changed');
  await maintenance.query(`CREATE ROLE collabcanvas_app LOGIN PASSWORD '${password}'`);
  for (const db of ['collabcanvas', 'collabcanvas_test']) {
    await maintenance.query(`GRANT CONNECT ON DATABASE ${db} TO collabcanvas_app`);
    const databaseUrl = new URL(adminUrl);
    databaseUrl.pathname = `/${db}`;
    const client = new pg.Client({ connectionString: databaseUrl.toString() });
    await client.connect();
    try {
      await client.query('GRANT USAGE ON SCHEMA public TO collabcanvas_app');
      await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO collabcanvas_app');
      await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO collabcanvas_app');
      await client.query('REVOKE ALL ON TABLE public.flyway_schema_history FROM collabcanvas_app');
      await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO collabcanvas_app');
      await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO collabcanvas_app');
    } finally {
      await client.end();
    }
  }
  const updated = content.replace(line, `DATABASE_URL=${appUrl.toString()}\nFLYWAY_DATABASE_URL=${adminUrl.toString()}`);
  await writeFile(envPath, updated, { mode: 0o600 });
  console.log('Created collabcanvas_app and updated the ignored backend/.env');
} finally {
  await maintenance.end();
}
