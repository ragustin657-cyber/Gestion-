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

test('facturación por lotes: el remito pendiente del cliente se factura en un lote', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/ventas/pedido');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await elegir(page, 'Artículo', /YER-1K/);
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('5');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/Pedido N° \d+ guardado/)).toBeVisible();

  await page.goto('/ventas/remito');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await page.getByRole('checkbox', { name: /Entregar Yerba/ }).last().check();
  await page.getByRole('textbox', { name: /Cantidad Yerba/ }).last().fill('5');
  await page.getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(page.getByText(/Remito R \d{4}-\d{8} registrado/)).toBeVisible();

  await page.goto('/ventas/facturacion-lotes');
  await elegir(page, 'Clientes', 'Constructora Norte S.R.L.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ver', exact: true }).click();
  await expect(page.getByLabel('Elegir Constructora Norte S.R.L.')).toBeChecked();
  await page.getByRole('button', { name: /^Generar 1 factura$/ }).click();
  const fila = page.getByRole('row', { name: /Constructora Norte S\.R\.L\./ });
  await expect(fila.getByText('Emitida')).toBeVisible({ timeout: 30000 });
  await expect(fila.getByText(/[AB] \d{4}-\d{8}/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Ver lote \d+/ }).first()).toBeVisible();
});
