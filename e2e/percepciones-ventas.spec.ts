import { expect, Page, test } from '@playwright/test';

const CLIENTE = 'Supermercados Litoral S.A.';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

async function elegir(page: Page, etiqueta: string, opcion: string | RegExp) {
  await page.getByRole('textbox', { name: etiqueta }).first().click();
  await page.getByRole('option', { name: opcion }).first().click();
}

// Corre al final de la cadena: activa la percepción de IIBB Buenos Aires en la empresa demo
test('percepciones: el administrador activa la percepción de ARBA, carga la ficha del cliente y factura con percepción', async ({ page }) => {
  test.setTimeout(120000);
  await ingresar(page, 'admin@demo.com', 'admin1234');

  // 1. Percepción de IIBB Buenos Aires
  await page.goto('/admin/retenciones');
  await expect(page.getByRole('heading', { name: 'Retenciones y percepciones' })).toBeVisible();
  await page.getByRole('tab', { name: 'Ingresos Brutos' }).click();
  // El interruptor de Mantine es un input oculto dentro de una tabla con desplazamiento: se le envía el clic
  const percibe = page.getByRole('row', { name: /902/ }).getByLabel('Percibe');
  await expect(percibe).toBeAttached();
  if (!(await percibe.isChecked())) await percibe.dispatchEvent('click');
  await expect(page.getByRole('row', { name: /902/ }).getByLabel('Percibe')).toBeChecked();
  await page.getByRole('button', { name: 'Guardar jurisdicciones' }).click();
  await expect(page.getByText('Jurisdicciones guardadas')).toBeVisible();

  // 2. Alícuota de percepción en la ficha del cliente
  await page.goto('/maestros/terceros');
  await page.getByText('Clientes', { exact: true }).click();
  await page.getByRole('cell', { name: CLIENTE }).first().click();
  const ficha = page.getByRole('dialog');
  await ficha.getByRole('tab', { name: 'Impuestos' }).click();
  await ficha.getByRole('button', { name: 'Agregar jurisdicción' }).click();
  await ficha.getByLabel('Jurisdicción IIBB').last().fill('902');
  await ficha.getByLabel('% Percepción').last().fill('3');
  await ficha.getByRole('button', { name: 'Guardar IIBB' }).click();
  await expect(page.getByText('Ingresos Brutos actualizado')).toBeVisible();
  await page.keyboard.press('Escape');

  // 3. Factura A con la percepción
  await page.goto('/ventas/comprobante');
  await elegir(page, 'Cliente', CLIENTE);
  await expect(page.getByRole('heading', { name: 'Factura A' })).toBeVisible();
  await elegir(page, 'Punto de venta', /^0002/);
  await page.getByLabel('Descripción').first().fill('Servicio con percepción');
  await page.getByLabel('Precio unitario').first().fill('10000');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(page.getByText('Autorizado', { exact: true })).toBeVisible();
  await expect(page.getByText('Percepción IIBB 902 Buenos Aires 3 % (ficha)')).toBeVisible();
  await expect(page.getByTestId('total-venta')).toHaveText('Total $ 12.400,00');
});
