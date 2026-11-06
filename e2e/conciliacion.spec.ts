import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, Page, test } from '@playwright/test';

const EXTRACTO = resolve(__dirname, '../apps/api/prisma/demo/extracto-demo-nacion.csv');

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test('conciliación: importar el extracto, aplicar coincidencias, registrar con reglas y cerrar', async ({ page }) => {
  test.setTimeout(120000);
  const filas = readFileSync(EXTRACTO, 'latin1').trim().split('\n');
  const saldoFinal = filas[filas.length - 1].split(';')[4].replace(',', '.');
  const [, m, a] = filas[1].split(';')[0].split('/');
  const desde = `${a}-${m}-01`;
  const hasta = new Date(Date.UTC(Number(a), Number(m), 0)).toISOString().slice(0, 10);

  await ingresar(page, 'tesorero@demo.com', 'tesorero1234');
  await page.goto('/conciliacion');
  await expect(page.getByRole('textbox', { name: 'Cuenta bancaria' })).toHaveValue(/Banco de la Nación Argentina/);

  // 1. Importar el extracto
  await page.getByRole('button', { name: 'Importar extracto' }).click();
  const imp = page.getByRole('dialog');
  await imp.locator('input[type=file]').setInputFiles(EXTRACTO);
  await imp.getByRole('button', { name: 'Vista previa' }).click();
  await expect(imp.getByText(`${filas.length - 1} líneas nuevas`)).toBeVisible();
  await imp.getByRole('button', { name: 'Importar' }).click();
  await expect(page.getByText(`${filas.length - 1} líneas importadas`)).toBeVisible();

  // 2. Nueva conciliación del mes con el saldo final del extracto
  await page.getByRole('button', { name: 'Nueva conciliación' }).click();
  const nueva = page.getByRole('dialog');
  await nueva.getByLabel('Desde').fill(desde);
  await nueva.getByLabel('Hasta').fill(hasta);
  await nueva.getByLabel('Saldo final según extracto').fill(saldoFinal);
  await nueva.getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByText(/^Conciliación del /)).toBeVisible();

  // 3. Coincidencias automáticas
  await page.getByRole('button', { name: 'Buscar coincidencias' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Aplicar/ }).click();
  await expect(page.getByText(/coincidencias aplicadas/)).toBeVisible();

  // 4. Registrar las líneas del banco con su regla (25.413, comisión e IVA)
  await page.getByRole('button', { name: /Registrar todas las que tienen regla \(3\)/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('3 líneas registradas')).toBeVisible();

  // 5. Diferencia cero y cierre
  await expect(page.getByTestId('diferencia')).toHaveText('$ 0,00');
  await page.getByRole('button', { name: 'Cerrar conciliación' }).click();
  await expect(page.getByText('Cerrada', { exact: true })).toBeVisible();
});
