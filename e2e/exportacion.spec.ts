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

/** Llamada a la API con la sesión del navegador (para preparar datos maestros). */
async function apiDesde(page: Page, metodo: string, url: string, body?: unknown) {
  return page.evaluate(async ({ metodo, url, body }) => {
    const s = JSON.parse(localStorage.getItem('gestion.sesion') ?? '{}');
    const r = await fetch(`/api${url}`, { method: metodo, headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { metodo, url, body });
}

test('exportación: factura E de servicios a un cliente del exterior', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  expect((await apiDesde(page, 'POST', '/empresas/actual/puntos-venta', { numero: 9, descripcion: 'Exportación', exportacion: true })).status).toBe(201);
  expect((await apiDesde(page, 'POST', '/terceros', { esCliente: true, razonSocial: 'Globex Corp.', cuit: '55000002127', tipoDocumento: 'OTRO', condicionIva: 'CONSUMIDOR_FINAL', residenteExterior: true, nif: 'US-987654321', paisSire: 212, domicilioExterior: '2 Main St, Boston', cuitPais: '55000002126' })).status).toBe(201);

  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', 'Globex Corp.');
  await expect(page.getByRole('heading', { name: 'Factura E' })).toBeVisible();
  await elegir(page, 'Punto de venta', /^0009/);
  await page.getByRole('textbox', { name: 'Cotización' }).fill('1000');
  await elegir(page, 'País de destino', /Estados Unidos/);
  await page.getByLabel('Descripción').first().fill('Desarrollo de software');
  await page.getByLabel('Precio unitario').first().fill('1500');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible({ timeout: 20000 });
});
