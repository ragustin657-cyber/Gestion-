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
    const r = await fetch(`/api${url}`, { method: metodo, headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', ...(s.empresaId ? { 'X-Empresa-Id': s.empresaId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { metodo, url, body });
}

test('COT de ARBA: configuración, remito con traslado y pedido del COT simulado', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/admin/impuestos');
  await page.getByText('Pedir COT en los remitos').click();
  await page.getByLabel('Usuario (CUIT)').fill('30712345671');
  await page.getByLabel('Clave CIT').fill('clave-cit');
  await page.getByRole('button', { name: 'Guardar COT' }).click();
  await expect(page.getByText('Configuración del COT guardada')).toBeVisible();

  const deps = await apiDesde(page, 'GET', '/depositos');
  for (const d of deps.body as { id: string }[]) {
    expect((await apiDesde(page, 'PATCH', `/depositos/${d.id}`, { calle: 'Av. Mitre', numero: '100', codigoPostal: '1870', localidad: 'Avellaneda', provincia: 'B', plantaArba: 1, puertaArba: 1 })).status).toBe(200);
  }
  const arts = await apiDesde(page, 'GET', '/articulos?q=YER-1K');
  const yerba = (arts.body as { items: { id: string }[] }).items[0];
  expect((await apiDesde(page, 'PATCH', `/articulos/${yerba.id}`, { codigoNomencladorArba: '090300', unidadMedidaArba: '1' })).status).toBe(200);

  await page.goto('/ventas/remito');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await page.getByRole('button', { name: 'Agregar renglón' }).click();
  await elegir(page, 'Artículo', /YER-1K/);
  await page.getByRole('textbox', { name: 'Calle' }).fill('San Martín');
  await page.getByRole('textbox', { name: 'Número' }).fill('50');
  await page.getByRole('textbox', { name: 'Código postal' }).fill('1900');
  await page.getByRole('textbox', { name: 'Localidad' }).fill('La Plata');
  await elegir(page, 'Provincia', 'Buenos Aires');
  await page.getByRole('textbox', { name: 'Patente' }).fill('AB123CD');
  await page.getByRole('button', { name: 'Confirmar remito' }).click();
  await expect(page.getByText(/Remito R \d{4}-\d{8} registrado/)).toBeVisible();
  await expect(page.getByText('COT: SIN_PEDIR')).toBeVisible();

  await page.goto('/ventas/remitos');
  const fila = page.getByRole('row', { name: /Constructora Norte S\.R\.L\..*Sin pedir/ }).first();
  await fila.getByRole('button', { name: 'Pedir COT' }).click();
  await expect(page.getByRole('cell', { name: /^\d{16}$/ }).first()).toBeVisible();
});
