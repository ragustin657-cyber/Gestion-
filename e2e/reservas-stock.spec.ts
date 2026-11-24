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

test('reservas de stock: el pedido confirmado reserva y Existencias lo muestra', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/ventas/pedido');
  await elegir(page, 'Cliente', 'Supermercados Litoral S.A.');
  await elegir(page, 'Artículo', /LAM-LED/);
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('3');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/Pedido N° \d+ guardado/)).toBeVisible();

  await page.goto('/stock/existencias');
  await page.getByLabel('Solo con stock').uncheck();
  await page.getByRole('button', { name: 'Reservas de LAM-LED' }).click();
  await expect(page.getByRole('dialog').getByText('Supermercados Litoral S.A.')).toBeVisible();
});
