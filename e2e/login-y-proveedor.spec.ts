import { expect, test } from '@playwright/test';

/** CUIT válido y distinto en cada corrida (la base e2e conserva los datos entre corridas). */
function cuitUnico(): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = '20' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const r = 11 - (pesos.reduce((t, p, i) => t + p * Number(base[i]), 0) % 11);
    if (r === 10) continue;
    return `${base.slice(0, 2)}-${base.slice(2)}-${r === 11 ? 0 : r}`;
  }
}

test('login, elegir empresa demo y dar de alta un proveedor', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@demo.com');
  await page.getByLabel('Contraseña').fill('admin1234');
  await page.getByRole('button', { name: 'Ingresar' }).click();

  // Con una sola empresa asignada, el ingreso la selecciona automáticamente
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
  await expect(page.getByRole('banner').getByText('Demo S.A.')).toBeVisible();

  await page.getByText('Maestros', { exact: true }).click();
  await page.getByText('Proveedores y clientes', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Proveedores y clientes' })).toBeVisible();

  const unico = Date.now().toString().slice(-6);
  await page.getByRole('button', { name: 'Nuevo' }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Razón social').fill(`Proveedor E2E ${unico}`);

  // CUIT inválido: validación en el cliente
  await dialogo.getByLabel('CUIT').fill('20-12345678-5');
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialogo.getByText('CUIT inválido')).toBeVisible();

  await dialogo.getByLabel('CUIT').fill(cuitUnico());
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByRole('cell', { name: `Proveedor E2E ${unico}` })).toBeVisible();
});
