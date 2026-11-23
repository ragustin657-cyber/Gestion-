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

test('ventas: factura con bonificación por renglón y descuento general', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'facturacion@demo.com', 'facturacion1234');
  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', 'Consumidor Final');
  await expect(page.getByRole('heading', { name: 'Factura B' })).toBeVisible();
  await elegir(page, 'Punto de venta', /^0002/);
  await page.getByLabel('Descripción').first().fill('Servicio con descuento');
  await page.getByLabel('Precio unitario').first().fill('10000');
  await page.getByLabel('Bonificación %').first().fill('10');
  await page.getByLabel('Descuento general (%)').fill('5');
  await expect(page.getByText('Descuento general 5 %')).toBeVisible();
  await expect(page.getByTestId('total-venta')).toHaveText('Total $ 10.345,50');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible();
});
