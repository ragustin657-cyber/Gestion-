import PDFDocument from 'pdfkit';
import { formatearCuit } from '@gestion/shared';
import { importeAR } from '../../ventas/pdf/pdf-venta';
import { HojaGanancias } from './calculo';

/** Hoja de cálculo de la retención de Ganancias de cuarta de un recibo, para entregar al empleado (spec E31 §6). */
export function pdfHojaGanancias(d: { empresa: { razonSocial: string; cuit: string }; empleado: { apellido: string; nombre: string; cuil: string }; periodo: string; hoja: HojaGanancias }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, compress: process.env.NODE_ENV !== 'test' });
    const partes: Buffer[] = [];
    doc.on('data', (b: Buffer) => partes.push(b)).on('end', () => resolve(Buffer.concat(partes))).on('error', reject);
    const h = d.hoja;
    const $ = (x: string) => `$ ${importeAR(x)}`;
    doc.fontSize(13).text('Retención del impuesto a las ganancias (4.ª categoría)', { align: 'center' });
    doc.moveDown(0.5).fontSize(9).text(`${d.empresa.razonSocial} - CUIT ${formatearCuit(d.empresa.cuit)}`);
    doc.text(`Empleado: ${d.empleado.apellido}, ${d.empleado.nombre} - CUIL ${formatearCuit(d.empleado.cuil)}`);
    doc.text(`Liquidación: ${d.periodo} - importes acumulados a ${String(h.mes).padStart(2, '0')}`);
    doc.moveDown();
    const fila = (a: string, b: string) => { const y = doc.y; doc.text(a, 40, y, { width: 360 }); doc.text(b, 400, y, { width: 150, align: 'right' }); };
    fila('Ganancia bruta acumulada', $(h.bruta));
    fila('Aportes (jubilación, obra social, sindicato)', `- ${$(h.aportes)}`);
    for (const x of h.deducciones) fila(`${x.nombre} (informado ${$(x.informado)})`, `- ${$(x.computado)}`);
    fila('Ganancia no imponible', `- ${$(h.personales.gni)}`);
    fila('Deducción especial', `- ${$(h.personales.especial)}`);
    fila('Cargas de familia', `- ${$(h.personales.cargas)}`);
    doc.moveDown(0.3).font('Helvetica-Bold');
    fila('Ganancia sujeta a impuesto', $(h.sujeta));
    doc.font('Helvetica');
    fila(`Escala: ${$(h.tramo.fijo)} más el ${h.tramo.porcentaje} % sobre el excedente de ${$(h.tramo.desde)}`, $(h.impuesto));
    fila('Retenido anteriormente', `- ${$(h.retenidoAnterior)}`);
    fila('Tope del mes (35 % de la remuneración bruta)', $(h.topeMes));
    doc.moveDown(0.3).font('Helvetica-Bold');
    fila(Number(h.importe) < 0 ? 'Devolución del mes' : 'Retención del mes', $(String(Math.abs(Number(h.importe)))));
    doc.font('Helvetica');
    if (Number(h.noRetenido) > 0) fila('Excedente no retenido (se retiene en los meses siguientes)', $(h.noRetenido));
    if (h.avisos.length) { doc.moveDown(); for (const a of h.avisos) doc.fontSize(8).text(a); }
    doc.end();
  });
}
