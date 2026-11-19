import { expect, Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

// La demo no tiene liquidaciones del año anterior: la anual sale vacía y el F.1359 lleva solo la cabecera (spec E32 §7)
test('ganancias: el contador calcula y cierra la anual del año anterior y descarga el F.1359', async ({ page }) => {
  await ingresar(page, 'contador@demo.com', 'contador1234');
  await page.goto('/sueldos/ganancias/anual');
  await expect(page.getByRole('heading', { name: 'Ganancias: liquidación anual' })).toBeVisible();
  await expect(page.getByText('Sin calcular')).toBeVisible();
  await page.getByRole('button', { name: 'Calcular' }).click();
  await expect(page.getByText('Liquidación anual calculada')).toBeVisible();
  await expect(page.getByText('Borrador', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByText('Liquidación anual cerrada')).toBeVisible();
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar F.1359' }).click();
  const d = await descarga;
  const anio = new Date().getFullYear() - 1;
  expect(d.suggestedFilename()).toBe(`F1359-${anio}.txt`);
  const texto = await readFile((await d.path())!, 'latin1');
  const [primera] = texto.split(/\r?\n/);
  expect(primera).toMatch(/^01\d{11}\d{4}000001035931359100200$/);
  expect(primera.slice(13, 17)).toBe(String(anio));
});
