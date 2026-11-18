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

/** Fecha AAAA-MM-DD en la hora argentina (la del servidor), desplazada en días. */
function fecha(dias: number) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// El navegador en la hora argentina, como los usuarios: las fechas por defecto de los formularios coinciden con las del servidor
test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

test('cobranzas: el tesorero ve la agenda, registra un llamado con promesa y la agenda la muestra pendiente', async ({ page }) => {
  test.setTimeout(120000);
  // 1. Una factura vencida ayer a María Gómez (ninguna otra prueba usa esa clienta)
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', 'María Gómez');
  await elegir(page, 'Punto de venta', /^0002/);
  await page.getByLabel('Fecha', { exact: true }).fill(fecha(-2));
  await page.getByLabel('Vencimiento', { exact: true }).fill(fecha(-1));
  await page.getByLabel('Descripción').first().fill('Servicio impago');
  await page.getByLabel('Precio unitario').first().fill('5000');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible();

  // 2. El tesorero (solo con el permiso de cobranzas en Ventas) abre la agenda y la ficha
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByLabel('Email')).toBeVisible();
  await ingresar(page, 'tesorero@demo.com', 'tesorero1234');
  await page.goto('/ventas/cobranzas');
  await page.getByRole('cell', { name: 'María Gómez', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'María Gómez' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Servicio|FC|Factura/ }).first()).toBeVisible();

  // 3. Registra un llamado con promesa para mañana
  await page.getByLabel('Nota').fill('Dice que paga mañana');
  await page.getByLabel('Fecha de la promesa').fill(fecha(1));
  await page.getByLabel('Importe prometido').fill('6050');
  await page.getByRole('button', { name: 'Registrar gestión' }).click();
  await expect(page.getByText('Gestión registrada')).toBeVisible();
  await expect(page.getByText('Dice que paga mañana')).toBeVisible();

  // 4. La agenda muestra la promesa pendiente
  await page.getByRole('button', { name: 'Volver a la agenda' }).click();
  await expect(page.getByRole('row', { name: /María Gómez/ }).getByText('Pendiente')).toBeVisible();
});
