# Entrega 27: Intereses por mora. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** liquidar una vez por mes los intereses de las facturas vencidas con una tasa fija y emitir una nota de débito por cliente y moneda.

**Architecture:**
- Módulo nuevo `apps/api/src/ventas/intereses/` (configuración, cálculo, liquidación).
- Las notas de débito se crean con `ComprobantesVentaService` (con opciones internas para la cuenta y sin vendedor) y se emiten con `EmisionService`.
- El cálculo parte de `MovimientoCuentaCorriente` y `AplicacionCobro`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-entrega-27-intereses-design.md` (§9 vinculante).

## Global Constraints

- **Mensajes exactos del spec:**
  - `Configure la tasa de interés por mora`;
  - `Solo se liquidan meses terminados`;
  - `No hay intereses para liquidar en MM/AAAA`;
  - `Las notas de débito de intereses no se modifican: elimínela y vuelva a liquidar`.
- **Fórmula:**
  - `interés = r2(saldoCierre × tasa / 100 × días / 30)`, en la moneda de la factura, como neto del renglón (el IVA va encima);
  - `días = finMes − max(vencimiento, finMesAnterior)`, en días.
- **Reloj de pruebas:** 2026-11-06, así que el mes liquidable de las pruebas es octubre de 2026.
- **Migraciones:**
  - `20261126090000_intereses` (esquema) y `20261126090001_intereses_datos` (concepto `INTERESES_GANADOS` → 4.2.02 y permisos);
  - verificar que no se borre `Liquidacion_mensual_sac_unica` ni los índices parciales de comisiones.

## Review Focus

1. **Factura con pago parcial antes del cierre y otro después.** El saldo al cierre suma solo lo pagado después. Prueba en Task 2.
2. **Cliente con facturas en pesos y en dólares.** Recibe dos notas de débito, cada una asociada a la más vieja de su moneda. Prueba en Task 3.
3. **Liquidar el mismo mes después de anular una nota con una nota de crédito total.** Se vuelve a ofrecer. Prueba en Task 3.
4. **Factura con 21 % y 10,5 %.** El interés va al 21 %, la alícuota con mayor base. Prueba en Task 2.
5. **Factura que vence el último día del mes.** Tiene 0 días, así que no entra. Prueba en Task 2.

---

### Task 1: Configuración, permiso y cuenta

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma` y las migraciones;
  - `apps/api/src/prisma/modelos-empresa.ts`;
  - `packages/shared/src/permisos.ts`;
  - `apps/api/src/compras/config/conceptos.ts` (`INTERESES_GANADOS: '4.2.02'`);
  - `apps/api/src/terceros/dto.ts` (`sinIntereses`);
  - `apps/api/src/seed/demo.ts` (tasa del 5 % y permiso para Facturación);
  - `apps/api/src/ventas/ventas.module.ts`.
- Create: `apps/api/src/ventas/intereses/{config.service.ts,intereses.controller.ts,dto.ts}`.
- Test: `apps/api/test/intereses-config.e2e-spec.ts`.

**Interfaces:**
- **Produces, esquema:**
  - `ConfigIntereses { id, empresaId @unique, tasaMensual Decimal(5,2), descripcion String default "Intereses por mora" }`;
  - `Tercero.sinIntereses Boolean default false`;
  - `LiquidacionIntereses { id, empresaId, numero, anio, mes, tasa Decimal(5,2), fecha, creadoPor, creadoEn }`;
  - `LiquidacionInteresesRenglon { id, empresaId, liquidacionId (cascade), comprobanteId, terceroId, monedaCodigo, saldo, dias Int, interes, alicuota String, notaDebitoId String? @db.Uuid (sin FK) }`, con `@@index([empresaId, comprobanteId])`.
- **Produces, permiso:** `'intereses.liquidar': 'Liquidar intereses por mora'`.
- **Produces, API:**
  - `GET /api/ventas/intereses/configuracion` (`intereses.liquidar`) → `{ tasaMensual: string | null, descripcion }`;
  - `PUT /api/ventas/intereses/configuracion` (`intereses.liquidar`) con body `{ tasaMensual: number, descripcion?: string }`. La tasa va de más de 0 a 100, con 2 decimales; si no, 400 `Tasa inválida`.

- [ ] **Step 1: Tests que fallan:**
  - `it('configurar la tasa')`: GET → `tasaMensual: null`; PUT 5 → 200; GET → `'5.00'`; PUT 0 → 400 `Tasa inválida`.
  - `it('cliente sin intereses')`: PATCH tercero `{ sinIntereses: true }` → el tercero queda con `sinIntereses` en true.
  - `it('empresa nueva trae la cuenta de intereses')`: `ConfigCuenta` `INTERESES_GANADOS` = cuenta 4.2.02.
  - `it('permisos')`: un usuario con `venta.ver` → 403 en la configuración.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - **Migración de datos:** el concepto `INTERESES_GANADOS` en las empresas que tienen la cuenta 4.2.02 "Intereses ganados", y el permiso para los Administrador. Verificarla sobre una demo previa.
  - Actualizar las pruebas que cuentan los conceptos de cuenta (37 → 38).
  - Recompilar shared.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(intereses): configuración, permiso y cuenta`.

### Task 2: Cálculo de un mes

**Files:**
- Create: `apps/api/src/ventas/intereses/calculo.service.ts`.
- Modify: `intereses.controller.ts`.
- Test: `apps/api/test/intereses-calculo.e2e-spec.ts`.

**Interfaces:**
- **Produces:**
  - `InteresesCalculoService.calcular(tx, anio: number, mes: number): Promise<RenglonInteres[]>`;
  - `RenglonInteres = { comprobanteId, terceroId, cliente, comprobante: string, monedaCodigo, vencimiento: string, saldo: Dec, dias: number, interes: Dec, alicuota: string, puntoVentaId: string, fechaComprobante: Date }`;
  - `GET /api/ventas/intereses?anio&mes` (`intereses.liquidar`) → `{ anio, mes, tasa, grupos: [{ terceroId, cliente, monedaCodigo, total: string, renglones: [...serializados] }] }`.
- **Reglas** (spec §4):
  - entran `FACTURA` y `NOTA_DEBITO` autorizados con `vencimiento ≤ fin` y `dias > 0`;
  - quedan afuera los clientes `sinIntereses`, las notas de débito de intereses (un `notaDebitoId` en algún renglón) y las que tengan un renglón **vigente** para ese mes;
  - "vigente" se define en el spec §6: la nota existe y no está cancelada por notas de crédito asociadas.
- **Saldo al cierre:** `saldo actual + Σ AplicacionCobro.importe` (no anuladas, débito = el movimiento de la factura) cuyo movimiento **crédito** tiene `fecha > fin`.
- **Alícuota:** la de `ComprobanteVentaIva` con mayor `base`; sin IVA → `'EXENTO'`.

- [ ] **Step 1: Tests que fallan.** Tasa del 5 %; factura A de 1.000 + 21 % = 1.210 con `fecha 2026-10-01` y `fechaVencimiento 2026-10-10`.
  - `it('días e interés')`: octubre → 21 días; interés `'42.35'` (1.210 × 5 % × 21 / 30).
  - `it('vencida antes del mes')`: vencimiento 2026-09-15 → en octubre, 31 días; interés `'62.52'` (1.210 × 0,05 × 31/30 = 62,516…).
  - `it('pagos antes y después del cierre')` (Review Focus 1):
    - un recibo de 210 el 2026-10-20 y otro de 500 el 2026-11-03;
    - saldo al cierre `'1000.00'` y días 21 → interés `'35.00'`.
  - `it('anticipo anterior aplicado después')`:
    - un cobro de 1.210 del 2026-10-05, aplicado el 2026-11-04;
    - la factura no entra, porque se toma como pagada antes del cierre.
  - `it('alícuotas')` (Review Focus 4): una factura con 1.000 al 21 % y 500 al 10,5 % → `alicuota '21'`; una exenta → `'EXENTO'`.
  - `it('vence el último día')` (Review Focus 5): vencimiento 2026-10-31 → no entra.
  - `it('dólares')`: factura USD 100 exenta que vence el 2026-10-10 → grupo en `USD` con interés `'3.50'`.
  - `it('cliente exceptuado y mes no terminado')`:
    - `sinIntereses` → sin grupos;
    - `mes=11` → 400 `Solo se liquidan meses terminados`;
    - sin configuración → 400 `Configure la tasa de interés por mora`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(intereses): cálculo del mes`.

### Task 3: Confirmar, emitir y doble facturación

**Files:**
- Create: `apps/api/src/ventas/intereses/liquidaciones.service.ts`.
- Modify:
  - `intereses.controller.ts`;
  - `apps/api/src/ventas/comprobantes/comprobantes.service.ts`: `crearEnTx`/`preparar` aceptan `opciones?: { cuentaContableId?: string; sinVendedor?: boolean }`, y `modificar` rechaza las notas de intereses.
- Test: `apps/api/test/intereses-liquidacion.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** `InteresesCalculoService.calcular` (Task 2).
- **Produces:**
  - `POST /api/ventas/intereses` (`intereses.liquidar`) con body `{ anio, mes, excluir?: string[] }` → `{ id, numero, notas: [{ id, terceroId, monedaCodigo, total, estado, mensaje?: string }] }`;
  - `GET /api/ventas/intereses/liquidaciones` (`intereses.liquidar`) → `[{ id, numero, anio, mes, tasa, totales: { ARS?: string; USD?: string }, notas: [{ id, cliente, monedaCodigo, total, estado: 'AUTORIZADO' | 'PENDIENTE_CAE' | 'RECHAZADO' | 'ELIMINADA', numero: string | null }] }]`.
- **Confirmar:**
  - bloqueo consultivo por empresa (`intereses:<empresaId>`);
  - recalcular, excluir lo indicado y agrupar por cliente y moneda;
  - en la transacción: la liquidación, sus renglones y una nota de débito por grupo (borrador, sin emitir);
  - la nota se asocia a la factura más vieja del grupo (por fecha y después por número), con `aplicarAAsociado: false`, la cuenta de `INTERESES_GANADOS`, sin vendedor y con fecha y vencimiento de hoy;
  - **renglones de la nota:** `descripcion: '<config.descripcion> <comprobante> (<dias> días)'`, `cantidad 1`, `precioUnitario` igual al interés (neto) y la alícuota del renglón;
  - fuera de la transacción, `EmisionService.emitir(id)` para cada nota; los errores se informan en `notas[].mensaje`.

- [ ] **Step 1: Tests que fallan.** Mismo escenario de la Task 2, con el cliente `clienteRI`.
  - `it('una nota por cliente y moneda')` (Review Focus 2):
    - dos facturas ARS vencidas en octubre (la del 2026-10-01 y otra del 2026-10-05) y una USD;
    - el POST de octubre da dos notas: la ARS está asociada a la del 2026-10-01, tiene 2 renglones y no tiene vendedor; la USD está asociada a la USD;
    - las dos quedan `AUTORIZADO`.
  - `it('IVA encima y cuenta de intereses')`: la nota ARS de una sola factura (interés 42,35) tiene `netoGravado '42.35'`, `iva '8.89'` y `total '51.24'`; el renglón contable va a 4.2.02.
  - `it('no se liquida dos veces')`:
    - un segundo POST de octubre → 400 `No hay intereses para liquidar en 10/2026`;
    - el GET de octubre → sin grupos.
  - `it('excluir')`: con `excluir: [id de una factura]`, la nota tiene 1 renglón y la excluida sigue apareciendo en el GET.
  - `it('nota de crédito libera el mes')` (Review Focus 3): una nota de crédito por el total de la nota de débito, asociada a ella → el GET de octubre vuelve a ofrecer la factura.
  - `it('nota de intereses no se modifica')`: PUT de la nota → 400 con el mensaje del spec.
  - `it('confirmaciones simultáneas')`: `Promise.all` de dos POST → `[201, 400]` y una sola nota.
  - `it('historial')`: la liquidación con `totales.ARS` y sus notas con número y estado.
  - `it('permisos')`: un usuario con `intereses.liquidar` y sin `venta.emitir` → POST 201.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. `test/ventas*`, `test/comisiones*` y `test/intereses*` en verde; suite API completa en dos mitades.
- [ ] **Step 5:** Commit `feat(intereses): liquidación y notas de débito`.

### Task 4: Web

**Files:**
- Create:
  - `apps/web/src/ventas/InteresesPages.tsx` (`InteresesPage`, `TablaIntereses`, `ConfigIntereses`);
  - `apps/web/src/ventas/intereses.test.tsx`.
- Modify:
  - el menú (*Ventas → Intereses por mora*, con `intereses.liquidar`);
  - las rutas (`/ventas/intereses`);
  - la ficha del tercero (casilla "Sin intereses por mora").

**Interfaces:**
- **Produces:** `TablaIntereses({ grupos, excluidos, onCambiar })`, con una casilla por cliente y otra por factura; muestra el total de lo seleccionado.

- [ ] **Step 1: Tests que fallan:**
  - con dos grupos, el total seleccionado empieza en la suma de ambos;
  - al destildar el cliente, `onCambiar` recibe todas sus facturas excluidas y el total baja;
  - el menú muestra *Intereses por mora* con `intereses.liquidar`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - **Pantalla:** selector de mes (por defecto, el mes anterior), la tabla, *Confirmar liquidación*, el resultado por nota (con el mensaje si falló) y el historial.
  - **Configuración:** un panel con la tasa y la descripción.
- [ ] **Step 4:** PASS. Suite web y build en verde.
- [ ] **Step 5:** Commit `feat(web): intereses por mora`.

### Task 5: E2E y README

- [ ] **Step 1: Test** `test('intereses: el administrador configura la tasa, liquida el mes anterior y ve la nota de débito')`:
  - admin;
  - en la configuración, tasa 5;
  - factura a *Distribuidora Norte SA* con fecha y vencimiento del mes anterior (la fecha la acepta ARCA simulado; si no, se usa la del mes anterior más cercana a hoy, registrado como ruling);
  - liquidar el mes anterior: el resultado muestra una nota autorizada.
  - El navegador va en hora argentina (`timezoneId`), como en la Entrega 25.
- [ ] **Step 2:** recrear `gestion_e2e` y correr `pnpm e2e -- --trace off` → 23/23.
- [ ] **Step 3:** README, sección "Intereses por mora (Entrega 27)".
- [ ] **Step 4:** Commit `test(e2e): intereses; docs: README entrega 27`.
