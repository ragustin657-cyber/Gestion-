import { expect, Page, test } from '@playwright/test';

async function ingresar(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByText('Estás trabajando en')).toBeVisible();
}

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

/** F.572 de ejemplo (estructura provisional del SiRADIG, spec E31 §11) para la empresa demo. */
const f572 = (cuil: string, anio: string) => `<?xml version="1.0" encoding="UTF-8"?>
<presentacion><periodo>${anio}</periodo><nroPresentacion>1</nroPresentacion><fechaPresentacion>${anio}-03-10</fechaPresentacion>
<empleado><cuit>${cuil}</cuit><apellido>PAZ</apellido><nombre>ELENA</nombre></empleado>
<agenteRetencion><cuit>30712345671</cuit><denominacion>DEMO SA</denominacion></agenteRetencion>
<deducciones><deduccion tipo="1"><nroDoc>30654321092</nroDoc><denominacion>PREPAGA SA</denominacion><periodos><periodo mesDesde="1" mesHasta="12" montoMensual="10000.00"/></periodos></deduccion></deducciones>
</presentacion>`;

// Corre al final de la cadena: baja los mínimos de la tabla del semestre para que la liquidación final retenga
test('ganancias: el contador carga la tabla, importa el F.572 y ve la retención en la liquidación final', async ({ page }) => {
  test.setTimeout(90000);
  await ingresar(page, 'contador@demo.com', 'contador1234');
  // Tabla del semestre actual (la demo trae una de ejemplo)
  await page.goto('/sueldos/ganancias/tablas');
  await expect(page.getByRole('heading', { name: /tablas de ARCA/ })).toBeVisible();
  await page.getByLabel('Ganancia no imponible').fill('120000');
  await page.getByLabel('Deducción especial incrementada').fill('480000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Tabla guardada')).toBeVisible();
  // Empleado nuevo
  await page.goto('/sueldos/empleados');
  await page.getByRole('button', { name: 'Nuevo empleado' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Apellido').fill('Paz');
  await dlg.getByLabel('Nombre', { exact: true }).fill('Elena');
  await dlg.getByLabel('CUIL').fill('20-33344455-1');
  await dlg.getByLabel('Fecha de ingreso').fill('2021-03-01');
  await dlg.getByRole('textbox', { name: 'Categoría' }).click();
  await page.getByRole('option', { name: 'Comercio (CCT 130/75) · Vendedor B' }).click();
  await dlg.getByLabel('Código de obra social (RNOS)').fill('125000');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('cell', { name: 'Paz, Elena' })).toBeVisible();
  // F.572 del SiRADIG
  const selector = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar F.572 (SiRADIG)' }).first().click();
  await (await selector).setFiles({ name: '20333444551_presentacion_001.xml', mimeType: 'text/xml', buffer: Buffer.from(f572('20333444551', hoy().slice(0, 4))) });
  await expect(page.getByText('1 F.572 importado(s)').first()).toBeVisible();
  // Baja: liquidación final con la retención
  await page.getByRole('cell', { name: 'Paz, Elena' }).click();
  await expect(page.getByText(/F\.572 presentación 1/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Dar de baja' }).click();
  const baja = page.getByRole('dialog', { name: /Dar de baja/ });
  await baja.getByLabel('Fecha de egreso').fill(hoy());
  await baja.getByRole('button', { name: 'Dar de baja' }).click();
  await expect(page.getByRole('heading', { name: /Final .* Paz, Elena/ })).toBeVisible();
  await page.getByRole('cell', { name: 'Paz, Elena' }).click();
  await expect(page.getByRole('dialog').getByText('Impuesto a las ganancias')).toBeVisible();
  await page.getByRole('button', { name: 'Ver cálculo de Ganancias' }).click();
  await expect(page.getByText('Ganancia sujeta a impuesto')).toBeVisible();
  await expect(page.getByText(/Cuotas médico-asistenciales/)).toBeVisible();
});
