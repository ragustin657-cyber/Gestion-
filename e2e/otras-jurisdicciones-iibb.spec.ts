import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test('otras jurisdicciones de IIBB: recaudación SIRCREB, jurisdicciones de SIRCAR y su presentación', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const periodo = hoy.slice(0, 7).replace('-', '');

  // 1. Recaudación bancaria de Buenos Aires del mes
  await page.goto('/impuestos/recaudaciones-bancarias');
  await page.getByLabel('Período (AAAAMM)').fill(periodo);
  await page.getByRole('button', { name: 'Nueva recaudación' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Jurisdicción' }).click();
  await page.getByRole('option', { name: '902 Buenos Aires', exact: true }).click();
  await d.getByLabel('Importe').fill('1234');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Recaudación guardada')).toBeVisible();
  await expect(page.getByRole('cell', { name: '902 Buenos Aires' })).toBeVisible();

  // 2. La liquidación de IIBB tiene la columna de recaudaciones
  await page.goto('/impuestos/iibb');
  await expect(page.getByRole('columnheader', { name: 'Recaudaciones bancarias' }).first()).toBeVisible();

  // 3. Jurisdicción adherida a SIRCAR y la presentación disponible
  await page.goto('/admin/impuestos');
  await page.getByRole('textbox', { name: 'Jurisdicciones adheridas a SIRCAR' }).click();
  await page.getByRole('option', { name: '904 Córdoba' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Configuración guardada')).toBeVisible();
  await page.goto('/impuestos/generar');
  await page.getByRole('textbox', { name: 'Presentación' }).click();
  await expect(page.getByRole('option', { name: 'SIRCAR retenciones (IIBB Convenio)' })).toBeVisible();
});
