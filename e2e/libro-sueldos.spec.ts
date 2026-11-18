import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

const LARGOS: Record<string, number> = { '01': 35, '02': 115, '03': 51, '04': 370 };

test('libro de sueldos: el contador descarga el Libro de Sueldos Digital de la liquidación mensual', async ({ page }) => {
  await ingresar(page, 'contador@demo.com', 'contador1234');
  // La acreditación en cuenta exige el CBU del empleado
  await page.goto('/sueldos/empleados');
  await page.getByRole('cell', { name: 'Gómez, Ana' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('CBU').fill('2850590940090418135201');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(dlg).toBeHidden();
  // Liquidación mensual cerrada
  await page.goto('/sueldos/liquidaciones');
  await page.getByRole('cell', { name: /^\d{2}\/\d{4}$/ }).first().click();
  await expect(page.getByText('Cerrada', { exact: true })).toBeVisible();
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Libro de Sueldos Digital' }).click();
  const archivo = await descarga;
  expect(archivo.suggestedFilename()).toMatch(/^LSD-\d{6}\.txt$/);
  const lineas = readFileSync((await archivo.path())!, 'latin1').split('\r\n').filter((x) => x);
  expect(lineas[0]).toMatch(/^01\d{11}SJ\d{6}M0000130\d{6}$/);
  for (const l of lineas) expect(l.length).toBe(LARGOS[l.slice(0, 2)]);
  await expect(page.getByText('Liquidación N° 1 del Libro')).toBeVisible();
});
