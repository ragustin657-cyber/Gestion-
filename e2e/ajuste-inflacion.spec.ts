import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

/** Índices desde diciembre del año anterior hasta el mes actual, crecientes. */
function csvIndices(hoy: Date) {
  const lineas: string[] = [];
  let anio = hoy.getFullYear() - 1;
  let mes = 12;
  for (let i = 0; anio < hoy.getFullYear() || mes <= hoy.getMonth() + 1; i++) {
    lineas.push(`${anio}-${String(mes).padStart(2, '0')};${100 + i * 5}`);
    if (mes === 12) { anio++; mes = 1; } else mes++;
  }
  return { texto: `Periodo;Indice\n${lineas.join('\n')}\n`, cantidad: lineas.length };
}

test('ajuste por inflación: el superadmin carga índices y el contador genera el ajuste', async ({ page }) => {
  test.setTimeout(90000);
  const hoy = new Date();
  const { texto, cantidad } = csvIndices(hoy);

  await ingresar(page, 'admin@demo.com', 'admin1234');
  await page.goto('/admin/indices-inflacion');
  const selector = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar CSV' }).click();
  await (await selector).setFiles({ name: 'indices.csv', mimeType: 'text/csv', buffer: Buffer.from(texto) });
  await expect(page.getByText(`Creados: ${cantidad} · Actualizados: 0`)).toBeVisible();

  await page.getByRole('button', { name: 'Salir' }).click();
  await ingresar(page, 'contador@demo.com', 'contador1234');
  await page.goto('/admin/ajuste-inflacion');
  await page.getByRole('textbox', { name: 'Primer ejercicio ajustado' }).click();
  await page.getByRole('option', { name: new RegExp(`\\(${hoy.getFullYear()}\\)`) }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Configuración guardada')).toBeVisible();

  await page.goto('/contabilidad/ajuste-inflacion');
  await page.getByRole('button', { name: 'Ver previa' }).click();
  await expect(page.getByText(/^RECPAM/)).toBeVisible();
  await page.getByRole('button', { name: 'Generar' }).click();
  await expect(page.getByText(/Asiento de ajuste N° \d+ generado/)).toBeVisible();
  const fin = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() + 1, 0)).toISOString().slice(0, 10).split('-').reverse().join('/');
  await expect(page.getByRole('cell', { name: fin })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anular' })).toBeVisible();
});
