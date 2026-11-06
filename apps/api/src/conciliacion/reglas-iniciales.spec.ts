import { Prisma } from '@prisma/client';
import { reglaPara } from './reglas-iniciales';

const regla = (prioridad: number, texto: string, sentido: 'DEBITO' | 'CREDITO' | 'AMBOS' = 'AMBOS') => ({ prioridad, texto, sentido, cuentaBancariaId: null, activa: true });
const linea = (concepto: string, importe = -10) => ({ concepto, importe: new Prisma.Decimal(importe) });

describe('reglas de conciliación', () => {
  it('el texto debe empezar una palabra: IVA no coincide con PRIVADA ni ACTIVA', () => {
    const reglas = [regla(70, 'IVA', 'DEBITO')];
    expect(reglaPara(reglas, linea('TRANSF CTA PRIVADA'), 'c')).toBeNull();
    expect(reglaPara(reglas, linea('CUENTA ACTIVA'), 'c')).toBeNull();
    expect(reglaPara(reglas, linea('IVA COMISION'), 'c')).not.toBeNull();
    expect(reglaPara(reglas, linea('COMISION + IVA'), 'c')).not.toBeNull();
  });
  it('prefijo de palabra: INTERES coincide con INTERESES; acentos y puntos no importan', () => {
    expect(reglaPara([regla(100, 'INTERES', 'CREDITO')], linea('INTERESES GANADOS', 150), 'c')).not.toBeNull();
    expect(reglaPara([regla(40, 'LEY 25413')], linea('Imp. Ley 25413 Déb.'), 'c')).not.toBeNull();
  });
});
