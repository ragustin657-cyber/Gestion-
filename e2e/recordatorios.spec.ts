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

/** Fecha AAAA-MM-DD en la hora argentina, desplazada en días. */
function fecha(dias: number) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

test('recordatorios: el administrador configura el correo, envía el resumen a un cliente y lo ve como gestión', async ({ page }) => {
  test.setTimeout(120000);
  await ingresar(page, 'admin@demo.com', 'admin1234');

  // 1. Correo de la empresa (el servidor de pruebas guarda los mails en vez de enviarlos)
  await page.goto('/ventas/correo');
  await page.getByLabel('Servidor SMTP').fill('smtp.prueba.local');
  await page.getByLabel('Usuario').fill('cobranzas@demo.com');
  await page.getByLabel('Clave').fill('clave-de-prueba');
  await page.getByLabel('Nombre del remitente').fill('Cobranzas Demo');
  await page.getByLabel('Email del remitente').fill('cobranzas@demo.com');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Configuración guardada')).toBeVisible();

  // 2. Un cliente propio con email y una factura vencida ayer
  const nombre = `Cliente Mail ${Date.now().toString().slice(-6)}`;
  await page.goto('/maestros/terceros');
  await page.getByRole('button', { name: 'Nuevo' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Razón social').fill(nombre);
  await dlg.getByLabel('CUIT').fill(cuitUnico());
  await dlg.getByLabel('Email').fill('cliente@prueba.local');
  await dlg.getByLabel('Es proveedor').uncheck();
  await dlg.getByLabel('Es cliente').check();
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(dlg).toBeHidden();
  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', nombre);
  await elegir(page, 'Punto de venta', /^0002/);
  await page.getByLabel('Fecha', { exact: true }).fill(fecha(-2));
  await page.getByLabel('Vencimiento', { exact: true }).fill(fecha(-1));
  await page.getByLabel('Descripción').first().fill('Servicio');
  await page.getByLabel('Precio unitario').first().fill('8000');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible();

  // 3. Desde la agenda, la ficha del cliente: enviar el resumen por mail
  await page.goto('/ventas/cobranzas');
  await page.getByRole('cell', { name: nombre, exact: true }).click();
  await page.getByRole('button', { name: 'Enviar resumen por mail' }).click();
  const mail = page.getByRole('dialog');
  await expect(mail.getByLabel('Para')).toHaveValue('cliente@prueba.local');
  await mail.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Mail enviado')).toBeVisible();
  await expect(page.getByText('Resumen de cuenta enviado a cliente@prueba.local')).toBeVisible();
});
