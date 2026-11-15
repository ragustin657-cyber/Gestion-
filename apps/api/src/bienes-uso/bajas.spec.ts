import { Prisma } from '@prisma/client';
import { BajasService } from './bajas.service';

describe('BajasService', () => {
  it('la baja por venta usa la fecha del comprobante y el asiento la del período abierto', async () => {
    const generar = jest.fn().mockResolvedValue({ id: 'asiento' });
    const update = jest.fn().mockResolvedValue({});
    const bien = { id: 'b', numero: 1, descripcion: 'Camioneta', estado: 'ACTIVO', valorOrigen: new Prisma.Decimal(1000), fechaAlta: new Date('2026-03-15T00:00:00Z'), rubro: { cuentaOrigenId: 'o', cuentaAmortizacionId: 'a' } };
    const tx = { $executeRaw: jest.fn(), bienUso: { findUniqueOrThrow: jest.fn().mockResolvedValue(bien), update } };
    const s = new BajasService(
      { empresaId: 'e' } as never, { generar } as never, { cuenta: jest.fn().mockResolvedValue('r') } as never, {} as never,
      { amortizadoVigente: jest.fn().mockResolvedValue(new Prisma.Decimal(100)) } as never,
    );
    await s.alAutorizarVenta(tx as never, new Date('2026-11-01T00:00:00Z'), new Date('2026-10-15T00:00:00Z'), [{ id: 'r1', bienUsoId: 'b' }]);
    expect(generar.mock.calls[0][1].fecha.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(update.mock.calls[0][0].data.fechaBaja.toISOString().slice(0, 10)).toBe('2026-10-15');
  });
});
