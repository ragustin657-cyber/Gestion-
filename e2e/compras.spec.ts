import { expect, Page, test } from '@playwright/test';

const unico = String(Date.now()).slice(-7);
const PROVEEDOR = 'Transportes Ruta 9 S.A.';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

async function elegir(page: Page, etiqueta: string, opcion: string) {
  await page.getByRole('textbox', { name: etiqueta }).first().click();
  await page.getByRole('option', { name: opcion }).click();
}

test('circuito de compras: OC → aprobación → recepción → factura → cuenta corriente', async ({ page }) => {
  test.setTimeout(90000);

  // 1. El administrador crea una OC que supera el monto límite
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/compras/oc/nueva');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await page.getByLabel('Descripción').first().fill(`Flete ${unico}`);
  await page.getByLabel('Cantidad').first().fill('10');
  await page.getByLabel('Precio unitario').first().fill('150000');
  await expect(page.getByTestId('total-comprobante')).toContainText('$ 1.815.000,00');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Pendiente de aprobación').first()).toBeVisible();
  await page.getByRole('button', { name: 'Salir' }).click();

  // 2. El aprobador la aprueba
  await ingresar(page, 'aprobador@demo.com', 'aprobador1234');
  await page.goto('/compras/oc/aprobacion');
  await page.getByRole('cell', { name: PROVEEDOR }).first().click();
  const detalle = page.getByRole('dialog');
  await expect(detalle.getByText(`Flete ${unico}`)).toBeVisible();
  await detalle.getByRole('button', { name: 'Aprobar' }).click();
  await page.getByRole('dialog', { name: 'Aprobar' }).getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Operación realizada')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Salir' }).click();

  // 3. El administrador registra la recepción
  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/compras/recepcion');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await page.getByLabel('Remito del proveedor').fill(`9-${unico}`);
  await page.getByRole('row', { name: new RegExp(`Flete ${unico}`) }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirmar recepción' }).click();
  await expect(page.getByText(/Recepción .* registrada/)).toBeVisible();

  // 4. Carga la factura desde la recepción
  await page.goto('/compras/factura');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await elegir(page, 'Letra', 'A');
  await page.getByLabel('Punto de venta').fill('7');
  await page.getByRole('textbox', { name: /^Número/ }).fill(unico);
  await page.getByRole('button', { name: 'Agregar desde recepciones' }).click();
  const selector = page.getByRole('dialog');
  await selector.getByRole('row', { name: new RegExp(`Flete ${unico}`) }).getByRole('checkbox').check();
  await selector.getByRole('button', { name: 'Agregar seleccionados' }).click();
  await page.getByLabel('Total del comprobante (como figura en el papel)').fill('1815000');
  await expect(page.getByText('Diferencia con el total calculado: $ 0,00')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar comprobante' }).click();
  await expect(page.getByText(/Comprobante cargado/)).toBeVisible();

  // 5. La deuda aparece en la cuenta corriente del proveedor
  await page.goto('/compras/cuenta-corriente');
  await elegir(page, 'Proveedor', PROVEEDOR);
  await expect(page.getByText(`FC A 00007-${unico.padStart(8, '0')}`)).toBeVisible();
});
