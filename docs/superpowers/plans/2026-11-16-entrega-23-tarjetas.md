# Entrega 23: cobros con tarjeta. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cobrar con tarjeta (cupones a acreditar) y registrar las liquidaciones de las tarjetas con sus descuentos, su asiento y el ingreso en el banco.

**Architecture:**
- **Modelos nuevos:** `Tarjeta`, `CuponTarjeta`, `LiquidacionTarjeta` y `LiquidacionTarjetaImpuesto`.
- **Cupones:** `IngresosService.crearEnTx` (usado por ingresos y recibos) suma cupones.
- **Servicio nuevo:** `tarjetas.service.ts` en `apps/api/src/tesoreria/operaciones/` (maestro, cupones, liquidaciones y costo).
- **Cuentas:** se resuelven con `ConfigComprasService.cuenta()` y un concepto nuevo `COMISIONES_TARJETA`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-entrega-23-tarjetas-design.md` (§9 es vinculante).

## Global Constraints

- **Mensajes:** los mensajes exactos del spec (§3, §4, §9).
- **Importes:** Decimal, cierre de la liquidación al centavo.
- **Pruebas:** reloj 2026-11-06; helpers de tesorería existentes (`test/helpers-tesoreria.ts`, `test/helpers.ts`).
- **Migración:** `apps/api/prisma/migrations/20261122090000_tarjetas/migration.sql` (con una segunda para datos si usa enums nuevos). Sin borrar `Liquidacion_mensual_sac_unica`.
- **Permiso nuevo:** `tesoreria.tarjetas` ("Liquidar tarjetas"), en el rol Administrador de la demo y en los roles que tienen `tesoreria.aceptar`.

## Review Focus

1. **Recibo mixto** (efectivo + transferencia + cupón) → asiento con cada medio en su cuenta y el total aplicado al cliente correcto. Prueba en Task 2.
2. **Anular un ingreso de valores con cupones pendientes y cheques** → cupones `ANULADO` y cheques anulados, como ya pasa con los cheques. Prueba en Task 2.
3. **Liquidación con cupones de dos sucursales por un usuario limitado a una** → 400. Si no tiene restricción, se acepta. Prueba en Task 3.
4. **Tarjeta con la cuenta a cobrar cambiada entre el cobro y la liquidación** → el haber del asiento usa la cuenta copiada en el cupón. Prueba en Task 3.
5. **Neto mayor que el bruto o descuentos negativos** → 400. Prueba en Task 3.

---

### Task 1: Modelo, migración y maestro de tarjetas

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma` y la migración;
  - `packages/shared/src/permisos.ts`;
  - `apps/api/src/compras/config/conceptos.ts` (`COMISIONES_TARJETA: '5.2.12'`);
  - `apps/api/src/seed/plan-cuentas-modelo.ts` (`1.1.02.003 Tarjetas a cobrar` y `5.2.12 Comisiones de tarjetas`);
  - `apps/api/src/seed/demo.ts` (tres tarjetas y el permiso);
  - `src/prisma/modelos-empresa.ts`.
- Create `apps/api/src/tesoreria/operaciones/{tarjetas.service.ts,tarjetas.controller.ts}`.
- Test `apps/api/test/tarjetas-maestro.e2e-spec.ts`.

**Interfaces:**
- **Endpoints:**
  - `GET /api/tesoreria/tarjetas` (cualquier usuario autenticado, como cuentas bancarias);
  - `POST /api/tesoreria/tarjetas { nombre, tipo, cuentaBancariaId, cuentaContableId? }` (`tesoreria.maestros.editar`; la cuenta contable es por defecto la del concepto `TARJETAS_A_COBRAR`, nuevo, `1.1.02.003`);
  - `PUT /api/tesoreria/tarjetas/:id`.
- **Migración (datos):**
  - cuentas `1.1.02.003` y `5.2.12` en las empresas con plan, si el código está libre y el padre es `Créditos por ventas` o `Gastos`;
  - `ConfigCuenta` de `TARJETAS_A_COBRAR` y `COMISIONES_TARJETA`.

- [ ] **Step 1: Tests que fallan:**
  - `it('alta de tarjeta')`:
    - POST Visa crédito con la cuenta bancaria ARS → 201 con `cuentaContableId` = `1.1.02.003`;
    - con una cuenta USD → 400 `La cuenta bancaria debe ser en pesos`;
    - nombre repetido → 409 o 400 (el mismo patrón de maestros).
  - `it('empresa nueva trae las cuentas y la configuración')`: cuentas `1.1.02.003` y `5.2.12`; `ConfigCuenta` de los dos conceptos.
  - `it('permisos')`: sin `tesoreria.maestros.editar`, el POST da 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Recompilar shared; migrate diff (revisar el índice parcial), deploy y generate.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(tesoreria): maestro de tarjetas`.

### Task 2: Cobro con cupones

**Files:**
- Modify:
  - `apps/api/src/tesoreria/operaciones/{dto.ts,ingresos.service.ts}`;
  - `apps/api/src/ventas/recibos/{dto.ts,recibos.service.ts}`;
  - `tarjetas.service.ts` y `tarjetas.controller.ts` (consulta de cupones).
- Test `apps/api/test/tarjetas-cobros.e2e-spec.ts`.

**Interfaces:**
- `esquemaIngreso` suma `cupones: z.array(z.object({ tarjetaId, lote?, numero?, cuotas? (1-60), importe }))` con default `[]`. `esquemaRecibo` lo toma de ahí.
- `crearEnTx` graba un `CuponTarjeta` por cupón (con `sucursalId` del ingreso y `cuentaContableId` de la tarjeta), suma los cupones al total y, en el asiento propio del ingreso, los debita en su cuenta copiada.
- El asiento del recibo hace lo mismo con los cupones.
- Anular un ingreso o recibo aplica la regla del spec §3.
- `GET /api/tesoreria/cupones?tarjetaId&estado&desde&hasta` (`tesoreria.ver`, con el filtro de sucursal del usuario).

- [ ] **Step 1: Tests que fallan:**
  - `it('recibo con cupones')`:
    - factura de 150.000; recibo con cupones de Visa por 100.000 y 50.000;
    - asiento con debe `1.1.02.003` 150.000;
    - dos cupones `PENDIENTE` y la factura cancelada.
  - `it('recibo mixto')` (Review Focus 1): efectivo 10.000 + transferencia 20.000 + cupón 30.000 contra una factura de 60.000 → debe en caja, transferencias a acreditar y `1.1.02.003`; el cliente queda en 0.
  - `it('ingreso de valores con cupones')`: ingreso de otro origen con un cupón → cupón pendiente.
  - `it('caja en dólares')` → 400 `Los cupones de tarjeta se cobran en pesos`.
  - `it('anular con cupones')` (Review Focus 2): ingreso con cupón y cheque → anular → cupón `ANULADO` y cheque anulado.
  - `it('consulta de cupones')`: totales por tarjeta y días desde el cobro.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS; `test/tesoreria*`, `test/ventas*` y `test/tarjetas*` en verde.
- [ ] **Step 5:** Commit `feat(tesoreria): cobros con tarjeta`.

### Task 3: Liquidaciones y costo

**Files:**
- Modify `tarjetas.service.ts` y `tarjetas.controller.ts`.
- Test `apps/api/test/tarjetas-liquidaciones.e2e-spec.ts`.

**Interfaces:**
- **Endpoints:**
  - `POST /api/tesoreria/liquidaciones-tarjeta`, `POST :id/anular`, `GET` y `GET :id` (`tesoreria.tarjetas` para escribir, `tesoreria.ver` para leer);
  - `GET /api/tesoreria/tarjetas/costo?desde&hasta[&formato]` (`tesoreria.ver`).
- **Asiento** según el spec §4 con las cuentas de §9.1. El haber agrupa por la cuenta copiada en cada cupón.

- [ ] **Step 1: Tests que fallan:**
  - `it('liquidación del ejemplo')`:
    - con los cupones de 100.000 y 50.000 → 201;
    - asiento: debe banco `141983.00`, `5.2.12` `2700.00`, `1.1.03.001` `567.00`, `1.1.03.005` `1500.00`, `1.1.03.006` `1000.00` y `1.1.03.007` `2250.00`; haber `1.1.02.003` `150000.00`;
    - movimiento INGRESO de 141.983 en la cuenta bancaria;
    - cupones `LIQUIDADO`.
  - `it('no cierra')`: neto 141.982,99 → 400 `La liquidación no cierra: diferencia $ 0,01`.
  - `it('valores inválidos')` (Review Focus 5): arancel negativo → 400; neto 0 → 400.
  - `it('cupón ajeno o liquidado')`: cupón de Mastercard en una liquidación de Visa → 400; cupón ya liquidado → 400 `El cupón N no está pendiente`.
  - `it('dos liquidaciones simultáneas')`: `Promise.all` con el mismo cupón → [201, 400].
  - `it('anular')`:
    - anular → contraasiento, movimiento anulado y cupones `PENDIENTE`;
    - anular el recibo con un cupón liquidado (antes de anular la liquidación) → 400 `El cupón N de Visa crédito ya está liquidado: anule primero la liquidación N° 1`.
  - `it('cuenta copiada')` (Review Focus 4): cambiar la cuenta a cobrar de la tarjeta después del cobro → el haber sigue en `1.1.02.003`.
  - `it('sucursales')` (Review Focus 3): usuario limitado a la sucursal A con un cupón de la sucursal B → 400.
  - `it('costo por tarjeta')`: Visa con `costoPct '1.80'` y `descuentoTotalPct '5.34'`.
  - `it('permisos')`: sin `tesoreria.tarjetas`, el POST da 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. Correr la suite API completa (dos mitades con `--shard`, sin otras pruebas en paralelo).
- [ ] **Step 5:** Commit `feat(tesoreria): liquidaciones de tarjetas y costo`.

### Task 4: Web

**Files:**
- Create `apps/web/src/tesoreria/{TarjetasPages.tsx,tarjetas.test.tsx}`.
- Modify:
  - el formulario de cobros (`apps/web/src/ventas/` recibo y `apps/web/src/tesoreria/IngresoValoresPage.tsx`) con una sección "Tarjetas";
  - `BancosCajasPages.tsx` (pestaña Tarjetas);
  - menú y rutas (`/tesoreria/tarjetas/cupones`, `/tesoreria/tarjetas/liquidaciones` y `/tesoreria/tarjetas/costo`).

**Interfaces:** exportados para las pruebas:
- `RenglonesCupones({ tarjetas, cupones, onCambiar })`;
- `FormLiquidacion({ cupones, onConfirmar })`;
- `diferenciaLiquidacion(d): number`.

- [ ] **Step 1: Tests que fallan:**
  - `diferenciaLiquidacion` con el ejemplo → 0; con neto 141.982,99 → 0,01.
  - `FormLiquidacion`:
    - con los dos cupones tildados muestra `Bruto $ 150.000,00`;
    - con una diferencia, "Confirmar" está deshabilitado y se ve `Diferencia $ 0,01`.
  - `RenglonesCupones`: agregar un renglón de Visa por 1000 → `onCambiar` con `[{ tarjetaId, importe: 1000, cuotas: 1 }]`.
  - Menú: con `tesoreria.ver` aparece "Cupones de tarjetas".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS; suite web y build en verde.
- [ ] **Step 5:** Commit `feat(web): cobros y liquidaciones de tarjetas`.

### Task 5: E2E y README

**Files:** Create `e2e/tarjetas.spec.ts`; Modify `README.md`.

- [ ] **Step 1: Test** `test('tarjetas: el administrador cobra con tarjeta, liquida los cupones y ve el neto en el banco')`:
  - admin de la demo;
  - recibo de un cliente con un cupón de Visa;
  - liquidación con arancel y su IVA;
  - en Cupones, la tarjeta sin pendientes.
  - Si compara saldos del banco demo, correr en el proyecto de tesorería o en uno propio posterior.
- [ ] **Step 2:** Recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 20/20.
- [ ] **Step 3:** README, sección "Cobros con tarjeta (Entrega 23)".
- [ ] **Step 4:** Suites en verde.
- [ ] **Step 5:** Commit `test(e2e): tarjetas; docs: README entrega 23`.
