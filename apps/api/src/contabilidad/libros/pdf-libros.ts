import PDFDocument from 'pdfkit';

const num = (v: string | number) => Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const IZQ = 40;
const DER = 555;
const ALTO_LINEA = 12;
const LIMITE = 780;

export interface Encabezado { empresa: string; cuit: string; libro: string; rango: string }
export interface Columna { ancho: number; importe?: boolean; negrita?: boolean }

/**
 * Documento foliado: encabezado con folio en cada página. `transporte` (opcional) devuelve los totales acumulados,
 * que se imprimen como "Transporte" al pie y "Viene de transporte" al comienzo de la página siguiente.
 */
export class DocumentoFoliado {
  readonly doc = new PDFDocument({ size: 'A4', margin: 40, compress: process.env.NODE_ENV !== 'test' });
  private partes: Buffer[] = [];
  private y = 0;
  folio: number;

  constructor(private readonly enc: Encabezado, folioInicial: number, private readonly transporte?: () => [string, string]) {
    this.folio = folioInicial;
    this.doc.on('data', (c: Buffer) => this.partes.push(c));
    this.encabezado(false);
  }

  private encabezado(conTransporte: boolean) {
    const d = this.doc;
    d.fontSize(10).font('Helvetica-Bold').text(this.enc.empresa, IZQ, 30, { lineBreak: false });
    d.text(`Folio ${this.folio}`, IZQ, 30, { width: DER - IZQ, align: 'right', lineBreak: false });
    d.fontSize(8).font('Helvetica').text(`CUIT ${this.enc.cuit}`, IZQ, 43, { lineBreak: false });
    d.text(`${this.enc.libro} · ${this.enc.rango}`, IZQ, 43, { width: DER - IZQ, align: 'right', lineBreak: false });
    d.moveTo(IZQ, 56).lineTo(DER, 56).stroke();
    this.y = 62;
    if (conTransporte && this.transporte) this.fila([{ texto: 'Viene de transporte', ancho: 355, negrita: true }, { texto: this.transporte()[0], ancho: 80, importe: true, negrita: true }, { texto: this.transporte()[1], ancho: 80, importe: true, negrita: true }]);
  }

  private nuevaPagina() {
    if (this.transporte) {
      const [debe, haber] = this.transporte();
      this.fila([{ texto: 'Transporte', ancho: 355, negrita: true }, { texto: debe, ancho: 80, importe: true, negrita: true }, { texto: haber, ancho: 80, importe: true, negrita: true }], true);
    }
    this.doc.addPage();
    this.folio++;
    this.encabezado(true);
  }

  /** Reserva lugar para `lineas` renglones; si no entran, pasa de página (con transporte). */
  reservar(lineas: number) {
    if (this.y + lineas * ALTO_LINEA > LIMITE) this.nuevaPagina();
  }

  fila(celdas: { texto: string | number; ancho: number; importe?: boolean; negrita?: boolean }[], sinControl = false) {
    if (!sinControl) this.reservar(1);
    let x = IZQ;
    for (const c of celdas) {
      const t = c.importe ? (c.texto === '' ? '' : num(c.texto)) : String(c.texto);
      this.doc.fontSize(8).font(c.negrita ? 'Helvetica-Bold' : 'Helvetica').text(t, x, this.y, { width: c.ancho - 4, align: c.importe ? 'right' : 'left', lineBreak: false, ellipsis: true });
      x += c.ancho;
    }
    this.y += ALTO_LINEA;
  }

  titulo(texto: string) {
    this.reservar(3);
    this.y += 6;
    this.doc.fontSize(10).font('Helvetica-Bold').text(texto, IZQ, this.y, { lineBreak: false });
    this.y += 16;
  }

  terminar(): Promise<{ pdf: Buffer; folioFinal: number }> {
    return new Promise((resolve, reject) => {
      this.doc.on('end', () => resolve({ pdf: Buffer.concat(this.partes), folioFinal: this.folio }));
      this.doc.on('error', reject);
      this.doc.end();
    });
  }
}
