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

/** Mes actual 'MM/AAAA' (el de la mensual que cierra la prueba de sueldos del proyecto general). */
function mesActual() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

test('comisiones: el administrador cobra una factura de un vendedor empleado, liquida las comisiones y la mensual de sueldos tiene la novedad', async ({ page }) => {
  test.setTimeout(120000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  const mm = mesActual();

  // 1. Vendedor empleado: la empleada que dio de alta la prueba de sueldos
  await page.goto('/maestros/vendedores');
  await page.getByRole('button', { name: 'Nuevo vendedor' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nombre').fill('Gómez');
  await dlg.getByRole('textbox', { name: 'Empleado' }).click();
  await page.getByRole('option', { name: 'Gómez, Ana' }).click();
  await dlg.getByLabel('Comisión (%)').fill('3');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('cell', { name: 'Gómez', exact: true })).toBeVisible();

  // 2. Factura con la vendedora y recibo que la cancela
  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await elegir(page, 'Punto de venta', /^0002/);
  await elegir(page, 'Vendedor', 'Gómez');
  await page.getByLabel('Descripción').first().fill('Servicio con comisión');
  await page.getByLabel('Precio unitario').first().fill('10000');
  await expect(page.getByTestId('total-venta')).toHaveText('Total $ 12.100,00');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible();

  await page.goto('/ventas/recibo');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await elegir(page, 'Punto de venta', /^0002/);
  await elegir(page, 'Caja', /^Caja principal/);
  await page.getByLabel('Efectivo', { exact: true }).fill('12100');
  await page.getByRole('button', { name: 'Aplicar automático' }).click();
  await page.getByRole('button', { name: 'Confirmar recibo' }).click();
  await expect(page.getByText(/Recibo 0002-\d{8} registrado/)).toBeVisible();

  // 3. La mensual del mes está cerrada (prueba de sueldos): se reabre para recibir la comisión
  await page.goto('/sueldos/liquidaciones');
  await page.getByRole('cell', { name: mm, exact: true }).first().click();
  await page.getByRole('button', { name: 'Reabrir' }).click();
  await expect(page.getByText('Liquidación reabierta')).toBeVisible();

  // 4. Comisiones del mes: Gómez con 3 % de 10.000
  await page.goto('/ventas/comisiones');
  await expect(page.getByRole('row', { name: /Gómez.*\$ 300,00/ })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar liquidación' }).click();
  await expect(page.getByText(/Liquidación de comisiones N° \d+ confirmada/)).toBeVisible();

  // 5. La mensual tiene la novedad de comisiones; se vuelve a cerrar
  await page.goto('/sueldos/liquidaciones');
  await page.getByRole('cell', { name: mm, exact: true }).first().click();
  await page.getByRole('cell', { name: 'Gómez, Ana' }).click();
  await expect(page.getByText(`Comisiones ${mm}: $ 300,00 (de la liquidación de comisiones)`)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cerrar liquidación' }).click();
  await expect(page.getByText('Cerrada', { exact: true })).toBeVisible();
});
