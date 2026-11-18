import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

// Fecha de hoy en Argentina (la de la API), no la de la máquina que corre la prueba
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

test('sueldos: el contador da de baja a un empleado por despido sin causa, ve la indemnización, cierra y paga', async ({ page }) => {
  await ingresar(page, 'contador@demo.com', 'contador1234');
  // Empleado y escala del mes actual
  await page.goto('/sueldos/empleados');
  await page.getByRole('button', { name: 'Nuevo empleado' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Apellido').fill('Sosa');
  await dlg.getByLabel('Nombre', { exact: true }).fill('Luis');
  await dlg.getByLabel('CUIL').fill('20-30110222-5');
  await dlg.getByLabel('Fecha de ingreso').fill('2021-03-01');
  await dlg.getByRole('textbox', { name: 'Categoría' }).click();
  await page.getByRole('option', { name: 'Comercio (CCT 130/75) · Vendedor B' }).click();
  await dlg.getByLabel('Código de obra social (RNOS)').fill('125000');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('cell', { name: 'Sosa, Luis' })).toBeVisible();
  await page.goto('/sueldos/convenios');
  const basico = page.getByLabel('Básico Vendedor B');
  await basico.fill('1000000');
  await basico.blur();
  await expect(page.getByRole('row', { name: /Vendedor B/ }).getByText('$ 1.000.000,00')).toBeVisible();
  // Dar de baja
  await page.goto('/sueldos/empleados');
  await page.getByRole('cell', { name: 'Sosa, Luis' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Dar de baja' }).click();
  const baja = page.getByRole('dialog', { name: /Dar de baja/ });
  await baja.getByLabel('Fecha de egreso').fill(hoy());
  await baja.getByRole('button', { name: 'Dar de baja' }).click();
  await expect(page.getByRole('heading', { name: /Final .* Sosa, Luis/ })).toBeVisible();
  // Indemnización, cierre y pago
  await page.getByRole('cell', { name: 'Sosa, Luis' }).click();
  await expect(page.getByText('Indemnización por antigüedad')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cerrar liquidación' }).click();
  await expect(page.getByText(/^Asiento N°/)).toBeVisible();
  await page.getByRole('tab', { name: /Pagos/ }).click();
  await page.getByRole('button', { name: 'Pagar todos los pendientes' }).click();
  const pago = page.getByRole('dialog');
  await pago.getByRole('textbox', { name: 'Desde' }).click();
  await page.getByRole('option', { name: /Banco de la Nación Argentina/ }).click();
  await pago.getByRole('button', { name: 'Pagar' }).click();
  await expect(page.getByText('Pagado', { exact: true }).first()).toBeVisible();
});
