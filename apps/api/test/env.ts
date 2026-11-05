process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://gestion:gestion@localhost:5432/gestion_test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'secreto-de-test';
