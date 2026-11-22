import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

async function socio(page: Page, nombre: string, tipo: string, porcentaje: string) {
  await page.getByRole('button', { name: 'Nuevo' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Nombre o razón social').fill(nombre);
  await d.getByLabel('Número de documento').fill('20-12345678-6');
  // «Persona humana del país» viene elegida por defecto: volver a elegirla la deselecciona
  if ((await d.getByRole('textbox', { name: 'Tipo de titular' }).inputValue()) !== tipo) {
    await d.getByRole('textbox', { name: 'Tipo de titular' }).click();
    await page.getByRole('option', { name: tipo, exact: true }).click();
  }
  await d.getByLabel('Participación (%)').fill(porcentaje);
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('cell', { name: nombre })).toBeVisible();
}

test('Bienes Personales acciones: el administrador carga los socios y ve el impuesto del año', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/impuestos/socios');
  await socio(page, 'Ana Pérez', 'Persona humana del país', '70');
  await socio(page, 'Inversora del Sur SA', 'Sociedad del país (no paga)', '30');

  await page.goto('/impuestos/bienes-personales');
  const ana = page.getByRole('row').filter({ hasText: 'Ana Pérez' });
  await expect(ana).toContainText('Persona humana del país');
  await expect(page.getByRole('row').filter({ hasText: 'Inversora del Sur SA' })).toContainText('$ 0,00');
  await expect(page.getByText(/^Total a ingresar: /)).toBeVisible();
});
