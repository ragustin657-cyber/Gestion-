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

test('stock: el contador carga inventario inicial y ve existencias, kardex y valuación', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'contador@demo.com', 'contador1234');

  await page.goto('/stock/inicial');
  await elegir(page, 'Depósito', 'Depósito central');
  await elegir(page, 'Contrapartida', /3\.2\.01/);
  await elegir(page, 'Artículo', /LAM-LED/);
  await page.getByRole('button', { name: 'Agregar' }).click();
  await page.getByRole('textbox', { name: 'Cantidad LAM-LED' }).fill('40');
  await page.getByRole('textbox', { name: 'Costo LAM-LED' }).fill('2000');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/Documento N° \d+/)).toBeVisible();

  await page.goto('/stock/existencias');
  await expect(page.getByRole('cell', { name: /LAM-LED/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /^100 UN$/ })).toBeVisible();

  await page.goto('/stock/kardex');
  await elegir(page, 'Artículo', /LAM-LED/);
  await expect(page.getByRole('cell', { name: /Recepción N° \d+/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Inventario inicial N° \d+/ })).toBeVisible();

  await page.goto('/stock/valuacion');
  await expect(page.getByText('Coincide con el Mayor')).toBeVisible();
});
