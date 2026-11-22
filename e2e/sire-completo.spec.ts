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

// Corre al final de la cadena: marca a un proveedor demo como beneficiario del exterior
test('Ganancias exterior: el administrador carga el régimen, marca al proveedor, paga y genera el F.2003', async ({ page }) => {
  test.setTimeout(120000);
  await ingresar(page, 'admin@demo.com', 'admin1234');

  // 1. Régimen de Ganancias exterior
  await page.goto('/admin/retenciones');
  await page.getByRole('tab', { name: 'Ganancias exterior' }).click();
  await page.getByRole('button', { name: 'Nuevo' }).click();
  const reg = page.getByRole('dialog');
  await reg.getByLabel('Código de régimen SIRE (3 dígitos)').fill('160');
  await reg.getByLabel('Descripción').fill('Honorarios del exterior');
  await reg.getByLabel('Alícuota sin convenio (%)').fill('31,5');
  await reg.getByLabel('Código de alícuota sin convenio').fill('100');
  await reg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('cell', { name: 'Honorarios del exterior' })).toBeVisible();

  // 2. Datos del exterior en la ficha del proveedor
  await page.goto('/maestros/terceros');
  await page.getByRole('cell', { name: PROVEEDOR }).first().click();
  const ficha = page.getByRole('dialog');
  await ficha.getByRole('tab', { name: 'Impuestos' }).click();
  const exterior = ficha.getByLabel('Beneficiario del exterior');
  if (!(await exterior.isChecked())) await exterior.dispatchEvent('click');
  await elegir(page, 'Régimen de Ganancias exterior', 'Honorarios del exterior', ficha);
  await ficha.getByLabel('Clave tributaria en su país (NIF)').fill('US-987654321');
  await ficha.getByLabel('País de residencia (código SIRE)').fill('212');
  await ficha.getByLabel('Domicilio en el exterior').fill('1 Main St, New York');
  await elegir(page, 'Tipo de persona', 'Jurídica', ficha);
  await ficha.getByRole('button', { name: 'Guardar' }).first().click();
  await expect(page.getByText('Datos impositivos guardados')).toBeVisible();
  await page.keyboard.press('Escape');

  // 3. Factura de 100.000 + IVA
  await page.goto('/compras/factura');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await elegir(page, 'Letra', 'A');
  await page.getByLabel('Punto de venta').fill('8');
  await page.getByRole('textbox', { name: /^Número/ }).fill(unico);
  await page.getByRole('button', { name: 'Renglón directo' }).click();
  await page.getByLabel('Descripción').first().fill('Consultoría');
  await page.getByLabel('Cantidad').first().fill('1');
  await page.getByLabel('Precio unitario').first().fill('100000');
  await page.getByLabel('Total del comprobante (como figura en el papel)').fill('121000');
  await page.getByRole('button', { name: 'Guardar comprobante' }).click();
  await expect(page.getByText(/Comprobante cargado/)).toBeVisible();

  // 4. Orden de pago y pago: solo la retención de Ganancias exterior
  await page.goto('/pagos/op/nueva');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await page.getByRole('row', { name: new RegExp(`00008-${unico.padStart(8, '0')}`) }).getByRole('checkbox', { name: 'Seleccionar' }).check();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Aprobada').first()).toBeVisible();
  await page.goto('/pagos/pago');
  await page.getByRole('row', { name: new RegExp(PROVEEDOR) }).filter({ hasText: '121.000' }).first().click();
  const pago = page.getByRole('dialog');
  await pago.getByLabel('Fecha de pago').fill('2026-12-01');
  await expect(pago.getByText('Ganancias exterior (régimen 160)')).toBeVisible();
  await expect(pago.getByText(/IVA factura/)).toHaveCount(0);
  await pago.getByRole('button', { name: 'Agregar medio' }).click();
  await elegir(page, 'Cuenta bancaria', 'Banco de la Nación Argentina - 1234567/8', pago);
  await expect(pago.getByTestId('falta-cubrir')).toHaveCount(0);
  await pago.getByRole('button', { name: 'Pagar' }).click();
  await expect(pago.getByText(/pagada\./)).toBeVisible();
  await page.keyboard.press('Escape');

  // 5. Retenciones practicadas: el certificado SIRE se carga en la fila
  await page.goto('/pagos/retenciones');
  await page.getByLabel('Desde').fill('2026-12-01');
  await page.getByLabel('Hasta').fill('2026-12-31');
  const cert = page.getByLabel(/^Certificado SIRE de RET-GAN-EXT/);
  await cert.fill('SIRE-E2E-1');
  await cert.blur();
  await expect(page.getByText('Certificado SIRE guardado')).toBeVisible();

  // 6. F.2003 del mes
  await page.goto('/impuestos/generar');
  await elegir(page, 'Presentación', 'SIRE Ganancias exterior (F.2003)');
  await elegir(page, 'Mes', 'Diciembre');
  await page.getByLabel('Año').fill('2026');
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar' }).click();
  const d = await descarga;
  expect(d.suggestedFilename()).toMatch(/^SIRE-F2003_\d{11}_202612\.txt$/);
  const [primera] = (await readFile((await d.path())!, 'latin1')).split(/\r?\n/);
  expect(primera).toHaveLength(415);
  expect([primera.slice(0, 4), primera.slice(29, 35)]).toEqual(['2003', '218160']);
});
