import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

async function elegir(page: Page, etiqueta: string | RegExp, opcion: string | RegExp) {
  await page.getByRole('textbox', { name: etiqueta }).first().click();
  await page.getByRole('option', { name: opcion }).first().click();
}

test('impuestos: el contador genera el Libro IVA Digital y SICORE del mes y ve el historial', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'contador@demo.com', 'contador1234');

  await page.goto('/impuestos/generar');
  const zip = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar' }).click();
  expect((await zip).suggestedFilename()).toMatch(/^LIBRO_IVA_DIGITAL_\d{11}_\d{6}\.zip$/);
  await expect(page.getByText(/registros · total/)).toBeVisible();

  await elegir(page, 'Presentación', 'SICORE (Ganancias)');
  const txt = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar' }).click();
  expect((await txt).suggestedFilename()).toMatch(/^SICORE_\d{11}_\d{6}\.txt$/);

  await page.goto('/impuestos/presentaciones');
  await expect(page.getByRole('button', { name: 'Descargar' })).toHaveCount(2);
});
