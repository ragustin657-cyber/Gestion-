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

test('descuentos por cantidad: rubro con escala, artículo del rubro y bonificación sugerida en la factura', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/maestros/rubros-articulos');
  await page.getByRole('button', { name: 'Nuevo' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill('Almacén');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: 'Escalas de Almacén' }).click();
  await page.getByRole('button', { name: 'Agregar escala' }).click();
  await page.getByLabel('Desde cantidad 1').fill('10');
  await page.getByLabel('% de descuento 1').fill('5');
  await page.getByRole('button', { name: 'Guardar escalas' }).click();
  await expect(page.getByText('Escalas guardadas')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/maestros/articulos');
  await page.getByPlaceholder(/Buscar/).fill('AZU-1K');
  await page.getByRole('cell', { name: 'AZU-1K', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Rubro' }).click();
  await page.getByRole('option', { name: 'Almacén' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('cell', { name: 'Almacén', exact: true })).toBeVisible();

  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await elegir(page, 'Artículo', /AZU-1K/);
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('10');
  await expect(page.getByRole('textbox', { name: 'Bonificación %' })).toHaveValue('5');
});
