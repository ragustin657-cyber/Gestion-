import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test('finanzas: el tesorero abre el flujo por semana y ve el detalle de un período', async ({ page }) => {
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/tesoreria/flujo');
  await expect(page.getByRole('heading', { name: 'Flujo de fondos proyectado' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Saldo inicial' })).toBeVisible();
  const primera = page.getByRole('cell', { name: /^\d{2}\/\d{2}–\d{2}\/\d{2}$/ }).first();
  await expect(primera).toBeVisible();
  await primera.click();
  await expect(page.getByRole('dialog').getByText(/^Detalle /)).toBeVisible();
});
