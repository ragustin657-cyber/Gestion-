import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test('informes: el contador abre el tablero, entra a ventas por cliente y descarga el Excel', async ({ page }) => {
  await ingresar(page, 'contador@demo.com', 'contador1234');
  await expect(page.getByRole('heading', { name: 'Tablero de dirección' })).toBeVisible();
  await page.goto('/informes/tablero');
  await expect(page.getByText('Margen bruto')).toBeVisible();
  await page.getByRole('button', { name: /^Ventas\s*-?\$/ }).click();
  await expect(page).toHaveURL(/\/informes\/ventas\?/);
  await expect(page.getByRole('heading', { name: 'Ventas' })).toBeVisible();
  await page.getByText('Cliente', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Cliente' })).toBeVisible();
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel' }).click();
  expect((await descarga).suggestedFilename()).toMatch(/^ventas-.*\.xlsx$/);
});
