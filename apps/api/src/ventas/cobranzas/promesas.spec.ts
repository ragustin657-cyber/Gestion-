import { Prisma } from '@prisma/client';
import { estadoPromesa } from './promesas';

const D = (n: number) => new Prisma.Decimal(n);
const f = (s: string) => new Date(`${s}T00:00:00Z`);
const promesa = (o: { hasta?: string } = {}) => ({ fecha: f('2026-11-10'), importe: D(1000), desde: f('2026-11-01'), hasta: o.hasta ? f(o.hasta) : null });
const mov = (origenTipo: string, fecha: string, importePesos: number) => ({ origenTipo, fecha: f(fecha), importePesos: D(importePesos) });

describe('estado de una promesa de pago', () => {
  it('sin cobros: pendiente, e incumplida después de la fecha', () => {
    expect(estadoPromesa(promesa(), [], f('2026-11-06'))).toBe('PENDIENTE');
    expect(estadoPromesa(promesa(), [], f('2026-11-11'))).toBe('INCUMPLIDA');
  });
  it('un recibo que alcanza el importe la cumple', () => {
    expect(estadoPromesa(promesa(), [mov('RECIBO', '2026-11-03', -1000)], f('2026-11-06'))).toBe('CUMPLIDA');
    expect(estadoPromesa(promesa(), [mov('COBRO', '2026-11-03', -600), mov('RECIBO', '2026-11-04', -400)], f('2026-11-11'))).toBe('CUMPLIDA');
  });
  it('un cheque rechazado se resta', () => {
    expect(estadoPromesa(promesa(), [mov('RECIBO', '2026-11-03', -1000), mov('CHEQUE_RECHAZADO_CLIENTE', '2026-11-05', 600)], f('2026-11-06'))).toBe('PENDIENTE');
  });
  it('solo cuentan los cobros desde la gestión y hasta la que la reemplazó', () => {
    expect(estadoPromesa(promesa(), [mov('RECIBO', '2026-10-30', -1000)], f('2026-11-06'))).toBe('PENDIENTE');
    expect(estadoPromesa(promesa({ hasta: '2026-11-03' }), [mov('RECIBO', '2026-11-04', -1000)], f('2026-11-06'))).toBe('PENDIENTE');
    expect(estadoPromesa(promesa(), [mov('VENTA', '2026-11-04', 5000)], f('2026-11-06'))).toBe('PENDIENTE');
  });
});
