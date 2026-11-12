# Entrega 15 — Finanzas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saldo pendiente de cada comprobante a una fecha (reconstruido desde aplicaciones), usado por todas las antigüedades, y flujo de fondos proyectado completo (bancos, cajas, cheques, cobranzas, OP y proveedores) agrupado por día, semana o mes.

**Architecture:** Módulo `apps/api/src/finanzas/` con `saldos.ts` (saldo a una fecha, consultas agregadas) y `periodos.ts` (cortes de períodos puros). El flujo se implementa en `apps/api/src/finanzas/flujo.service.ts` y lo expone el controlador de consultas de tesorería existente (`/api/tesoreria/flujo`), reemplazando la respuesta actual. Las antigüedades (informes, tablero, Compras) pasan a usar `saldosAFecha`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7 + `@mantine/charts`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-entrega-15-finanzas-design.md`

## Global Constraints

- Acceso a datos por `TenantPrisma`; sin modelos nuevos ni migraciones.
- Importes en texto con 2 decimales (`toFixed(2)`); cálculos con `Prisma.Decimal`.
- Hoy = fecha en zona Argentina (`hoyEn(ZONA_ARGENTINA)`); reloj de pruebas congelado en 2026-11-06 (viernes).
- Mensajes exactos del spec: `El flujo diario admite hasta 90 días`, `Falta la cotización del dólar`.
- Permiso del flujo: `tesoreria.ver`; usuarios con alcance de sucursal: solo sus cheques en cartera/tránsito y sus cajas.

## Review Focus

1. **Recibo o cobro anulado después de aplicarse, y OP anulada** → sus aplicaciones (anuladas) no reducen el saldo a ninguna fecha; el control a hoy sigue cerrando. Prueba en Task 1.
2. **Factura de proveedor pagada en dos OP, una pagada y otra aprobada** → el flujo cuenta la OP aprobada hoy y la factura solo por lo que no está imputado. Prueba en Task 3.
3. **Período de un día que cae en domingo / mes que termina en `hasta` a mitad de mes** → los cortes de semana y mes respetan `hasta` y el primer período empieza hoy. Prueba en Task 2.
4. **Empresa sin bancos, sin cajas y sin cuentas corrientes** → flujo con saldo inicial 0,00, filas en cero y `primerNegativo` null, sin errores. Prueba en Task 3.
5. **Movimiento con fecha posterior al corte** → no aparece en la antigüedad de ese corte (informe y Compras). Prueba en Task 2.

---

### Task 1: Saldo pendiente a una fecha

**Files:**
- Create: `apps/api/src/finanzas/saldos.ts`
- Test: `apps/api/test/finanzas-saldos.e2e-spec.ts`

**Interfaces — Produces:**
- `interface SaldoMovimiento { movimientoId: string; terceroId: string; origenTipo: string; origenId: string; fecha: Date; fechaVencimiento: Date; monedaCodigo: string; importePesos: Dec; saldoPesos: Dec }`
- `saldosAFecha(tx: TxEmpresa, tipo: 'clientes' | 'proveedores', corte: Date): Promise<SaldoMovimiento[]>` — spec §2 (solo saldo ≠ 0; tres `groupBy` sobre `AplicacionCuentaCorriente` y `AplicacionCobro` con `anulada: false` y `fecha ≤ corte`).

- [ ] **Step 1: Tests que fallan** (llaman a `saldosAFecha(prisma as unknown as TxEmpresa, …)` directamente: cada prueba arranca de una base limpia con una sola empresa, así que el cliente sin filtro de empresa ve solo sus datos):
  - `it('factura cobrada después del corte')` (spec §3): factura de cliente 1.210 del 2026-09-01 que vence 2026-10-01 (helper `prepararVentas` + `fechaVencimiento` ajustada), recibo y aplicación el 2026-11-03 → a 2026-10-31 saldo `'1210.00'`; a 2026-11-05 sin el movimiento.
  - `it('control a hoy con todos los circuitos')` (Review Focus 1): factura de cliente cobrada en parte (aplicación de 500), NC aplicada, un cobro aplicado y luego anulado; factura de proveedor pagada con OP, otra OP anulada, factura de proveedor en USD → para todo movimiento no anulado, `saldosAFecha(…, hoy).saldoPesos` = `MovimientoCuentaCorriente.saldoPesos`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(finanzas): saldo pendiente a una fecha`.

### Task 2: Antigüedad a una fecha en informes, tablero y Compras; cortes de períodos

**Files:**
- Modify: `apps/api/src/informes/fuentes/cuentas.ts` (usa `saldosAFecha`), `apps/api/src/compras/consultas/consultas.service.ts` (`antiguedadDeuda` usa `saldosAFecha('proveedores', corte)`)
- Create: `apps/api/src/finanzas/periodos.ts` + `apps/api/src/finanzas/periodos.spec.ts`
- Test: `apps/api/test/finanzas-antiguedad.e2e-spec.ts`

**Interfaces — Produces:** `periodos(desde: Date, hasta: Date, agrupar: 'dia' | 'semana' | 'mes'): { desde: Date; hasta: Date; etiqueta: string }[]` — semana lunes–domingo (primera desde `desde`), mes calendario (primero desde `desde`), último cortado en `hasta`; etiquetas `'06/11'` (día), `'06/11–08/11'` (semana), `'nov 2026'` (mes).

- [ ] **Step 1: Tests que fallan:**
  - `periodos.spec.ts`: `periodos(06/11/2026, 29/11/2026, 'semana')` → 4 períodos `06/11–08/11`, `09/11–15/11`, `16/11–22/11`, `23/11–29/11`; `periodos(06/11, 08/11, 'dia')` → 3; `periodos(06/11/2026, 15/01/2027, 'mes')` → `nov 2026` (06–30/11), `dic 2026`, `ene 2027` (01–15/01) (Review Focus 3); `periodos(08/11, 08/11, 'semana')` (domingo) → 1 período `08/11–08/11`.
  - `it('informe, tablero y Compras coinciden a una fecha pasada')`: factura de proveedor 1.210 del 2026-09-01 que vence 2026-10-01 pagada con OP el 2026-11-03 → `GET /api/informes/antiguedad?tipo=proveedores&fecha=2026-10-31` tramo `d1_30` `'1210.00'`; `GET /api/compras/consultas/antiguedad-deuda?fecha=2026-10-31` `d0a30` `'1210.00'`; a 2026-11-05 ambos vacíos.
  - `it('excluye movimientos posteriores al corte')` (Review Focus 5): factura de proveedor del 2026-11-02 → antigüedad de Compras al 2026-10-31 sin ella.
  - Las pruebas existentes de antigüedad (`test/informes-saldos-stock`, `test/compras-consultas*`, `test/informes-tablero`) siguen verdes.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(finanzas): antigüedad de saldos a una fecha en informes y compras`.

### Task 3: Flujo de fondos proyectado (API)

**Files:**
- Create: `apps/api/src/finanzas/flujo.service.ts`, `apps/api/src/finanzas/finanzas.module.ts` (global; importado en `app.module.ts`)
- Modify: `apps/api/src/tesoreria/operaciones/consultas.controller.ts` (`GET flujo` y `GET flujo/detalle` delegan en `FlujoService`; xlsx/pdf con `tablaXlsx`/`tablaPdf`), `apps/api/src/tesoreria/operaciones/consultas.service.ts` (quitar el `flujo` viejo), `apps/api/test/tesoreria-consultas.e2e-spec.ts` (la prueba vieja del flujo se reescribe con la forma nueva, mismos datos)
- Test: `apps/api/test/finanzas-flujo.e2e-spec.ts`

**Interfaces:**
- Consumes: `saldosAFecha` (Task 1), `periodos` (Task 2), `saldoBanco`/`saldoCaja`/`cotizacion` de `tesoreria-comun.ts`, alcance de sucursal como en el flujo actual.
- Produces: respuesta de spec §4 (`{ desde, hasta, agrupar, incluirVencidos, saldoInicial, filas, primerNegativo }`) y detalle `[{ concepto, fecha, descripcion, tercero, importe }]` con `concepto` ∈ `cheques | transferencias | cobranzas | vencidoACobrar | chequesPropios | ordenesPago | proveedores | vencidoAPagar`.

- [ ] **Step 1: Tests que fallan:**
  - `it('ejemplo del spec por semana')`: armar con `prepararTesoreria` + facturas de cliente/proveedor el escenario de spec §4 (banco ARS 100.000 por movimiento bancario, caja 5.000 por movimiento de caja, cheque 30.000 al 16/11, factura cliente 60.500 vence 20/11, factura cliente 12.100 vencida 15/10, factura proveedor 24.200 vence 25/11, factura proveedor 48.400 imputada en OP aprobada, cheque propio 12.000 al 11/11) → `GET /api/tesoreria/flujo?hasta=2026-11-29&agrupar=semana` → `saldoInicial '105000.00'`; saldos `['68700.00','56700.00','147200.00','123000.00']`; fila 1 `ingresos.vencidoACobrar '12100.00'`, `egresos.ordenesPago '48400.00'`; fila 4 `egresos.proveedores '24200.00'`; `primerNegativo null`.
  - `it('sin vencidos')`: `incluirVencidos=false` → saldos `['56600.00','44600.00','135100.00','110900.00']` y `vencidoACobrar` sigue informado.
  - `it('OP parcial no duplica')` (Review Focus 2): factura proveedor 10.000 vence 20/11 con OP aprobada por 4.000 imputada → `ordenesPago '4000.00'` en la primera semana y `proveedores '6000.00'` en la semana del 20/11.
  - `it('dólares a la cotización del día')`: cuenta USD con 100 y cotización 1.000 → saldo inicial suma `'100000.00'`; sin cotización alguna → 400 `Falta la cotización del dólar`.
  - `it('saldo negativo')`: OP aprobada mayor que el saldo → `primerNegativo` = etiqueta de la primera semana.
  - `it('empresa vacía')` (Review Focus 4): `saldoInicial '0.00'`, todas las filas en cero, `primerNegativo null`.
  - `it('por día y por mes; límites')`: `agrupar=dia&hasta=+90 días` → 91 filas no, 400 `El flujo diario admite hasta 90 días` cuando supera; `agrupar=mes&hasta=2027-01-15` → 3 filas; `hasta` anterior a hoy → 400.
  - `it('detalle de un período')`: semana 16–22/11 → dos ítems (`cheques` 30.000, `cobranzas` 60.500 con número de factura y cliente).
  - `it('usuario de sucursal')`: el usuario de Rosario ve solo sus cheques; sin cobranzas, proveedores ni bancos.
  - `it('exporta')`: xlsx y pdf.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; `test/tesoreria*` verdes; suite API completa verde (en dos mitades con `--shard`, sin otras pruebas en paralelo).
- [ ] **Step 5:** commit `feat(finanzas): flujo de fondos proyectado con cobranzas y pagos`.

### Task 4: Web del flujo

**Files:**
- Create: `apps/web/src/tesoreria/FlujoFondosPage.tsx`, `apps/web/src/tesoreria/flujo.test.tsx`
- Modify: `apps/web/src/tesoreria/ConsultasPages.tsx` (quitar el `FlujoFondosPage` viejo), `apps/web/src/paginas/rutas.tsx` (import nuevo)

**Interfaces — Produces:** exportados para test: `TablaFlujo({ datos, onPeriodo })`, `serieFlujo(filas)` → `[{ periodo: etiqueta, ingresos: number, egresos: number, saldo: number }]`.

- [ ] **Step 1: Tests que fallan** (`flujo.test.tsx`):
  - `TablaFlujo` con una fila de saldo `-500.00` → la celda tiene `data-negativo="true"` y aparece la alerta `El saldo queda negativo en 06/11–08/11`.
  - `TablaFlujo` → fila "Saldo inicial" con `$ 105.000,00` y clic en una fila llama `onPeriodo` con su `desde`/`hasta`.
  - `serieFlujo` con una fila (ingresos 42.100, egresos 48.400, saldo 98.700) → `[{ periodo: '06/11–08/11', ingresos: 42100, egresos: 48400, saldo: 98700 }]`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (controles: Hasta, Agrupar Día/Semana/Mes, "Incluir vencidos"; `CompositeChart` barras ingresos/egresos + línea saldo; modal de detalle; Excel y PDF). **Step 4:** PASS; suite web y build.
- [ ] **Step 5:** commit `feat(web): flujo de fondos proyectado`.

### Task 5: E2E y README

**Files:** Create `e2e/finanzas.spec.ts`; Modify `README.md`.

- [ ] **Step 1: Test** `test('finanzas: el tesorero abre el flujo por semana y ve el detalle de un período')`: login admin (la demo tiene bancos y facturas); `/tesoreria/flujo` → ve "Saldo inicial" y al menos una fila de semana; clic en la primera fila → modal "Detalle" visible.
- [ ] **Step 2:** recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 14/14.
- [ ] **Step 3:** README sección "Finanzas (Entrega 15)".
- [ ] **Step 4:** suites API, web y e2e verdes.
- [ ] **Step 5:** commit `test(e2e): flujo de fondos; docs: README entrega 15`.
