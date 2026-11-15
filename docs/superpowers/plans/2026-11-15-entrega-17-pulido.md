# Entrega 17 — Pulido Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los pendientes de las entregas 13 a 16 que dan números incorrectos, pierden datos o traban al usuario.

**Architecture:** Arreglos puntuales en los módulos existentes (`bienes-uso`, `ventas`, `presupuestos`, `finanzas`, `informes`) y en la web; sin modelos nuevos (una migración solo de índices y datos).

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-entrega-17-pulido-design.md`

## Global Constraints

- Cada arreglo con su prueba que falla antes; mensajes exactos del spec.
- "Hoy" siempre `hoyEn(ZONA_ARGENTINA)` en la API y `hoy()` de `apps/web/src/compras/formato.ts` en la web.
- Reloj de pruebas de la API congelado en 2026-11-06.

## Review Focus

1. **Bienes existentes al pasar a numeración atómica** → el próximo número sigue al máximo actual de cada empresa (no repite 1). Prueba en Task 1.
2. **Rubro con bienes dados de baja (sin activos)** → igual no se cambian sus cuentas (los asientos históricos apuntan a ellas). Prueba en Task 1.
3. **Marcar vigente B cuando A ya lo es** → sigue funcionando con el índice único parcial (primero se desmarca A). Prueba en Task 3.
4. **Saldos de clientes a una fecha anterior a un cobro** → la factura aparece con su saldo de ese día. Prueba en Task 2.
5. **Flujo semanal con 52 semanas desde un miércoles** → 53 filas aceptadas (la primera parcial); 53 semanas completas → 400. Prueba en Task 3.

---

### Task 1: Bienes de uso (API)

**Files:** Modify `apps/api/src/bienes-uso/{bienes.service.ts,bajas.service.ts,rubros.service.ts,bienes.controller.ts}`, `apps/api/src/ventas/emision/emision.service.ts`; migración `apps/api/prisma/migrations/20261116090000_pulido_17/migration.sql` (Talonario `BIEN_USO` por empresa con `ultimoNumero = max(numero)`); Test `apps/api/test/pulido17-bienes.e2e-spec.ts` y `apps/api/src/bienes-uso/bajas.spec.ts`.

- [ ] **Step 1: Tests que fallan:**
  - `src/bienes-uso/bajas.spec.ts` › `it('la baja por venta usa la fecha del comprobante y el asiento la del período abierto')`: `BajasService` con dependencias simuladas; `alAutorizarVenta(tx, fechaAsiento=2026-11-01, fechaComprobante=2026-10-15, renglones)` → `asientos.generar` con `fecha` 2026-11-01 y `bienUso.update` con `fechaBaja` 2026-10-15 (la reserva ya rechaza meses cerrados; la diferencia solo aparece si el mes se cierra durante la emisión, que no se puede provocar en una prueba e2e).
  - `it('numeración atómica continúa la existente')` (Review Focus 1): crear un bien con prisma con `numero 7` → el siguiente alta manual recibe `8`; dos altas simultáneas (Promise.all) → números distintos, ambas 201.
  - `it('rubro con bienes no cambia sus cuentas')` (Review Focus 2): cambiar `cuentaOrigenId` de Rodados con un bien (también con el bien dado de baja) → `El rubro tiene bienes: no se pueden cambiar sus cuentas`; cambiar `vidaUtilMeses` → 200.
  - `it('venta de un bien en nota de débito')`: ND asociada a una factura con renglón `bienUsoId` → autorizada y bien en `BAJA`.
  - `it('facturación ve los bienes activos')`: usuario con `venta.emitir` (sin `bienes.ver`) → `GET /api/bienes-uso?estado=ACTIVO` 200.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (`siguienteNumero` → `NumeracionService.siguiente(tx, 'BIEN_USO', 0)`; `GET /bienes-uso` con `@RequiereAlguno('bienes.ver', 'venta.emitir')`; `validarVenta` admite `NOTA_DEBITO`, ya excluye NC; `alAutorizarVenta(tx, fechaAsiento, c.fecha, renglones)` usa `c.fecha` como `fechaBaja` y `fechaAsiento` para el asiento). **Step 4:** PASS; `test/bienes*` verdes.
- [ ] **Step 5:** commit `fix(bienes-uso): fecha de baja por venta, numeración, cuentas de rubro y ventas por ND`.

### Task 2: Saldos de clientes a una fecha

**Files:** Modify `apps/api/src/ventas/consultas/consultas-ventas.service.ts` (`saldosClientes` usa `saldosAFecha(db, 'clientes', corte)`); Test `apps/api/test/pulido17-saldos-clientes.e2e-spec.ts`.

- [ ] **Step 1: Test que falla** (Review Focus 4): factura del 2026-10-01 que vence 2026-10-05 cobrada con recibo el 2026-11-03 → `GET /api/ventas/saldos?fecha=2026-10-31` → fila del cliente `d1a30 '1210.00'`; `fecha=2026-11-05` → sin filas; una factura del 2026-11-04 no aparece con `fecha=2026-11-03`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (misma forma de respuesta). **Step 4:** PASS; `test/ventas-consultas` verde.
- [ ] **Step 5:** commit `fix(ventas): saldos de clientes a una fecha con el saldo reconstruido`.

### Task 3: Presupuestos, flujo e informes (API)

**Files:** Modify `apps/api/src/presupuestos/{presupuestos.service.ts,carga.service.ts,comparacion.service.ts,presupuestos.controller.ts}`, `apps/api/src/informes/{informes.service.ts,informes.controller.ts}`, `apps/api/src/finanzas/flujo.service.ts`; migración de Task 1 suma `CREATE UNIQUE INDEX "Presupuesto_un_vigente" ON "Presupuesto" ("ejercicioId") WHERE "vigente"`; Test `apps/api/test/pulido17-presupuestos.e2e-spec.ts`.

- [ ] **Step 1: Tests que fallan:**
  - `it('un solo vigente garantizado por la base')` (Review Focus 3): insertar con prisma un segundo `vigente: true` en el mismo ejercicio → error de restricción; `POST vigente` de B con A vigente → 201 y solo B vigente.
  - `it('tarjeta sin meses futuros y con período')`: presupuesto vigente con 100.000 de ventas en 11/2026 y 12/2026; tablero `desde=2026-11-01&hasta=2026-12-31` → `resultadoPresupuestado '100000.00'` (solo hasta 11/2026, el mes de hoy); respuesta incluye `desde: '2026-11'`, `hasta: '2026-11'` para el enlace.
  - `it('actualizadoEn en cargas masivas')`: repartir, importar, traer real y eliminar línea cambian `actualizadoEn`.
  - `it('centro inválido al eliminar línea')`: `centroCostoId=abc` → 400.
  - `it('CSV con coma y formato argentino')`: `Cuenta,Centro de costo,01/2026,…` con `"1.234,50"` → `1234.50`.
  - `it('rango por defecto en hora argentina')`: con reloj fijado en `2026-11-30T23:30:00-03:00` (UTC ya es 12/2026) → `hasta '2026-11'` (usar el helper de reloj de pruebas para mover la hora).
  - `it('52 semanas completas')` (Review Focus 5): `agrupar=semana&hasta=` hoy + 52 semanas → 200 con 53 filas; hoy + 53 semanas → 400 `El flujo semanal admite hasta 52 semanas`.
  - `it('título del Excel con tilde')`: `GET /api/informes/ventas?…&agrupar=articulo&formato=xlsx` → la hoja/título dice `Ventas por artículo`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (límite semanal: contar semanas completas después de la primera parcial). **Step 4:** PASS; `test/presupuestos*`, `test/finanzas*`, `test/informes*` verdes; suite API completa (dos mitades con `--shard`, sin otras pruebas en paralelo).
- [ ] **Step 5:** commit `fix: presupuesto vigente único, tarjeta, cargas, flujo semanal y títulos`.

### Task 4: Web

**Files:** Modify `apps/web/src/bienes-uso/BienesPage.tsx` (ficha: Editar y Eliminar), `apps/web/src/ventas/ComprobanteVentaPage.tsx` (bien de uso también en ND; permiso `venta.emitir`), `apps/web/src/tesoreria/FlujoFondosPage.tsx` (hasta por defecto con `hoy()`), `apps/web/src/presupuestos/PresupuestosPage.tsx` (confirmación al eliminar, aviso de línea existente, repartir exige total, solo lectura con ejercicio cerrado), `apps/web/src/informes/TableroPage.tsx` (tarjetas con `reexpresar`; tarjeta de presupuesto con `desde`/`hasta`); Test `apps/web/src/pulido17.test.tsx`.

- [ ] **Step 1: Tests que fallan:**
  - `TarjetaPresupuesto` con `desde '2026-11'`/`hasta '2026-11'` → navega a `/informes/presupuesto-real?desde=2026-11&hasta=2026-11`.
  - `GrillaPresupuesto` con `editable={false}` (ejercicio cerrado) → sin inputs.
  - función `destinoTarjeta('/informes/ventas?x=1', true)` → `/informes/ventas?x=1&reexpresar=true`.
  - `FormEdicionBien` de un bien de factura → campos de descripción, vida útil y residual; sin fecha ni valor.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; suite web y build; e2e completas (15/15) con base fresca.
- [ ] **Step 5:** commit `fix(web): bienes, presupuestos, flujo y tablero`.
