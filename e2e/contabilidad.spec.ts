import { expect, Page, test } from '@playwright/test';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const descripcion = `Gasto de prueba ${String(Date.now()).slice(-6)}`;

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test('contabilidad: asiento manual, Diario y Mayor, cierre del mes y Libro Diario', async ({ page }) => {
  test.setTimeout(120000);
  const hoy = new Date();
  // El ejercicio demo es calendario: en enero no hay un mes anterior dentro del ejercicio
  test.skip(hoy.getMonth() === 0, 'En enero el mes anterior pertenece a otro ejercicio');
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth(); // mes anterior, 1 a 11
  const mm = String(mes).padStart(2, '0');
  const desde = `${anio}-${mm}-01`;
  const hasta = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);

  await ingresar(page, 'contador@demo.com', 'contador1234');

  // 1. Asiento manual del mes anterior
  await page.goto('/contabilidad/asiento');
  await page.getByLabel('Fecha').fill(`${anio}-${mm}-10`);
  await page.getByLabel('Descripción').fill(descripcion);
  await page.getByRole('textbox', { name: 'Cuenta' }).nth(0).click();
  await page.getByRole('option', { name: '5.2.01 Gastos generales', exact: true }).click();
  await page.getByLabel('Debe').nth(0).fill('1500');
  await page.getByRole('textbox', { name: 'Cuenta' }).nth(1).click();
  await page.getByRole('option', { name: '1.1.01.001 Caja', exact: true }).click();
  await page.getByLabel('Haber').nth(1).fill('1500');
  await page.getByRole('button', { name: 'Registrar asiento' }).click();
  await expect(page.getByText(/Asiento \d+ registrado/)).toBeVisible();

  // 2. Diario y Mayor
  await page.goto('/contabilidad/diario');
  await page.getByLabel('Desde').fill(desde);
  await page.getByLabel('Hasta').fill(hasta);
  await expect(page.getByText(descripcion)).toBeVisible();
  await page.goto('/contabilidad/mayor');
  await page.getByRole('textbox', { name: 'Cuenta' }).click();
  await page.getByRole('option', { name: '5.2.01 Gastos generales', exact: true }).click();
  await page.getByLabel('Desde').fill(desde);
  await page.getByLabel('Hasta').fill(hasta);
  await expect(page.getByText(descripcion)).toBeVisible();

  // 3. Cerrar los meses del ejercicio hasta el anterior inclusive
  await page.goto('/contabilidad/periodos');
  for (let m = 1; m <= mes; m++) {
    const boton = page.getByRole('button', { name: `Cerrar ${MESES[m - 1]} ${anio}`, exact: true });
    await boton.click();
    await expect(page.getByText(`Período ${m}/${anio} cerrado`)).toBeVisible();
  }
  await expect(page.getByTestId(`periodo-${anio}-${mes}`)).toContainText('Cerrado');

  // 4. El asiento tiene número definitivo
  await page.goto('/contabilidad/diario');
  await page.getByLabel('Desde').fill(desde);
  await page.getByLabel('Hasta').fill(hasta);
  const fila = page.getByRole('row').filter({ hasText: descripcion });
  await expect(fila.getByText(/^N° \d+$/)).toBeVisible();

  // 5. Libro Diario del mes en PDF
  await page.goto('/contabilidad/libros');
  await page.getByLabel('Desde').fill(desde);
  await page.getByLabel('Hasta').fill(hasta);
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Emitir Libro Diario' }).click();
  expect((await descarga).suggestedFilename()).toBe(`libro-diario-${desde}.pdf`);
  await expect(page.getByText(/Libro emitido: folios 1 a \d+/)).toBeVisible();
});
