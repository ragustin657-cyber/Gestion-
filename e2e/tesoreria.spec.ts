import { expect, Page, test } from '@playwright/test';

const numero = `9${String(Date.now()).slice(-7)}`;
const CLIENTE = 'Supermercados Litoral S.A.';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

async function salir(page: Page) {
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
}

async function elegir(page: Page, etiqueta: string | RegExp, opcion: string | RegExp) {
  await page.getByRole('textbox', { name: etiqueta }).first().click();
  await page.getByRole('option', { name: opcion }).first().click();
}

const saldoBanco = async (page: Page) => {
  await page.goto('/tesoreria/saldos');
  const celda = page.getByTestId('saldo-banco-Banco de la Nación Argentina - 1234567/8');
  await expect(celda).toBeVisible();
  return Number((await celda.innerText()).replace(/[^\d,-]/g, '').replace(',', '.'));
};

test('tesorería: la sucursal cobra un cheque y lo envía; casa central lo recibe, deposita y acredita', async ({ page }) => {
  test.setTimeout(120000);

  // 1. El cajero de Rosario registra el cobro con un cheque
  await ingresar(page, 'cajero.rosario@demo.com', 'cajero1234');
  await expect(page.getByTestId('sucursal-usuario')).toHaveText('Sucursal Rosario');
  await page.goto('/tesoreria/ingreso');
  await elegir(page, 'Caja', /^Caja Rosario/);
  await elegir(page, 'Cliente', CLIENTE);
  await page.getByRole('button', { name: 'Agregar cheque' }).click();
  await page.getByLabel('Banco del cheque').fill('Banco Credicoop');
  await page.getByLabel('Número del cheque').fill(numero);
  await page.getByLabel('Librador', { exact: true }).fill(CLIENTE);
  await page.getByLabel('Importe del cheque').fill('150000');
  await page.getByRole('button', { name: 'Registrar ingreso' }).click();
  await expect(page.getByText(/Ingreso \d+ registrado/)).toBeVisible();

  // 2. Lo envía a casa central
  await page.goto('/tesoreria/traslado');
  await elegir(page, 'Caja de origen', /^Caja Rosario/);
  await elegir(page, 'Caja de destino', 'Caja principal (Casa central)');
  await page.getByRole('checkbox', { name: `Cheque ${numero} Banco Credicoop` }).check();
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText(/Traslado \d+ enviado/)).toBeVisible();
  await salir(page);

  // 3. El tesorero recibe, deposita y acredita
  await ingresar(page, 'tesorero@demo.com', 'tesorero1234');
  const saldoAntes = await saldoBanco(page);
  await page.goto('/tesoreria/recepcion');
  await page.getByRole('cell', { name: new RegExp(`Cheque ${numero}`) }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar recepción' }).click();
  await expect(page.getByText(/Traslado \d+ recibido/)).toBeVisible();

  await page.goto('/tesoreria/deposito');
  await elegir(page, 'Caja', /^Caja principal/);
  await elegir(page, 'Cuenta bancaria', /Banco de la Nación Argentina - 1234567\/8/);
  await page.getByRole('checkbox', { name: `Cheque ${numero} Banco Credicoop` }).check();
  await page.getByRole('button', { name: 'Depositar' }).click();
  await expect(page.getByText(/Depósito \d+ registrado/)).toBeVisible();

  await page.goto('/tesoreria/acreditaciones');
  await page.getByRole('checkbox', { name: `Cheque ${numero} Banco Credicoop` }).check();
  await page.getByRole('button', { name: 'Acreditar' }).click();
  await expect(page.getByText(/Acreditados: 1 cheques/)).toBeVisible();

  // 4. Cartera: acreditado, con 5 pasos en el historial
  await page.goto('/tesoreria/cartera');
  await elegir(page, 'Estado', 'Acreditado');
  await page.getByRole('cell', { name: numero, exact: true }).click();
  const historial = page.getByRole('dialog').getByTestId('historial-cheque');
  await expect(historial.getByText('En cartera')).toHaveCount(2);
  await expect(historial.getByText(/^(En tránsito|Depositado|Acreditado)$/)).toHaveCount(3);
  await page.keyboard.press('Escape');

  // 5. El saldo del banco aumentó por el cheque
  expect(await saldoBanco(page)).toBe(saldoAntes + 150000);
});
