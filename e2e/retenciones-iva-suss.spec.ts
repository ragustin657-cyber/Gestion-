import { expect, Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PROVEEDOR = 'Servicios Informáticos Pampa S.A.';
const unico = String(Date.now()).slice(-7);

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

async function elegir(page: Page, etiqueta: string | RegExp, opcion: string, contenedor: Page | ReturnType<Page['getByRole']> = page) {
  await contenedor.getByRole('textbox', { name: etiqueta }).first().click();
  await page.getByRole('option', { name: opcion, exact: true }).click();
}

// Corre al final de la cadena: activa la empresa demo como agente de IVA
test('retenciones de IVA: el administrador configura, paga una factura y descarga el SIRE del mes', async ({ page }) => {
  test.setTimeout(120000);
  await ingresar(page, 'admin@demo.com', 'admin1234');

  // 1. Empresa agente de retención de IVA
  await page.goto('/admin/empresa');
  await page.getByLabel('Agente de retención de IVA').check();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(/guardad/i).first()).toBeVisible();

  // 2. Código SIRE del régimen de compraventa
  await page.goto('/admin/retenciones');
  await page.getByRole('tab', { name: 'IVA', exact: true }).click();
  await expect(page.getByText('Cargue el código SIRE del régimen Compraventa de cosas muebles')).toBeVisible();
  await page.getByRole('cell', { name: 'Compraventa de cosas muebles' }).click();
  await page.getByRole('dialog').getByLabel('Código SIRE (3 dígitos)').fill('499');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Cargue el código SIRE del régimen Compraventa de cosas muebles')).toHaveCount(0);

  // 3. Régimen de IVA en la ficha del proveedor
  await page.goto('/maestros/terceros');
  await page.getByRole('cell', { name: PROVEEDOR }).first().click();
  const ficha = page.getByRole('dialog');
  await ficha.getByRole('tab', { name: 'Impuestos' }).click();
  await elegir(page, 'Régimen de retención de IVA', 'Compraventa de cosas muebles', ficha);
  await ficha.getByRole('button', { name: 'Guardar' }).first().click();
  await expect(page.getByText('Datos impositivos guardados')).toBeVisible();
  await page.keyboard.press('Escape');

  // 4. Factura A de 100.000 + IVA
  await page.goto('/compras/factura');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await elegir(page, 'Letra', 'A');
  await page.getByLabel('Punto de venta').fill('7');
  await page.getByRole('textbox', { name: /^Número/ }).fill(unico);
  await page.getByRole('button', { name: 'Renglón directo' }).click();
  await page.getByLabel('Descripción').first().fill('Soporte técnico');
  await page.getByLabel('Cantidad').first().fill('1');
  await page.getByLabel('Precio unitario').first().fill('100000');
  await page.getByLabel('Total del comprobante (como figura en el papel)').fill('121000');
  await page.getByRole('button', { name: 'Guardar comprobante' }).click();
  await expect(page.getByText(/Comprobante cargado/)).toBeVisible();

  // 5. Orden de pago solo de esa factura (bajo el límite: queda aprobada) y pago
  await page.goto('/pagos/op/nueva');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await page.getByRole('row', { name: new RegExp(`00007-${unico.padStart(8, '0')}`) }).getByRole('checkbox', { name: 'Seleccionar' }).check();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Aprobada').first()).toBeVisible();
  await page.goto('/pagos/pago');
  await page.getByRole('row', { name: new RegExp(PROVEEDOR) }).filter({ hasText: '121.000' }).first().click();
  const pago = page.getByRole('dialog');
  // La cuenta bancaria demo quedó conciliada hasta fin de noviembre (e2e de conciliación): se paga el 1/12
  await pago.getByLabel('Fecha de pago').fill('2026-12-01');
  // IVA 21.000 × 50 % = 10.500
  await expect(pago.getByText(/IVA factura A 00007-/)).toBeVisible();
  await pago.getByRole('button', { name: 'Agregar medio' }).click();
  await elegir(page, 'Cuenta bancaria', 'Banco de la Nación Argentina - 1234567/8', pago);
  await expect(pago.getByTestId('falta-cubrir')).toHaveCount(0);
  await pago.getByRole('button', { name: 'Pagar' }).click();
  await expect(pago.getByText(/pagada\./)).toBeVisible();
  await expect(pago.getByRole('button', { name: /Descargar certificado RET-IVA/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // 6. SIRE IVA del mes
  await page.goto('/impuestos/generar');
  await elegir(page, 'Presentación', 'SIRE IVA (F.2005)');
  await elegir(page, 'Mes', 'Diciembre');
  await page.getByLabel('Año').fill('2026');
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar' }).click();
  const d = await descarga;
  expect(d.suggestedFilename()).toMatch(/^SIRE-F2005_\d{11}_202612\.txt$/);
  const [primera] = (await readFile((await d.path())!, 'latin1')).split(/\r?\n/);
  expect(primera).toHaveLength(305);
  expect(primera.slice(0, 4)).toBe('0100');
  expect(primera.slice(40, 46)).toBe('216499');
});
