import { expect, Page, test } from '@playwright/test';

const nombre = `Plan ${String(Date.now()).slice(-6)}`;

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test('presupuesto: el contador crea uno, reparte ventas, lo marca vigente y ve la comparación', async ({ page }) => {
  await ingresar(page, 'contador@demo.com', 'contador1234');
  await page.goto('/informes/presupuestos');
  await page.getByRole('button', { name: 'Nuevo presupuesto' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill(nombre);
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
  await page.getByRole('button', { name: 'Repartir total anual' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox', { name: 'Cuenta' }).click();
  await page.getByRole('option', { name: /^4\.1\.01 / }).click();
  await dlg.getByLabel('Total anual').fill('1200000');
  await dlg.getByRole('button', { name: 'Repartir' }).click();
  await expect(page.getByRole('cell', { name: '$ 1.200.000,00' }).first()).toBeVisible();
  await page.goto('/informes/presupuestos');
  await page.getByRole('row', { name: new RegExp(nombre) }).getByRole('button', { name: 'Marcar vigente' }).click();
  await expect(page.getByRole('row', { name: new RegExp(nombre) }).getByText('Vigente')).toBeVisible();
  await page.goto('/informes/presupuesto-real');
  await expect(page.getByRole('cell', { name: /^4\.1\.01 / })).toBeVisible();
});
