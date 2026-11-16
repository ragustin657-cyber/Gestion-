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

test('tarjetas: el administrador cobra con tarjeta, liquida los cupones y ve el neto en el banco', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  const cupon = `9${String(Date.now()).slice(-6)}`;

  // 1. Recibo a cuenta con un cupón de Visa
  await page.goto('/ventas/recibo');
  await elegir(page, 'Cliente', 'Constructora Norte S.R.L.');
  await elegir(page, 'Punto de venta', /^0002/);
  await elegir(page, 'Caja', /^Caja principal/);
  await page.getByRole('button', { name: 'Agregar cupón' }).click();
  await elegir(page, 'Tarjeta', 'Visa crédito');
  await page.getByLabel('Lote').fill('15');
  await page.getByLabel('Número de cupón').fill(cupon);
  await page.getByLabel('Importe del cupón').fill('10000');
  await expect(page.getByTestId('total-recibo')).toHaveText('Total $ 10.000,00');
  await page.getByRole('button', { name: 'Confirmar recibo' }).click();
  await expect(page.getByText(/Recibo 0002-\d{8} registrado/)).toBeVisible();

  // 2. Liquidación con arancel y su IVA
  await page.goto('/tesoreria/tarjetas/liquidaciones');
  await page.getByRole('button', { name: 'Nueva liquidación' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('textbox', { name: 'Tarjeta' }).click();
  await page.getByRole('option', { name: 'Visa crédito' }).click();
  await modal.getByRole('checkbox', { name: `Cupón ${cupon}` }).check();
  await expect(modal.getByText('Bruto $ 10.000,00')).toBeVisible();
  await modal.getByLabel('Arancel', { exact: true }).fill('180');
  await modal.getByLabel('IVA del arancel').fill('37,80');
  await modal.getByLabel('Neto acreditado').fill('9782,20');
  await expect(modal.getByText('Diferencia $ 0,00')).toBeVisible();
  await modal.getByRole('button', { name: 'Confirmar liquidación' }).click();
  await expect(page.getByText('Liquidación registrada')).toBeVisible();
  await expect(page.getByRole('row', { name: /Visa crédito.*\$ 9\.782,20/ })).toBeVisible();

  // 3. El cupón ya no está pendiente
  await page.goto('/tesoreria/tarjetas/cupones');
  await expect(page.getByRole('heading', { name: 'Cupones de tarjetas' })).toBeVisible();
  await expect(page.getByRole('cell', { name: cupon })).toHaveCount(0);
});
