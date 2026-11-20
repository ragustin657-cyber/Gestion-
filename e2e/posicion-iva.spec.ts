import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

// Corre al final de la cadena: cierra (y reabre) la posición de IVA del mes anterior
test('posición de IVA: el contador configura el inicio, cierra el mes anterior, ve el asiento y lo reabre', async ({ page }) => {
  const hoy = new Date();
  const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  await ingresar(page, 'contador@demo.com', 'contador1234');

  await page.goto('/admin/impuestos');
  await page.getByLabel('Primer mes liquidado').fill(String(anterior.getMonth() + 1));
  await page.getByLabel('Año', { exact: true }).fill(String(anterior.getFullYear()));
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Configuración guardada')).toBeVisible();

  await page.goto('/impuestos/posicion-iva');
  await expect(page.getByRole('heading', { name: 'Posición de IVA' })).toBeVisible();
  await expect(page.getByText('Total débito fiscal')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByText('Posición cerrada')).toBeVisible();
  await expect(page.getByText('ver asiento')).toBeVisible();
  await page.getByRole('button', { name: 'Reabrir' }).click();
  await expect(page.getByText('Posición reabierta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeVisible();
});
