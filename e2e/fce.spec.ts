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

function cuitUnico(): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = '30' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const r = 11 - (pesos.reduce((t, p, i) => t + p * Number(base[i]), 0) % 11);
    if (r === 10) continue;
    return `${base.slice(0, 2)}-${base.slice(2)}-${r === 11 ? 0 : r}`;
  }
}

test('factura de crédito MiPyME: configuración, cliente obligado, emisión y estado en el registro', async ({ page }) => {
  test.setTimeout(120000);
  await ingresar(page, 'admin@demo.com', 'admin1234');

  // 1. La empresa es MiPyME y tiene la cuenta con CBU
  await page.goto('/admin/arca');
  const mipyme = page.getByLabel('La empresa es MiPyME');
  if (!(await mipyme.isChecked())) {
    const r = page.waitForResponse((x) => x.url().includes('/api/arca/config') && x.request().method() === 'PUT');
    await page.getByText('La empresa es MiPyME').click();
    expect((await r).status()).toBe(200);
  }
  await page.getByRole('textbox', { name: 'Cuenta bancaria para la factura de crédito' }).click();
  const guardado = page.waitForResponse((r) => r.url().includes('/api/arca/config') && r.request().method() === 'PUT');
  await page.getByRole('option', { name: /CBU/ }).first().click();
  expect((await guardado).status()).toBe(200);

  // 2. Cliente nuevo marcado como obligado (en SIMULADO la marca hace de registro)
  const nombre = `Grande FCE ${Date.now()}`;
  await page.goto('/maestros/terceros');
  await page.getByRole('button', { name: 'Nuevo' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Razón social').fill(nombre);
  await dlg.getByLabel('CUIT').fill(cuitUnico());
  await dlg.getByLabel('Es proveedor').uncheck();
  await dlg.getByLabel('Es cliente').check();
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(dlg).toBeHidden();
  await page.getByText('Clientes', { exact: true }).click();
  await page.getByRole('cell', { name: nombre }).first().click();
  const ficha = page.getByRole('dialog');
  await ficha.getByRole('tab', { name: 'Impuestos' }).click();
  await ficha.getByLabel('Obligado a recibir factura de crédito MiPyME (marca manual)').check();
  await ficha.getByRole('tabpanel', { name: 'Impuestos' }).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Datos impositivos guardados')).toBeVisible();
  await page.keyboard.press('Escape');

  // 3. La factura propone la FCE y se emite
  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', nombre);
  await expect(page.getByRole('heading', { name: 'Factura A' })).toBeVisible();
  await expect(page.getByLabel('Factura de crédito MiPyME (FCE)')).toBeChecked();
  await expect(page.getByText('Corresponde factura de crédito: el cliente está obligado', { exact: true })).toBeVisible();
  await elegir(page, 'Punto de venta', /^0002/);
  await page.getByLabel('Descripción').first().fill('Servicio FCE');
  await page.getByLabel('Precio unitario').first().fill('10000');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible();

  // 4. En la lista de facturas de crédito emitidas, pendiente de aceptación
  await page.goto('/ventas/fce');
  await page.getByRole('button', { name: 'Actualizar desde ARCA' }).click();
  await expect(page.getByText(/facturas de crédito actualizadas/)).toBeVisible();
  const fila = page.getByRole('row', { name: new RegExp(nombre) });
  await expect(fila).toContainText('Pendiente');
  await expect(fila).toContainText('FCE A');
});
