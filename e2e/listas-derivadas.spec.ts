import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test('listas derivadas: lista desde la Minorista −10 %, recálculo con vista previa y precios aplicados', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/maestros/listas-precios');
  await page.getByRole('button', { name: 'Nueva lista' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Nombre').fill('Distribuidor');
  await d.getByRole('textbox', { name: 'Base' }).click();
  await page.getByRole('option', { name: 'Otra lista' }).click();
  await d.getByRole('textbox', { name: 'Lista base' }).click();
  await page.getByRole('option', { name: 'Minorista', exact: true }).click();
  await d.getByLabel('Porcentaje (+ recargo / − descuento)').fill('-10');
  await d.getByRole('textbox', { name: 'Redondeo' }).click();
  await page.getByRole('option', { name: 'A $ 1', exact: true }).click();
  await d.getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByText('Lista creada')).toBeVisible();

  await page.getByRole('button', { name: 'Recalcular' }).click();
  const m = page.getByRole('dialog', { name: 'Recalcular Distribuidor' });
  await expect(m.getByLabel(/^Recalcular LIB-CONT/)).toBeChecked();
  await m.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText(/Precios actualizados: 0 · agregados: \d+/)).toBeVisible();
  await expect(page.getByLabel('Precio LIB-CONT')).toHaveValue('10.800');
});
