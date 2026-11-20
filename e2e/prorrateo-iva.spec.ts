import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

// Después de la posición de IVA (que dejó el inicio configurado y el mes reabierto): activa el prorrateo desde dos meses atrás
test('prorrateo de IVA: el contador lo activa y la posición muestra el coeficiente', async ({ page }) => {
  const hoy = new Date();
  const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  await ingresar(page, 'contador@demo.com', 'contador1234');

  await page.goto('/admin/impuestos');
  const interruptor = page.getByLabel('Prorrateo del crédito fiscal (ventas gravadas y exentas)');
  await expect(interruptor).toBeAttached();
  if (!(await interruptor.isChecked())) await interruptor.dispatchEvent('click');
  await page.getByLabel('Primer mes con prorrateo', { exact: true }).fill(String(anterior.getMonth() + 1));
  await page.getByLabel('Año del primer mes con prorrateo').fill(String(anterior.getFullYear()));
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Configuración guardada')).toBeVisible();

  await page.goto('/impuestos/posicion-iva');
  const anioPantalla = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
  if (anterior.getFullYear() !== anioPantalla) {
    await page.getByRole('textbox', { name: 'Año' }).click();
    await page.getByRole('option', { name: String(anterior.getFullYear()), exact: true }).click();
  }
  await page.getByRole('cell', { name: MESES[anterior.getMonth()], exact: true }).click();
  await expect(page.getByText(/^Coeficiente de prorrateo \d,\d{4}$/)).toBeVisible();
  await expect(page.getByText('Crédito fiscal computable')).toBeVisible();
});
