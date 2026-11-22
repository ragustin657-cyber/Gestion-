import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

/** Índices de diciembre del año anterior a diciembre del año actual (el cierre del ejercicio). */
function csvIndices(anio: number) {
  const lineas = [`${anio - 1}-12;100`, ...Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, '0')};${105 + i * 5}`)];
  return `Periodo;Indice\n${lineas.join('\n')}\n`;
}

// Corre al final: usa la camioneta que da de alta la prueba de bienes de uso (proyecto general)
test('amortización impositiva: el administrador pone la vida impositiva del rubro y ve la planilla del ejercicio', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'admin@demo.com', 'admin1234');
  const anio = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).slice(0, 4));

  // 1. Índices hasta el cierre del ejercicio
  await page.goto('/admin/indices-inflacion');
  const selector = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar CSV' }).click();
  await (await selector).setFiles({ name: 'indices.csv', mimeType: 'text/csv', buffer: Buffer.from(csvIndices(anio)) });
  await expect(page.getByText(/Creados: \d+ · Actualizados: \d+/)).toBeVisible();

  // 2. Vida útil impositiva del rubro Rodados
  await page.goto('/maestros/rubros-bienes');
  await page.getByRole('cell', { name: 'Rodados', exact: true }).click();
  const rubro = page.getByRole('dialog');
  await rubro.getByLabel('Vida útil impositiva (años)').fill('5');
  await rubro.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Rubro guardado')).toBeVisible();

  // 3. Planilla impositiva del ejercicio: la camioneta con su cuota anual (año de alta completo) y los totales
  await page.goto('/contabilidad/planilla-impositiva');
  await expect(page.getByText('Rodados', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /Camioneta/ }).first()).toBeVisible();
  await expect(page.getByTestId('total-impositiva')).toBeVisible();
  await expect(page.getByText(/^Deducible del ejercicio: /)).toBeVisible();
  await expect(page.getByText('Se usa la vida útil contable de: Rodados')).toHaveCount(0);
});
