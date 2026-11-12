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

test('ventas: pedido, remito parcial y factura del remito', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'facturacion@demo.com', 'facturacion1234');

  await page.goto('/ventas/pedido');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await elegir(page, 'Artículo', /YER-1K/);
  await expect(page.getByRole('textbox', { name: 'Precio unitario' })).toHaveValue('4800');
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('30');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/Pedido N° \d+ guardado/)).toBeVisible();

  await page.goto('/ventas/remito');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await page.getByRole('checkbox', { name: /Entregar Yerba/ }).check();
  await page.getByRole('textbox', { name: /Cantidad Yerba/ }).fill('20');
  await page.getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(page.getByText(/Remito R \d{4}-\d{8} registrado/)).toBeVisible();

  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await elegir(page, 'Punto de venta', /0002/);
  await page.getByRole('button', { name: 'Agregar desde remitos y pedidos' }).click();
  await page.getByRole('checkbox', { name: /Elegir R \d{4}-/ }).first().check();
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Precio unitario' }).last()).toHaveValue('4800');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText(/autorizada/)).toBeVisible();

  await page.goto('/ventas/pedidos');
  await expect(page.getByText('Parcialmente entregado').first()).toBeVisible();
});
