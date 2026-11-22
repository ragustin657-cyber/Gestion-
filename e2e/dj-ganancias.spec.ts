import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

// Corre al final: usa los índices que cargaron las pruebas de amortización y ajuste impositivo
test('DJ de Ganancias: el administrador carga la escala, abre la DJ del ejercicio, agrega un ajuste y ve impuesto y anticipos', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');

  await page.goto('/admin/impuestos');
  await page.getByRole('button', { name: 'Copiar escala de la ley 27.630' }).click();
  await expect(page.getByLabel('Monto fijo (tramo 3)')).toHaveValue('14.750.000');
  await page.getByRole('button', { name: 'Guardar escala' }).click();
  await expect(page.getByText('Escala guardada')).toBeVisible();

  await page.goto('/impuestos/dj-ganancias');
  await expect(page.getByText('Impuesto determinado')).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo ajuste' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Concepto').fill('Gastos no deducibles');
  await modal.getByLabel('Importe (con signo)').fill('10000000');
  await modal.getByRole('button', { name: 'Guardar ajuste' }).click();
  await expect(page.getByText('Ajuste guardado')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Gastos no deducibles' })).toBeVisible();
  await expect(page.getByText(/^Anticipos del ejercicio siguiente/)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: /^10/ }).first()).toBeVisible();
});
