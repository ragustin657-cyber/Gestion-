import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

test('despacho de importación: el administrador lo carga y lo ve en el Libro IVA Compras', async ({ page }) => {
  const numero = `26001IC04${String(Date.now()).slice(-6)}K`;
  await ingresar(page, 'admin@demo.com', 'admin1234');

  await page.goto('/compras/despacho');
  await expect(page.getByRole('heading', { name: 'Despacho de importación' })).toBeVisible();
  await page.getByLabel('Número de despacho').fill(numero);
  await page.getByLabel('Base imponible').first().fill('100000');
  await page.getByLabel('Derechos de importación').fill('8000');
  await expect(page.getByTestId('total-despacho')).toHaveText('Total liquidado $ 29.000,00');
  await page.getByLabel('Total liquidado (como figura en el despacho)').fill('29000');
  await page.getByRole('button', { name: 'Registrar despacho' }).click();
  await expect(page.getByText(/Despacho registrado/)).toBeVisible();

  await page.goto('/compras/libro-iva');
  await expect(page.getByRole('cell', { name: numero })).toBeVisible();
});
