import { expect, Page, test } from '@playwright/test';

const unico = String(Date.now()).slice(-7);
const PROVEEDOR = 'Papelera del Plata S.R.L.';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

async function elegir(page: Page, etiqueta: string, opcion: string | RegExp) {
  await page.getByRole('textbox', { name: etiqueta }).first().click();
  await page.getByRole('option', { name: opcion }).click();
}

test('bienes de uso: factura con rodado, amortización del mes y planilla', async ({ page }) => {
  test.setTimeout(90000);
  // 1. Factura de proveedor con un renglón a Rodados: pide los datos del bien
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/compras/factura');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await elegir(page, 'Letra', 'A');
  await page.getByLabel('Punto de venta').fill('3');
  await page.getByRole('textbox', { name: /^Número/ }).fill(unico);
  await page.getByRole('button', { name: 'Renglón directo' }).click();
  await page.getByLabel('Descripción', { exact: true }).fill(`Camioneta ${unico}`);
  await page.getByLabel('Precio unitario').fill('1000000');
  await page.getByRole('textbox', { name: 'Cuenta contable' }).click();
  await page.getByRole('option', { name: '1.2.01.002 Rodados' }).click();
  await expect(page.getByLabel('Descripción del bien')).toHaveValue(`Camioneta ${unico}`);
  await page.getByLabel('Total del comprobante (como figura en el papel)').fill('1210000');
  await page.getByRole('button', { name: 'Guardar comprobante' }).click();
  await expect(page.getByText(/Comprobante cargado/)).toBeVisible();

  // 2. El contador genera la amortización del mes
  await page.getByRole('button', { name: 'Salir' }).click();
  await ingresar(page, 'contador@demo.com', 'contador1234');
  await page.goto('/contabilidad/amortizacion');
  await page.getByRole('button', { name: 'Ver previa' }).click();
  await expect(page.getByRole('cell', { name: `Camioneta ${unico}` })).toBeVisible();
  await page.getByRole('button', { name: 'Generar' }).click();
  await expect(page.getByText(/Amortización generada: asiento N° \d+/)).toBeVisible();

  // 3. La planilla anexa muestra Rodados y coincide con el Mayor
  await page.goto('/contabilidad/planilla-bienes');
  await expect(page.getByRole('cell', { name: 'Rodados' })).toBeVisible();
  await expect(page.getByText('Coincide con el Mayor')).toBeVisible();
});
