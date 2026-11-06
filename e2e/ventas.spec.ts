import { readFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';

const CLIENTE = 'Consumidor Final';

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

test('ventas: factura B electrónica (simulada), PDF, recibo con cheque y retención, cuenta corriente en cero', async ({ page }) => {
  test.setTimeout(120000);
  await ingresar(page, 'facturacion@demo.com', 'facturacion1234');

  // 1. Factura B a consumidor final, emitida en ARCA simulado
  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', CLIENTE);
  await expect(page.getByRole('heading', { name: 'Factura B' })).toBeVisible();
  await elegir(page, 'Punto de venta', /^0002/);
  await page.getByLabel('Descripción').first().fill('Servicio de prueba');
  await page.getByLabel('Precio unitario').first().fill('10000');
  await expect(page.getByTestId('total-venta')).toHaveText('Total $ 12.100,00');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible();
  await expect(page.getByTestId('cae')).toContainText(/CAE \d{14}/);

  // 2. PDF con CAE
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF' }).click();
  const archivo = await (await descarga).path();
  expect(readFileSync(archivo!).subarray(0, 4).toString()).toBe('%PDF');

  // 3. Recibo con un cheque y una retención de IIBB que cancela la factura
  await page.goto('/ventas/recibo');
  await elegir(page, 'Cliente', CLIENTE);
  await elegir(page, 'Punto de venta', /^0002/);
  await elegir(page, 'Caja', /^Caja principal/);
  await page.getByRole('button', { name: 'Agregar cheque' }).click();
  await page.getByLabel('Banco del cheque').fill('Banco Nación');
  await page.getByLabel('Número del cheque').fill(`7${String(Date.now()).slice(-7)}`);
  await page.getByLabel('Librador', { exact: true }).fill('Juan Cliente');
  await page.getByLabel('Importe del cheque').fill('12000');
  await page.getByRole('button', { name: 'Agregar retención' }).click();
  await page.getByLabel('Número de certificado').fill('IIBB-0001');
  await page.getByLabel('Importe de la retención').fill('100');
  await expect(page.getByTestId('total-recibo')).toHaveText('Total $ 12.100,00');
  await page.getByRole('button', { name: 'Aplicar automático' }).click();
  await page.getByRole('button', { name: 'Confirmar recibo' }).click();
  await expect(page.getByText(/Recibo 0002-\d{8} registrado/)).toBeVisible();

  // 4. La cuenta corriente del cliente queda en cero
  await page.goto('/ventas/cuenta-corriente');
  await elegir(page, 'Cliente', CLIENTE);
  await expect(page.getByTestId('saldo-cliente')).toHaveText('Saldo $ 0,00');
});
