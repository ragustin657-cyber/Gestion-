# Entrega 20: liquidación final. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar de baja a un empleado con una liquidación de tipo `FINAL` que calcule días, SAC, vacaciones no gozadas y, si corresponde, indemnización, preaviso e integración, y que se cierre, se pague y vaya al F.931 como las demás.

**Architecture:**
- **Cálculo:** función pura `liquidarFinal` en `apps/api/src/sueldos/calculo.ts`.
- **Egreso:** servicio nuevo `egresos.service.ts`, que hace el alta, la modificación, la eliminación y las validaciones de doble cobro.
- **Liquidaciones:** `liquidaciones.service.ts` calcula las de tipo `FINAL` y excluye de la mensual y del SAC a quien tiene una final.
- **Lo que se adapta para `FINAL`:** cierre, asiento, pagos, F.931 y recibo (Entregas 18 y 19).

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-entrega-20-liquidacion-final-design.md` (§9 es vinculante).

## Global Constraints

- **Mensajes:** los mensajes exactos del spec (§3, §9).
- **Importes:** redondeo half-up a 2 decimales por renglón.
- **Pruebas:**
  - reloj congelado en 2026-11-06;
  - `prepararSueldos` (`test/helpers-sueldos.ts`) da Vendedor B, ingreso 2021-03-01, afiliado y código de obra social `125000`.
- **Renglones finales:** códigos fijos `200`, `300`, `310`, `311`, `320`, `321`, `330`, `331` y `340`, todos con `conceptoId` nulo.
- **Migración:** `apps/api/prisma/migrations/20261119090000_liquidacion_final/migration.sql`; se aplica a `gestion` y a `gestion_test`.

## Review Focus

1. **Baja de alguien ya liquidado en una mensual cerrada de un mes posterior** (baja cargada tarde) → 400 con el mensaje de §9.1, sin crear nada. Prueba en Task 3.
2. **Mensual reabierta con el recibo numerado de quien después tiene una final** → al recalcular, ese recibo se borra. Prueba en Task 3.
3. **Egreso el último día del mes** → sin integración (renglones 320/321). Egreso el mismo día del ingreso → 1 día trabajado, indemnización mínima de 1 año. Prueba en Task 1.
4. **F.931 de un mes con la mensual en borrador y una final cerrada** → 400 `La liquidación mensual de MM/AAAA no está cerrada`. Prueba en Task 4.
5. **Eliminar la final en borrador** → el empleado vuelve a estar activo y sin egreso, y la mensual en borrador lo vuelve a incluir. Prueba en Task 3.

---

### Task 1: Cálculo de la liquidación final

**Files:** Modify `apps/api/src/sueldos/calculo.ts`, `apps/api/src/sueldos/calculo.spec.ts`.

**Interfaces:**
- **Produces** `type CausaEgreso = 'RENUNCIA' | 'DESPIDO_SIN_CAUSA' | 'DESPIDO_CON_CAUSA' | 'MUTUO_ACUERDO'`.
- **Produces** `interface DatosFinal { causa: CausaEgreso; fechaEgreso: Date; preavisoOtorgado: boolean; mejorRemuneracion: Dec; mejorRemuneracionSemestre: Dec; topeIndemnizatorio: Dec | null; baseMaxima: Dec | null; gratificacion: Dec }`.
- **Produces** `liquidarFinal(e: EmpleadoCalc, conceptos: ConceptoCalc[], novedades: NovedadCalc[], d: DatosFinal): ResultadoCalc`.
  - Recibe `e.fechaEgreso = d.fechaEgreso`.
  - `diasTrabajados` son los días del mes.
- **Produces** `antiguedadDetalle(ingreso: Date, egreso: Date): { anios: number; meses: number; dias: number }` y `aniosIndemnizables(ingreso, egreso): number`. El año extra se suma si el egreso es posterior a `último aniversario + 3 meses`; el mínimo es 1.
- **Produces** `remuneracionMesCompleto(e: EmpleadoCalc, conceptos: ConceptoCalc[], anio: number, mes: number): Dec`: el remunerativo de `liquidarMes` sin egreso ni novedades.
- **Cambio en `descuentos`:** recibe el remunerativo y el no remunerativo de los días más el SAC. Los renglones 300 a 340 se agregan después y nunca entran en la base.

- [ ] **Step 1: Tests que fallan:**
  - `it('final del ejemplo')`:
    - `liquidarFinal` con despido sin causa al 2026-11-15, sin preaviso, mejor y mejor del semestre `1137465`, sin tope;
    - renglones `100 500000.00`, `110 25000.00`, `120 43732.50`, `200 426549.38`, `300 6824790.00`, `310 2274930.00`, `311 189577.50`, `320 568732.50`, `321 47394.38`, `330 835055.13`, `331 69587.93`, `500 109481.01`, `510 29858.46`, `520 29858.46`, `530 4976.41`, `540 19905.64`;
    - `totalRemunerativo '995281.88'`, `totalNoRemunerativo '10810067.44'`, `totalDescuentos '194079.98'`, `neto '11611269.34'`, `diasTrabajados 15`.
  - `it('tope y Vizzoti')`: tope 900000 → `300 5400000.00`; tope 500000 → `300 4572609.30`.
  - `it('renuncia y despido con causa')`: sin 300, 310, 311, 320 ni 321; neto `'1705844.96'` en ambos.
  - `it('mutuo acuerdo con gratificación')`: gratificación 1000000 → `340 1000000.00`, clase `NO_REMUNERATIVO`, descuentos iguales a los de la renuncia.
  - `it('despido con preaviso otorgado')`: sin 310, 311, 320 ni 321; con 300.
  - `it('bordes')` (Review Focus 3):
    - egreso 2026-11-30 sin preaviso → sin 320;
    - ingreso 2026-09-01 y egreso 2026-11-15 (2 meses y 14 días) → `aniosIndemnizables 1`, preaviso `mejor / 2`, vacaciones con 14 días × 76/365;
    - ingreso y egreso 2026-11-15 → `diasTrabajados 1`, `aniosIndemnizables 1`.
  - `it('fracción de 3 meses')`: ingreso 2021-03-01, egreso 2026-06-01 → `aniosIndemnizables 5`; egreso 2026-06-02 → `6`.
- [ ] **Step 2:** `npx jest src/sueldos/calculo` → FAIL.
- [ ] **Step 3:** Implementar:
  - el 200 reutiliza la regla de `liquidarSac` con los días del semestre hasta el egreso;
  - las vacaciones cuentan los días del año desde el 1/1 o el ingreso;
  - la base máxima de los descuentos es `baseMaxima × 1,5`.
- [ ] **Step 4:** PASS, con los casos de las Entregas 18 y 19 intactos.
- [ ] **Step 5:** Commit `feat(sueldos): cálculo de la liquidación final`.

### Task 2: Modelo, migración y topes indemnizatorios

**Files:**
- Modify `apps/api/prisma/schema.prisma`, la migración, `src/seed/plan-cuentas-modelo.ts` (`5.2.11 Indemnizaciones`), `src/sueldos/modelo.ts` (configuración con la cuenta), `src/prisma/modelos-empresa.ts`, `src/sueldos/contribuciones.service.ts` (configuración con `cuentaIndemnizacionesId` opcional) y `src/sueldos/maestros.{service,controller}.ts` (topes).
- Test `apps/api/test/sueldos-topes.e2e-spec.ts`.

**Interfaces:**
- **Schema:**
  - `enum TipoLiquidacion` suma `FINAL`; `enum CausaEgreso`;
  - modelos `EgresoEmpleado` y `TopeIndemnizatorio` (campos del spec §2);
  - `ConfiguracionSueldos.cuentaIndemnizacionesId String?`.
- **Migración:**
  - reemplaza el único `Liquidacion_empresaId_tipo_anio_mes_key` por un índice único parcial `WHERE "tipo" IN ('MENSUAL','SAC')`, en SQL a mano (Prisma no lo modela; se quita `@@unique` del schema y se agrega `@@index`);
  - cuenta `5.2.11` por empresa si está libre, y la configuración apunta a ella.
- **Produces** `MaestrosSueldosService.topeVigente(tx, convenioId, anio, mes): Promise<Dec | null>`.
- **Endpoints:**
  - `GET /api/sueldos/topes?convenioId` (`sueldos.ver`);
  - `PUT /api/sueldos/topes { convenioId, desdeAnio, desdeMes, importe }` (`sueldos.liquidar`, hace upsert).

- [ ] **Step 1: Tests que fallan:**
  - `it('topes por vigencia')`: PUT 900000 desde 07/2026 → `topeVigente(11/2026)` = 900000; `topeVigente(06/2026)` = null.
  - `it('configuración con indemnizaciones')`: empresa nueva → `GET configuracion` con `cuentaIndemnizaciones.codigo '5.2.11'`.
  - `it('dos finales en el mismo mes')`: con prisma se crean dos `Liquidacion` `FINAL` de 11/2026 sin error, y una segunda `MENSUAL` de 11/2026 falla por unicidad.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Migrate diff, SQL a mano, deploy y generate. Verificar la migración sobre una base con la demo, como en la Entrega 19.
- [ ] **Step 4:** PASS; `test/sueldos*` en verde.
- [ ] **Step 5:** Commit `feat(sueldos): modelo de egresos y topes indemnizatorios`.

### Task 3: Dar de baja y calcular la final

**Files:**
- Create `apps/api/src/sueldos/{egresos.service.ts,egresos.controller.ts}`.
- Modify `apps/api/src/sueldos/{liquidaciones.service.ts,maestros.service.ts,sueldos.module.ts}`.
- Test `apps/api/test/sueldos-egresos.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** `liquidarFinal`, `remuneracionMesCompleto` y `aniosIndemnizables` de Task 1; `topeVigente` de Task 2.
- **Produces** `EgresosService`:
  - `crear(d: { empleadoId; causa; fechaEgreso: string; preavisoOtorgado: boolean; mejorRemuneracion?: number | null; gratificacion?: number; fechaPago: string })`;
  - `modificar(liquidacionId, d)`;
  - `eliminar(liquidacionId)` (vía `DELETE /api/sueldos/liquidaciones/:id` para las `FINAL`).
- **Endpoints:**
  - `POST /api/sueldos/egresos`;
  - `PUT /api/sueldos/egresos/:liquidacionId`.
- **Cambios en `liquidaciones.service.ts`:**
  - `calcular` de una `FINAL`: un solo empleado; mejor remuneración según el spec §4 y §9.7; tope de su convenio; `liquidarFinal`.
  - `calcular` de una `MENSUAL`: excluye a quien tiene una `FINAL` con egreso en ese mes y borra su recibo aunque esté numerado.
  - `calcular` de un `SAC`: excluye a quien tiene una `FINAL` en el semestre.
  - `obtener`: agrega `egreso: { causa, fechaEgreso, preavisoOtorgado, mejorRemuneracion, gratificacion, empleado: { id, legajo, apellido, nombre } } | null` y el aviso de tope faltante.
  - `listar`: agrega `empleado` para las finales.
  - Las finales se pueden crear solo por `/egresos`: `POST /liquidaciones` con tipo `FINAL` da 400.
- **Cambio en `maestros.service.ts`:** `modificarEmpleado` rechaza el cambio de `fechaEgreso` si existe una final (§9.7).

- [ ] **Step 1: Tests que fallan:**
  - `it('dar de baja')`:
    - con la mensual de 11/2026 en borrador y el empleado con 4 h extra cargadas → POST egreso con despido sin causa al 2026-11-15, sin preaviso → 201;
    - la final tiene el recibo con `neto` correcto según los renglones del ejemplo más el 130 de horas extra: se verifica `300 '6824790.00'` y que las novedades pasaron (renglón 130 presente);
    - la mensual ya no tiene su recibo ni sus novedades;
    - el empleado queda con `fechaEgreso '2026-11-15'` y `activo false`.
  - `it('no se da de baja dos veces')` → 400 `El empleado ya tiene una liquidación final`.
  - `it('mensual cerrada posterior')` (Review Focus 1): cerrar la mensual de 11/2026 con el empleado; baja al 2026-10-20 → 400 `La liquidación mensual de 11/2026 ya incluye al empleado: reábrala antes de darlo de baja`, y no se crea nada.
  - `it('mensual reabierta')` (Review Focus 2): cerrar la mensual (recibo numerado), reabrirla, dar de baja al 2026-11-15, recalcular la mensual → sin recibo del empleado.
  - `it('eliminar la final')` (Review Focus 5): DELETE → el empleado queda activo y sin egreso, y el GET de la mensual en borrador lo vuelve a incluir.
  - `it('modificar el egreso')`:
    - PUT con `preavisoOtorgado: true` → sin 310 ni 320;
    - fecha 2026-12-01 → 400 `Para cambiar el mes del egreso, elimine la liquidación final y vuelva a darlo de baja`.
  - `it('mejor remuneración de un recibo cerrado')`: mensual de 10/2026 cerrada con 10 h extra al 50 % (remunerativo mayor que el mes completo de noviembre) → la base de 300 es ese remunerativo.
  - `it('tope del convenio')`: tope 900000 desde 07/2026 → `300 '5400000.00'`.
  - `it('fecha de egreso desde la ficha')`: PUT empleado con `fechaEgreso` y una final → 400 `La fecha de egreso se cambia desde la liquidación final`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS; `test/sueldos*` en verde.
- [ ] **Step 5:** Commit `feat(sueldos): dar de baja con liquidación final`.

### Task 4: Cierre, asiento, pagos, F.931 y recibo de la final

**Files:**
- Modify `apps/api/src/sueldos/{contabilizacion.service.ts,f931.service.ts,recibo-pdf.ts,salidas.controller.ts,calculo.ts (calcularContribuciones acepta 'FINAL')}`.
- Test `apps/api/test/sueldos-final-cierre.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** `EgresoEmpleado` y `ConfiguracionSueldos.cuentaIndemnizacionesId` (Task 2); finales calculadas (Task 3).
- **Produces** `calcularContribuciones(..., tipo: 'MENSUAL' | 'SAC' | 'FINAL', ..., sac?: Dec)`. `FINAL` lleva el fijo si hay días, y la detracción `días/30` más el 50 % si `sac > 0`, sin superar el remunerativo.
- **Asiento de la `FINAL`:**
  - fecha = egreso;
  - descripción `Liquidación final - Apellido, Nombre - <causa legible>`;
  - los renglones 300 a 340 van al debe de `cuentaIndemnizacionesId ?? cuentaSueldosId`;
  - el resto, como la mensual.
- **F.931:**
  - suma las finales cerradas del mes;
  - el 200 de la final va al campo 37;
  - el no remunerativo informado excluye 300 a 340;
  - regla §9.4.
- **Recibo y resumen:**
  - PDF con título `LIQUIDACIÓN FINAL`, `Causa: <causa>` y `Egreso: dd/mm/aaaa`;
  - período `Final MM/AAAA`.

- [ ] **Step 1: Tests que fallan:**
  - `it('cierre de la final')`:
    - baja del ejemplo, cerrar → asiento del 2026-11-15;
    - `5.2.11` debe `10810067.44`, `5.2.09` debe `995281.88`;
    - contribuciones SIPA sobre la base `995281.88 − (7003.68 × 15/30 + 7003.68/2)` = `988278.20`;
    - el asiento balancea.
  - `it('pago de la final')`: pagar desde banco → egreso de `11611269.34`.
  - `it('F.931 con la final')`:
    - sin mensual de 11/2026 → línea del empleado con campo 13 `'   995281,88'` y campo 37 `'   426549,38'`;
    - con una mensual de 11/2026 en borrador (otro empleado) → 400 `La liquidación mensual de 11/2026 no está cerrada` (Review Focus 4).
  - `it('recibo de la final')`: el texto del PDF contiene `LIQUIDACIÓN FINAL`, `Despido sin causa`, `15/11/2026` e `Indemnización por antigüedad`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. Correr la suite API completa (dos mitades con `--shard`, sin otras pruebas en paralelo).
- [ ] **Step 5:** Commit `feat(sueldos): cierre, asiento, pagos, F.931 y recibo de la liquidación final`.

### Task 5: Web

**Files:**
- Create `apps/web/src/sueldos/{DialogoBaja.tsx,final.test.tsx}`.
- Modify `apps/web/src/sueldos/{comun.ts,EmpleadosPage.tsx,LiquidacionPage.tsx,LiquidacionesPage.tsx,ConveniosPage.tsx,ContribucionesPage.tsx}`.

**Interfaces:**
- **Exportados para las pruebas:**
  - `DialogoBaja({ empleado, onConfirmar })`, donde `onConfirmar(d)` recibe el body de `POST /egresos`;
  - `TarjetaEgreso({ egreso })`.

- [ ] **Step 1: Tests que fallan:**
  - `DialogoBaja`:
    - con causa `DESPIDO_SIN_CAUSA` se ve "Preaviso otorgado" y no "Gratificación";
    - con `MUTUO_ACUERDO` se ve "Gratificación";
    - fecha de egreso `2026-11-15` → fecha de pago sugerida `2026-11-19`;
    - confirmar llama a `onConfirmar` con `{ empleadoId, causa, fechaEgreso: '2026-11-15', preavisoOtorgado: false, fechaPago: '2026-11-19' }`.
  - `TarjetaEgreso` → `Despido sin causa`, `15/11/2026` y `Sin preaviso`.
  - `periodoLiquidacion` de una final con empleado → `Final 11/2026 - Pérez, Juan`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar:
  - botón "Dar de baja" en la ficha (solo con `sueldos.liquidar` y empleado activo);
  - tarjeta del egreso editable en borrador;
  - tope indemnizatorio por vigencia en Convenios y escalas;
  - cuenta Indemnizaciones en Contribuciones.
- [ ] **Step 4:** PASS; suite web y build en verde.
- [ ] **Step 5:** Commit `feat(web): liquidación final`.

### Task 6: E2E y README

**Files:** Create `e2e/sueldos-final.spec.ts`; Modify `README.md`.

- [ ] **Step 1: Test** `test('sueldos: el contador da de baja a un empleado por despido sin causa, ve la indemnización, cierra y paga')`:
  - empleado nuevo (CUIL `20-30110222-5`) con escala en el mes actual;
  - "Dar de baja" con fecha de hoy;
  - se ve `Indemnización por antigüedad`;
  - cerrar;
  - pagar desde el banco de la demo.
- [ ] **Step 2:** Recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 18/18.
- [ ] **Step 3:** README, sección "Liquidación final (Entrega 20)".
- [ ] **Step 4:** Suites en verde.
- [ ] **Step 5:** Commit `test(e2e): liquidación final; docs: README entrega 20`.
