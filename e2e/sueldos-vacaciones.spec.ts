import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

/** Primer día de dentro de dos meses (el mes actual y el siguiente los cierran otras pruebas). */
function dentroDeDosMeses(): { mes: string; anio: number } {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 2);
  return { mes: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, anio: d.getFullYear() };
}

test('sueldos: el contador registra vacaciones, ve el saldo y la mensual con el renglón de vacaciones', async ({ page }) => {
  const { mes } = dentroDeDosMeses();
  const anioVac = new Date().getFullYear();
  await ingresar(page, 'contador@demo.com', 'contador1234');
  // Empleado (5 años de antigüedad: 21 días)
  await page.goto('/sueldos/empleados');
  await page.getByRole('button', { name: 'Nuevo empleado' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Apellido').fill('Vera');
  await dlg.getByLabel('Nombre', { exact: true }).fill('Paula');
  await dlg.getByLabel('CUIL').fill('27-22233344-5');
  await dlg.getByLabel('Fecha de ingreso').fill(`${anioVac - 6}-03-01`);
  await dlg.getByRole('textbox', { name: 'Categoría' }).click();
  await page.getByRole('option', { name: 'Comercio (CCT 130/75) · Vendedor B' }).click();
  await dlg.getByLabel('Código de obra social (RNOS)').fill('125000');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('cell', { name: 'Vera, Paula' })).toBeVisible();
  // Escala del mes de las vacaciones
  await page.goto('/sueldos/convenios');
  await page.getByLabel('Mes', { exact: true }).fill(mes);
  const basico = page.getByLabel('Básico Vendedor B');
  await basico.fill('1000000');
  await basico.blur();
  await expect(page.getByRole('row', { name: /Vendedor B/ }).getByText('$ 1.000.000,00')).toBeVisible();
  // Período de 14 días y saldo
  await page.goto('/sueldos/vacaciones');
  await page.getByRole('cell', { name: 'Vera, Paula' }).click();
  await page.getByRole('button', { name: 'Nuevo período' }).click();
  const dp = page.getByRole('dialog', { name: 'Nuevo período' });
  await dp.getByLabel('Desde').fill(`${mes}-04`);
  await dp.getByLabel('Hasta').fill(`${mes}-17`);
  await expect(dp.getByText('14 días')).toBeVisible();
  await dp.getByRole('button', { name: 'Guardar' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('row', { name: /Vera, Paula/ }).getByRole('cell', { name: '7', exact: true })).toBeVisible();
  // Mensual del mes con el renglón de vacaciones
  await page.goto('/sueldos/liquidaciones');
  await page.getByRole('button', { name: 'Nueva liquidación' }).click();
  await page.getByRole('dialog').getByLabel('Mes', { exact: true }).fill(mes);
  await page.getByRole('dialog').getByRole('button', { name: 'Crear y calcular' }).click();
  await page.getByRole('cell', { name: 'Vera, Paula' }).click();
  await expect(page.getByRole('cell', { name: 'Vacaciones', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Descuento días de vacaciones' })).toBeVisible();
});
