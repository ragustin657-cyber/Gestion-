import PDFDocument from 'pdfkit';
import { formatearCuit } from '@gestion/shared';
import { importeAR } from '../../ventas/pdf/pdf-venta';
import { DatosF1359Empleado } from './f1359-datos';

export interface DatosCertificado { empresa: { razonSocial: string; cuit: string }; empleado: { apellido: string; nombre: string; cuil: string }; anio: number; tipo: string; fecha: string; datos: DatosF1359Empleado }

/** Certificado de la liquidación de Ganancias de cuarta (punto 8 del manual del F.1359), una hoja por empleado (spec E32 §8). */
export function pdfCertificados(cs: DatosCertificado[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: false, compress: process.env.NODE_ENV !== 'test' });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b)).on('end', () => resolve(Buffer.concat(partes))).on('error', reject);
    const $ = (x: string) => `$ ${importeAR(x)}`;
    for (const c of cs) {
      doc.addPage();
      const d = c.datos;
      const fila = (a: string, b: string, negrita = false) => { doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica'); const y = doc.y; doc.text(a, 40, y, { width: 380 }); doc.text(b, 420, y, { width: 130, align: 'right' }); };
      doc.fontSize(11).font('Helvetica-Bold').text('LIQUIDACIÓN DE IMPUESTO A LAS GANANCIAS - 4TA. CATEGORÍA RELACIÓN DE DEPENDENCIA', { align: 'center' });
      doc.moveDown(0.5).fontSize(9).font('Helvetica');
      doc.text(`Fecha: ${c.fecha} · ${c.tipo}`);
      doc.text(`Beneficiario: ${formatearCuit(c.empleado.cuil)} ${c.empleado.apellido}, ${c.empleado.nombre}`);
      doc.text(`Agente de retención: ${formatearCuit(c.empresa.cuit)} ${c.empresa.razonSocial}`);
      doc.text(`Período fiscal: ${c.anio}`);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text('REMUNERACIONES GRAVADAS'); doc.font('Helvetica');
      fila('Remuneración bruta y no habituales', $(d.r03.bruta));
      fila('SAC', $(String(Number(d.r03.sac1) + Number(d.r03.sac2))));
      fila('Otros empleos - remuneración bruta', $(d.r03.otrosBruta));
      fila('TOTAL REMUNERACIÓN GRAVADA', $(d.r03.total), true);
      doc.moveDown(0.3);
      fila('REMUNERACIONES EXENTAS O NO ALCANZADAS', $(d.r04.totalExento), true);
      fila('TOTAL REMUNERACIONES', $(d.r04.totalRemuneraciones), true);
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('DEDUCCIONES GENERALES'); doc.font('Helvetica');
      fila('Aportes jubilatorios', $(d.r05.aportesSS)); fila('Aportes obra social', $(d.r05.aportesOS)); fila('Cuotas sindicales', $(d.r05.sindical));
      fila('Otros empleos - aportes', $(d.r05.otrosAportes));
      for (const [k, n] of [['cuotasMedicas', 'Cuotas médico asistenciales'], ['gastosMedicos', 'Honorarios médicos'], ['alquiler', 'Alquiler (40 %)'], ['domestico', 'Servicio doméstico'], ['hipotecarios', 'Intereses hipotecarios'], ['educacion', 'Gastos de educación'], ['donaciones', 'Donaciones']] as const) if (Number(d.r05[k])) fila(n, $(d.r05[k]));
      fila('TOTAL DEDUCCIONES GENERALES', $(d.r05.total), true);
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('DEDUCCIONES PERSONALES (ART. 30)'); doc.font('Helvetica');
      fila('Ganancia no imponible', $(d.r06.gni)); fila('Deducción especial', $(d.r06.especial)); fila('Cargas de familia', $(d.r06.totalCargas));
      fila('TOTAL DEDUCCIONES ART. 30', $(d.r06.total), true);
      doc.moveDown(0.3);
      fila('REMUNERACIÓN SUJETA A IMPUESTO', $(d.r08.sujeta), true);
      fila('Impuesto determinado', $(d.r08.determinado));
      fila('Impuesto retenido', $(d.r08.retenido));
      fila('Pagos a cuenta', $(d.r07.total));
      fila(Number(d.r08.saldo) < 0 ? 'SALDO A FAVOR DEL BENEFICIARIO' : 'SALDO A RETENER', $(String(Math.abs(Number(d.r08.saldo)))), true);
      doc.moveDown(2).font('Helvetica').text('Lugar y fecha: ______________________          Firma del responsable: ______________________');
    }
    doc.end();
  });
}
