import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test('sueldos: el contador da de alta un empleado, carga la escala, liquida, cierra y descarga recibos', async ({ page }) => {
  await ingresar(page, 'contador@demo.com', 'contador1234');
  // Alta del empleado
  await page.goto('/sueldos/empleados');
  await page.getByRole('button', { name: 'Nuevo empleado' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Apellido').fill('Gómez');
  await dlg.getByLabel('Nombre', { exact: true }).fill('Ana');
  await dlg.getByLabel('CUIL').fill('27-28033514-8');
  await dlg.getByLabel('Fecha de ingreso').fill('2021-03-01');
  await dlg.getByRole('textbox', { name: 'Categoría' }).click();
  await page.getByRole('option', { name: 'Comercio (CCT 130/75) · Vendedor B' }).click();
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('cell', { name: 'Gómez, Ana' })).toBeVisible();
  // Escala del mes
  await page.goto('/sueldos/convenios');
  const basico = page.getByLabel('Básico Vendedor B');
  await basico.fill('1000000');
  await basico.blur();
  await expect(page.getByRole('row', { name: /Vendedor B/ }).getByText('$ 1.000.000,00')).toBeVisible();
  // Liquidación del mes
  await page.goto('/sueldos/liquidaciones');
  await page.getByRole('button', { name: 'Nueva liquidación' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Crear y calcular' }).click();
  await expect(page.getByRole('heading', { name: /^Liquidación / })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Gómez, Ana' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar liquidación' }).click();
  await expect(page.getByText('Cerrada', { exact: true })).toBeVisible();
  // Recibos
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Recibos PDF' }).click();
  expect((await descarga).suggestedFilename()).toMatch(/^recibos-\d{4}-\d{2}\.pdf$/);
});
