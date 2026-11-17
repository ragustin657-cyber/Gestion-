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
    { name: 'general', testIgnore: /(conciliacion|tesoreria|tarjetas|comisiones|sueldos-final)\.spec\.ts/ },
    // La baja crea un empleado que no debe quedar en las mensuales que cierran las pruebas de sueldos: corre después de ellas
    // Comisiones reabre la mensual del mes (que cerró la prueba de sueldos), carga la comisión y la vuelve a cerrar
    { name: 'comisiones', testMatch: /comisiones\.spec\.ts/, dependencies: ['general'] },
    { name: 'sueldos-final', testMatch: /sueldos-final\.spec\.ts/, dependencies: ['comisiones'] },
    // Tesorería compara el saldo del banco demo antes y después: corre sola, sin pagos en paralelo sobre la misma cuenta
    // Tarjetas acredita en el banco demo: corre antes de tesorería, que compara su saldo, y de la conciliación, que cierra el mes
    { name: 'tarjetas', testMatch: /tarjetas\.spec\.ts/, dependencies: ['sueldos-final'] },
    { name: 'tesoreria', testMatch: /tesoreria\.spec\.ts/, dependencies: ['tarjetas'] },
    { name: 'conciliacion', testMatch: /conciliacion\.spec\.ts/, dependencies: ['tesoreria'] },
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
