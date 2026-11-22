import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

// Corre al final: los índices del ejercicio los cargó la prueba de amortización impositiva; agrega el de 36 meses antes del cierre
test('ajuste por inflación impositivo: el administrador abre el ajuste del ejercicio y carga una partida manual', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  const anio = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).slice(0, 4));

  await page.goto('/admin/indices-inflacion');
  const selector = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar CSV' }).click();
  await (await selector).setFiles({ name: 'indices.csv', mimeType: 'text/csv', buffer: Buffer.from(`Periodo;Indice\n${anio - 3}-12;20\n`) });
  await expect(page.getByText(/Creados: \d+ · Actualizados: \d+/)).toBeVisible();

  await page.goto('/impuestos/ajuste-inflacion');
  await expect(page.getByText('Ajuste estático').first()).toBeVisible();
  const total = page.getByText('Total del ajuste').locator('..');
  const antes = await total.innerText();

  await page.getByRole('button', { name: 'Nueva partida' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Concepto').fill('Valuación impositiva de bienes de cambio');
  await modal.getByLabel('Importe').fill('1000000');
  await modal.getByRole('button', { name: 'Guardar partida' }).click();
  await expect(page.getByText('Partida guardada')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Valuación impositiva de bienes de cambio' })).toBeVisible();
  await expect.poll(() => total.innerText()).not.toBe(antes);
});
