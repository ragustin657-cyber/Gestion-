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

test('remitos de devolución: devolver parte de un remito de entrega y verlo en la consulta', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/ventas/pedido');
  await elegir(page, 'Cliente', 'Supermercados Litoral S.A.');
  await elegir(page, 'Artículo', /LAM-LED/);
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('4');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/Pedido N° \d+ guardado/)).toBeVisible();

  await page.goto('/ventas/remito');
  await elegir(page, 'Cliente', 'Supermercados Litoral S.A.');
  await page.getByRole('checkbox', { name: /Entregar Lámpara/ }).first().check();
  await page.getByRole('textbox', { name: /Cantidad Lámpara/ }).first().fill('4');
  await page.getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(page.getByText(/Remito R \d{4}-\d{8} registrado/)).toBeVisible();

  await page.goto('/ventas/remito-devolucion');
  await elegir(page, 'Cliente', 'Supermercados Litoral S.A.');
  await page.getByRole('textbox', { name: /Devolver Lámpara/ }).first().fill('1');
  await page.getByRole('button', { name: 'Confirmar devolución' }).click();
  await expect(page.getByText(/Remito de devolución R \d{4}-\d{8} registrado/).first()).toBeVisible();

  await page.goto('/ventas/remitos');
  await expect(page.getByRole('cell', { name: 'Devolución' }).first()).toBeVisible();
});
