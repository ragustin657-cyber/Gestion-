import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

// Corre al final de la cadena: cierra (y reabre) la posición de IVA de dos meses atrás (la e2e de contabilidad cierra el período contable del mes anterior)
test('posición de IVA: el contador configura el inicio, cierra un mes y lo reabre', async ({ page }) => {
  const hoy = new Date();
  const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  await ingresar(page, 'contador@demo.com', 'contador1234');

  await page.goto('/admin/impuestos');
  await page.getByLabel('Primer mes liquidado').fill(String(anterior.getMonth() + 1));
  await page.getByLabel('Año', { exact: true }).fill(String(anterior.getFullYear()));
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Configuración guardada')).toBeVisible();

  await page.goto('/impuestos/posicion-iva');
  await expect(page.getByRole('heading', { name: 'Posición de IVA' })).toBeVisible();
  // La pantalla arranca en el año del mes anterior; en enero y febrero dos meses atrás puede ser de otro año: se elige en el selector
  const anioPantalla = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
  if (anterior.getFullYear() !== anioPantalla) {
    await page.getByRole('textbox', { name: 'Año' }).click();
    await page.getByRole('option', { name: String(anterior.getFullYear()), exact: true }).click();
  }
  await page.getByRole('cell', { name: MESES[anterior.getMonth()], exact: true }).click();
  await expect(page.getByText('Total débito fiscal')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByText('Posición cerrada')).toBeVisible();
  // Septiembre de la demo no tiene movimientos: se cierra con todo en cero y sin asiento (el asiento lo cubre la prueba de la API)
  await expect(page.getByRole('cell', { name: 'Cerrada' })).toBeVisible();
  await page.getByRole('button', { name: 'Reabrir' }).click();
  await expect(page.getByText('Posición reabierta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeVisible();
});
