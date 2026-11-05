import { expect, Page, test } from '@playwright/test';

const unico = String(Date.now()).slice(-7);
const PROVEEDOR = 'Consultora Delta S.R.L.';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

async function salir(page: Page) {
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
}

async function elegir(page: Page, etiqueta: string | RegExp, opcion: string, contenedor: Page | ReturnType<Page['getByRole']> = page) {
  await contenedor.getByRole('textbox', { name: etiqueta }).first().click();
  await page.getByRole('option', { name: opcion, exact: true }).click();
}

test('pagos: factura → OP → aprobación → pago con retenciones → cuenta corriente en cero', async ({ page }) => {
  test.setTimeout(120000);

  // 1. Factura directa del proveedor (sin documentos previos)
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/compras/factura');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await elegir(page, 'Letra', 'A');
  await page.getByLabel('Punto de venta').fill('3');
  await page.getByRole('textbox', { name: /^Número/ }).fill(unico);
  await page.getByRole('button', { name: 'Renglón directo' }).click();
  await page.getByLabel('Descripción').first().fill('Consultoría mensual');
  await page.getByLabel('Cantidad').first().fill('1');
  await page.getByLabel('Precio unitario').first().fill('1500000');
  await page.getByLabel('Total del comprobante (como figura en el papel)').fill('1815000');
  await page.getByRole('button', { name: 'Guardar comprobante' }).click();
  await expect(page.getByText(/Comprobante cargado/)).toBeVisible();

  // 2. Orden de pago (supera el límite: queda pendiente)
  await page.goto('/pagos/op/nueva');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await page.getByRole('checkbox', { name: 'Seleccionar todos' }).check();
  await expect(page.getByTestId('total-cancelar')).toContainText('$ 1.815.000,00');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Pendiente de aprobación').first()).toBeVisible();
  await salir(page);

  // 3. El aprobador la aprueba
  await ingresar(page, 'aprobador@demo.com', 'aprobador1234');
  await page.goto('/pagos/op/aprobacion');
  await page.getByRole('cell', { name: PROVEEDOR }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aprobar' }).click();
  await page.getByRole('dialog', { name: 'Aprobar' }).getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Operación realizada')).toBeVisible();
  await page.keyboard.press('Escape');
  await salir(page);

  // 4. El tesorero paga: transferencia + e-cheq por el resto
  await ingresar(page, 'tesorero@demo.com', 'tesorero1234');
  await page.goto('/pagos/pago');
  await page.getByRole('cell', { name: PROVEEDOR }).first().click();
  const pago = page.getByRole('dialog');
  // Ganancias (1.500.000 − 67.170) × 2 % = 28.656,60; IIBB padrón 1 % = 15.000
  await expect(pago.getByText('Neto a pagar $ 1.771.343,40')).toBeVisible();
  await pago.getByRole('button', { name: 'Agregar medio' }).click();
  await elegir(page, 'Cuenta bancaria', 'Banco de la Nación Argentina - 1234567/8', pago);
  await pago.getByLabel('Importe del medio').first().fill('1000000');
  await pago.getByRole('button', { name: 'Agregar medio' }).click();
  await pago.getByRole('textbox', { name: 'Medio', exact: true }).nth(1).click();
  await page.getByRole('option', { name: 'Cheque', exact: true }).click();
  await elegir(page, 'Chequera', 'E-cheq Banco de la Nación Argentina - 1234567/8', pago);
  await pago.getByLabel('Número de cheque').fill(`E-${unico}`);
  await pago.getByLabel('Fecha de pago del cheque').fill('2030-01-15');
  await expect(pago.getByTestId('falta-cubrir')).toHaveCount(0);
  await pago.getByRole('button', { name: 'Pagar' }).click();
  await expect(pago.getByText(/pagada\./)).toBeVisible();
  await expect(pago.getByRole('button', { name: /Descargar certificado RET-GAN/ })).toBeVisible();
  await pago.getByRole('button', { name: 'Cerrar' }).click();

  // 5. Retenciones practicadas y cuenta corriente en cero
  await page.goto('/pagos/retenciones');
  await expect(page.getByRole('cell', { name: PROVEEDOR }).first()).toBeVisible();
  await page.goto('/compras/cuenta-corriente');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await expect(page.getByTestId('saldo-pesos')).toHaveText('$ 0,00');
});
