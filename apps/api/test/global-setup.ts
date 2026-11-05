import { execSync } from 'child_process';

/** Recrea el esquema de la base de TEST y aplica las migraciones. Solo bases *_test. */
export default function globalSetup() {
  const url =
    process.env.DATABASE_URL_TEST ?? 'postgresql://gestion:gestion@localhost:5432/gestion_test';
  const nombreBase = new URL(url).pathname.slice(1);
  if (!nombreBase.endsWith('_test'))
    throw new Error(`La base de tests debe terminar en _test (recibida: ${nombreBase})`);
  const opts = { cwd: __dirname + '/..', env: { ...process.env, DATABASE_URL: url } };
  execSync('npx prisma db execute --stdin --schema prisma/schema.prisma', {
    ...opts,
    input: 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  execSync('npx prisma migrate deploy', { ...opts, stdio: 'ignore' });
}
