import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

/** Mes anterior al actual en 'AAAA-MM' (la otra prueba de sueldos usa el actual). */
function mesAnterior(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

test('sueldos: el contador cierra, ve el asiento, paga los netos, descarga el F.931 y paga las cargas sociales', async ({ page }) => {
  const mes = mesAnterior();
  await ingresar(page, 'contador@demo.com', 'contador1234');
  // Empleado
  await page.goto('/sueldos/empleados');
  await page.getByRole('button', { name: 'Nuevo empleado' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Apellido').fill('Ruiz');
  await dlg.getByLabel('Nombre', { exact: true }).fill('Carla');
  await dlg.getByLabel('CUIL').fill('20-12345678-6');
  await dlg.getByLabel('Fecha de ingreso').fill('2021-03-01');
  await dlg.getByRole('textbox', { name: 'Categoría' }).click();
  await page.getByRole('option', { name: 'Comercio (CCT 130/75) · Vendedor B' }).click();
  await dlg.getByLabel('Código de obra social (RNOS)').fill('125000');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('cell', { name: 'Ruiz, Carla' })).toBeVisible();
  // Escala del mes anterior
  await page.goto('/sueldos/convenios');
  await page.getByLabel('Mes', { exact: true }).fill(mes);
  const basico = page.getByLabel('Básico Vendedor B');
  await basico.fill('1000000');
  await basico.blur();
  await expect(page.getByRole('row', { name: /Vendedor B/ }).getByText('$ 1.000.000,00')).toBeVisible();
  // Liquidación del mes anterior, cierre y asiento
  await page.goto('/sueldos/liquidaciones');
  await page.getByRole('button', { name: 'Nueva liquidación' }).click();
  await page.getByRole('dialog').getByLabel('Mes', { exact: true }).fill(mes);
  await page.getByRole('dialog').getByRole('button', { name: 'Crear y calcular' }).click();
  await expect(page.getByRole('cell', { name: 'Ruiz, Carla' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar liquidación' }).click();
  await expect(page.getByText(/^Asiento N°/)).toBeVisible();
  // Pago de los netos desde el banco
  await page.getByRole('tab', { name: /Pagos/ }).click();
  await page.getByRole('button', { name: 'Pagar todos los pendientes' }).click();
  const pago = page.getByRole('dialog');
  await pago.getByRole('textbox', { name: 'Desde' }).click();
  await page.getByRole('option', { name: /Banco de la Nación Argentina/ }).click();
  await pago.getByRole('button', { name: 'Pagar' }).click();
  await expect(page.getByText('Pagado', { exact: true }).first()).toBeVisible();
  // F.931
  await page.getByRole('tab', { name: 'Recibos' }).click();
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar F.931' }).click();
  expect((await descarga).suggestedFilename()).toBe(`F931-${mes.replace('-', '')}.txt`);
  // Cargas sociales
  await page.goto('/sueldos/cargas-sociales');
  await page.getByLabel('Mes', { exact: true }).fill(mes);
  const fila = page.getByRole('row', { name: /2\.1\.03\.002 Cargas sociales a pagar/ });
  await fila.getByRole('button', { name: 'Pagar' }).click();
  const dc = page.getByRole('dialog');
  await dc.getByRole('textbox', { name: 'Desde' }).click();
  await page.getByRole('option', { name: /Banco de la Nación Argentina/ }).click();
  await dc.getByRole('button', { name: 'Pagar' }).click();
  await expect(fila.getByRole('cell', { name: '$ 0,00' })).toBeVisible();
});
