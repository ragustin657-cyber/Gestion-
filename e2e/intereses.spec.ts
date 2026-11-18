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
    const base = '20' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const r = 11 - (pesos.reduce((t, p, i) => t + p * Number(base[i]), 0) % 11);
    if (r === 10) continue;
    return `${base.slice(0, 2)}-${base.slice(2)}-${r === 11 ? 0 : r}`;
  }
}

/** Hoy en la hora argentina (la del servidor). */
function hoyAr() {
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).split('-').map(Number);
  return { a, m, d };
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

test('intereses: el administrador configura la tasa, liquida el mes anterior y ve la nota de débito', async ({ page }) => {
  test.setTimeout(120000);
  const { a, m } = hoyAr();
  // La demo tiene un ejercicio calendario: en enero el mes anterior es de otro ejercicio
  test.skip(m === 1, 'En enero el mes anterior pertenece a otro ejercicio');
  const mm = String(m - 1).padStart(2, '0');
  await ingresar(page, 'admin@demo.com', 'admin1234');

  // 1. Un cliente propio (no lo usa ninguna otra prueba)
  const nombre = `Cliente Intereses ${Date.now().toString().slice(-6)}`;
  await page.goto('/maestros/proveedores-clientes');
  await page.getByRole('button', { name: 'Nuevo' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Razón social').fill(nombre);
  await dlg.getByLabel('CUIT').fill(cuitUnico());
  await dlg.getByLabel('Es proveedor').uncheck();
  await dlg.getByLabel('Es cliente').check();
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(dlg).toBeHidden();

  // 2. Factura del mes anterior, vencida el 10
  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', nombre);
  await elegir(page, 'Punto de venta', /^0002/);
  await page.getByLabel('Fecha', { exact: true }).fill(`${a}-${mm}-01`);
  await page.getByLabel('Vencimiento', { exact: true }).fill(`${a}-${mm}-10`);
  await page.getByLabel('Descripción').first().fill('Servicio');
  await page.getByLabel('Precio unitario').first().fill('10000');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible();

  // 3. Configuración (la demo trae 5 %) y liquidación del mes anterior
  await page.goto('/ventas/intereses');
  await expect(page.getByLabel('Tasa mensual (%)')).toHaveValue('5');
  await expect(page.getByLabel(`Cliente ${nombre}`)).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar liquidación' }).click();
  await expect(page.getByText(/Liquidación de intereses N° \d+ confirmada/)).toBeVisible();
  await expect(page.getByText(/Nota de débito \$ [\d.,]+: Autorizada/)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(nombre) }).getByText('Autorizada')).toBeVisible();
});
