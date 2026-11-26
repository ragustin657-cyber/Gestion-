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
    // Intereses factura en el mes anterior: corre antes de que la prueba de contabilidad (general) cierre ese mes
    { name: 'intereses', testMatch: /intereses\.spec\.ts/ },
    { name: 'general', dependencies: ['intereses'], testIgnore: /(conciliacion|tesoreria|tarjetas|comisiones|intereses|sueldos-final|libro-sueldos|ganancias|ganancias-anual|retenciones-iva-suss|posicion-iva|posicion-iibb|percepciones-ventas|prorrateo-iva|despachos-importacion|sire-completo|bienes-impositiva|ajuste-impositivo|dj-ganancias|bienes-personales|otras-jurisdicciones-iibb|fce|ventas-descuentos|listas-derivadas|reservas-stock|remitos-devolucion|facturacion-lotes|rubros-descuentos)\.spec\.ts/ },
    // La baja crea un empleado que no debe quedar en las mensuales que cierran las pruebas de sueldos: corre después de ellas
    // Comisiones reabre la mensual del mes (que cerró la prueba de sueldos), carga la comisión y la vuelve a cerrar
    { name: 'comisiones', testMatch: /comisiones\.spec\.ts/, dependencies: ['general'] },
    { name: 'sueldos-final', testMatch: /sueldos-final\.spec\.ts/, dependencies: ['comisiones'] },
    // Tesorería compara el saldo del banco demo antes y después: corre sola, sin pagos en paralelo sobre la misma cuenta
    // Tarjetas acredita en el banco demo: corre antes de tesorería, que compara su saldo, y de la conciliación, que cierra el mes
    { name: 'libro-sueldos', testMatch: /libro-sueldos\.spec\.ts/, dependencies: ['sueldos-final'] },
    { name: 'tarjetas', testMatch: /tarjetas\.spec\.ts/, dependencies: ['libro-sueldos'] },
    { name: 'tesoreria', testMatch: /tesoreria\.spec\.ts/, dependencies: ['tarjetas'] },
    { name: 'conciliacion', testMatch: /conciliacion\.spec\.ts/, dependencies: ['tesoreria'] },
    { name: 'ganancias', testMatch: /\/ganancias\.spec\.ts/, dependencies: ['conciliacion'] },
    { name: 'ganancias-anual', testMatch: /ganancias-anual\.spec\.ts/, dependencies: ['ganancias'] },
    { name: 'retenciones-iva-suss', testMatch: /retenciones-iva-suss\.spec\.ts/, dependencies: ['ganancias-anual'] },
    { name: 'posicion-iva', testMatch: /posicion-iva\.spec\.ts/, dependencies: ['retenciones-iva-suss'] },
    { name: 'posicion-iibb', testMatch: /posicion-iibb\.spec\.ts/, dependencies: ['posicion-iva'] },
    { name: 'percepciones-ventas', testMatch: /percepciones-ventas\.spec\.ts/, dependencies: ['posicion-iibb'] },
    { name: 'prorrateo-iva', testMatch: /prorrateo-iva\.spec\.ts/, dependencies: ['percepciones-ventas'] },
    { name: 'despachos-importacion', testMatch: /despachos-importacion\.spec\.ts/, dependencies: ['prorrateo-iva'] },
    { name: 'sire-completo', testMatch: /sire-completo\.spec\.ts/, dependencies: ['despachos-importacion'] },
    { name: 'bienes-impositiva', testMatch: /bienes-impositiva\.spec\.ts/, dependencies: ['sire-completo'] },
    { name: 'ajuste-impositivo', testMatch: /ajuste-impositivo\.spec\.ts/, dependencies: ['bienes-impositiva'] },
    { name: 'dj-ganancias', testMatch: /dj-ganancias\.spec\.ts/, dependencies: ['ajuste-impositivo'] },
    { name: 'bienes-personales', testMatch: /bienes-personales\.spec\.ts/, dependencies: ['dj-ganancias'] },
    { name: 'otras-jurisdicciones-iibb', testMatch: /otras-jurisdicciones-iibb\.spec\.ts/, dependencies: ['bienes-personales'] },
    { name: 'fce', testMatch: /fce\.spec\.ts/, dependencies: ['otras-jurisdicciones-iibb'] },
    { name: 'ventas-descuentos', testMatch: /ventas-descuentos\.spec\.ts/, dependencies: ['fce'] },
    { name: 'listas-derivadas', testMatch: /listas-derivadas\.spec\.ts/, dependencies: ['ventas-descuentos'] },
    { name: 'reservas-stock', testMatch: /reservas-stock\.spec\.ts/, dependencies: ['listas-derivadas'] },
    { name: 'remitos-devolucion', testMatch: /remitos-devolucion\.spec\.ts/, dependencies: ['reservas-stock'] },
    { name: 'facturacion-lotes', testMatch: /facturacion-lotes\.spec\.ts/, dependencies: ['remitos-devolucion'] },
    { name: 'rubros-descuentos', testMatch: /rubros-descuentos\.spec\.ts/, dependencies: ['facturacion-lotes'] },
  ],
  webServer: [
    {
      // Base e2e: se migra, se siembra con datos demo y se levanta la API
      command: 'pnpm --filter @gestion/api exec prisma migrate deploy && pnpm --filter @gestion/api seed && pnpm --filter @gestion/api dev',
      url: `${API}/api/salud`,
      // Correo en modo de prueba (los mails se guardan en memoria) y clave de cifrado de prueba (E28)
      env: { DATABASE_URL: DB, JWT_SECRET: 'e2e', PORT: '3100', TRANSPORTE_CORREO: 'prueba', ARCA_CLAVE_MAESTRA: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' },
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
