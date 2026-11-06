import { defineConfig } from '@playwright/test';

const API = 'http://localhost:3100';
const WEB = 'http://localhost:5174';
const DB = process.env.DATABASE_URL_E2E ?? 'postgresql://gestion:gestion@localhost:5432/gestion_e2e';

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  use: { baseURL: WEB, headless: true, launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  // La conciliación cierra el mes de la cuenta demo: corre al final, cuando las demás pruebas ya registraron sus movimientos
  projects: [
    { name: 'general', testIgnore: /conciliacion\.spec\.ts/ },
    { name: 'conciliacion', testMatch: /conciliacion\.spec\.ts/, dependencies: ['general'] },
  ],
  webServer: [
    {
      // Base e2e: se migra, se siembra con datos demo y se levanta la API
      command: 'pnpm --filter @gestion/api exec prisma migrate deploy && pnpm --filter @gestion/api seed && pnpm --filter @gestion/api dev',
      url: `${API}/api/salud`,
      env: { DATABASE_URL: DB, JWT_SECRET: 'e2e', PORT: '3100' },
      cwd: '..',
      timeout: 120000,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @gestion/web exec vite --port 5174 --strictPort',
      url: WEB,
      env: { API_URL: API },
      cwd: '..',
      timeout: 60000,
      reuseExistingServer: false,
    },
  ],
});
