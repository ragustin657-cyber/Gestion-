import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

// Después de la posición de IVA: cierra (y reabre) la liquidación de IIBB de dos meses atrás (el período contable del mes anterior lo cierra la e2e de contabilidad)
test('liquidación de IIBB: el contador configura el inicio y las jurisdicciones, cierra un mes y lo reabre', async ({ page }) => {
  const hoy = new Date();
  const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  await ingresar(page, 'contador@demo.com', 'contador1234');

  await page.goto('/admin/impuestos');
  await page.getByLabel('Primer mes de IIBB').fill(String(anterior.getMonth() + 1));
  await page.getByLabel('Año de inicio de IIBB').fill(String(anterior.getFullYear()));
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Configuración guardada')).toBeVisible();

  if (anterior.getFullYear() !== hoy.getFullYear()) {
    await page.getByRole('textbox', { name: 'Año de las jurisdicciones' }).click();
    await page.getByRole('option', { name: String(anterior.getFullYear()), exact: true }).click();
  }
  await page.getByRole('button', { name: 'Agregar jurisdicción' }).click();
  await page.getByLabel('Coeficiente').fill('1');
  await page.getByLabel('Alícuota').fill('3');
  await page.getByLabel('Actividad', { exact: true }).fill('620100');
  await expect(page.getByText('Suma de coeficientes: 1,0000')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar jurisdicciones' }).click();
  await expect(page.getByText('Jurisdicciones guardadas')).toBeVisible();

  await page.goto('/impuestos/iibb');
  await expect(page.getByRole('heading', { name: 'Liquidación de IIBB (Convenio Multilateral)' })).toBeVisible();
  const anioPantalla = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
  if (anterior.getFullYear() !== anioPantalla) {
    await page.getByRole('textbox', { name: 'Año' }).click();
    await page.getByRole('option', { name: String(anterior.getFullYear()), exact: true }).click();
  }
  await page.getByRole('cell', { name: MESES[anterior.getMonth()], exact: true }).click();
  await expect(page.getByText('Ingresos gravados del mes')).toBeVisible();
  await expect(page.getByRole('cell', { name: '901 CABA' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByText('Liquidación cerrada')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Cerrada' })).toBeVisible();
  await page.getByRole('button', { name: 'Reabrir' }).click();
  await expect(page.getByText('Liquidación reabierta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeVisible();
});
