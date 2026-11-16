# Entrega 21: vacaciones. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar períodos de vacaciones por empleado, llevar el saldo por año, pagarlas en la mensual del mes de inicio (renglones 150 y 151) y descontar lo tomado en la liquidación final.

**Architecture:**
- **Cálculo:** funciones puras en `apps/api/src/sueldos/calculo.ts`.
- **Servicio nuevo:** `vacaciones.service.ts` (saldos, períodos, validaciones y recálculo de borradores).
- **Liquidaciones:** `liquidaciones.service.ts` pasa los períodos del mes a `liquidarMes` y `liquidarFinal`.
- **F.931:** informa el campo 40.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-entrega-21-vacaciones-design.md` (§11 es vinculante).

## Global Constraints

- **Mensajes:** los mensajes exactos del spec (§2, §4, §11).
- **Redondeo:** half-up a 2 decimales por renglón.
- **Días:** corridos.
- **Pruebas:**
  - reloj congelado en 2026-11-06;
  - `prepararSueldos` da Vendedor B, ingreso 2021-03-01, afiliado y obra social `125000`.
- **Migración:** `apps/api/prisma/migrations/20261120090000_vacaciones/migration.sql`.
  - Se aplica a `gestion` y a `gestion_test`.
  - No debe borrar el índice parcial `Liquidacion_mensual_sac_unica`: si `migrate diff` lo propone, se quita a mano.

## Review Focus

1. **Período de enero 2027 cargado con la mensual de noviembre 2026 en borrador** → la mensual de noviembre no lo incluye y la de enero sí. Prueba en Task 3.
2. **Dos períodos del mismo empleado en el mismo mes** → dos pares de renglones 150 y 151, y el F.931 suma ambos. Prueba en Task 1 (cálculo) y Task 3 (F.931).
3. **Mensual reabierta con un período pagado y luego eliminado** → al recalcular desaparecen los renglones 150 y 151. Prueba en Task 3.
4. **Concepto 150 inactivo** → la mensual no liquida vacaciones y el saldo igual las cuenta como tomadas. Prueba en Task 3.
5. **Empleado con egreso cargado y período que termina después** → 400 con el mensaje de §11.1. Prueba en Task 3.

---

### Task 1: Cálculo

**Files:** Modify `apps/api/src/sueldos/calculo.ts`, `apps/api/src/sueldos/calculo.spec.ts`.

**Interfaces:**
- **`diasVacacionesCorresponden`:** `diasVacacionesCorresponden(ingreso: Date, egreso: Date | null, anio: number): number`, según el spec §3.
- **`liquidarMes`:**
  - recibe un parámetro final opcional `vacaciones: { periodoId: string; dias: number }[] = []`;
  - si `conceptos` incluye los de tipo `VACACIONES` (código 150 con `parametros.divisor` 25 y 151 con divisor 30, ambos `REMUNERATIVO`), agrega un renglón de cada uno por período, con `conceptoId` del concepto, cantidad = días e importe `(básico + antigüedad del mes completo) / divisor × días` (el 151, negativo);
  - `RenglonCalc` suma `vacacionPeriodoId?: string`.
- **`DatosFinal`:** suma `diasVacacionesPendientesAnteriores?: number`, `diasVacacionesTomadosAnio?: number`, `saldoInicialAnio?: number | null` y `vacaciones?: { periodoId; dias }[]` (las que empiezan en el mes del egreso, ya recortadas al egreso). Fórmula del 330 según el spec §6.
- **`ConceptoCalc['tipo']`:** suma `'VACACIONES'`. `validarConcepto` lo admite solo con clase `REMUNERATIVO` y `parametros.divisor` numérico > 0.

- [ ] **Step 1: Tests que fallan:**
  - `it('vacaciones en la mensual')`:
    - con los conceptos de Comercio más `150` y `151`, 14 días en 11/2026;
    - renglones `150 588000.00` y `151 -490000.00`; el resto como en la Entrega 18 (`120 87465.00`);
    - `totalRemunerativo '1235465.00'`, `totalDescuentos '240915.68'`, `neto '994549.32'`.
  - `it('dos períodos en el mes')`: 5 y 9 días → dos 150 (`210000.00`, `378000.00`) y dos 151.
  - `it('sin conceptos de vacaciones no liquida')`: los conceptos de Comercio sin 150/151 y un período → sin renglones 150/151.
  - `it('días que corresponden')`:
    - ingreso 2021-03-01: años 2025 → 14, 2026 → 21;
    - ingreso 2016-01-01, 2026 → 28;
    - ingreso 2000-01-01, 2026 → 35;
    - ingreso 2026-09-01, 2026 → 6;
    - ingreso 2027-01-10, 2026 → 0;
    - ingreso 2021-03-01 con egreso 2026-03-31, 2026 → `floor(90/20)` = 4.
  - `it('final con vacaciones tomadas')`:
    - el ejemplo de la Entrega 20 con `diasVacacionesTomadosAnio: 14` → `330 '198074.73'`, `331 '16506.23'`;
    - sin datos → `330 '835055.13'`;
    - con `diasVacacionesPendientesAnteriores: 10` → 330 = `1137465/25 × (21 × 319/365 + 10)` redondeado.
  - `it('validar concepto de vacaciones')`: `validarConcepto('VACACIONES', 'REMUNERATIVO', { divisor: 25 })` → null; con clase `DESCUENTO` → `El cálculo Vacaciones no admite la clase Descuento`.
- [ ] **Step 2:** `npx jest src/sueldos/calculo` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS, con los casos anteriores intactos.
- [ ] **Step 5:** Commit `feat(sueldos): cálculo de vacaciones`.

### Task 2: Modelo y migración

**Files:**
- Modify `apps/api/prisma/schema.prisma`, la migración, `src/sueldos/modelo.ts` (conceptos 150/151 y `anioInicioVacaciones` = año actual), `src/prisma/modelos-empresa.ts` y `src/sueldos/dto.ts` (tipo `VACACIONES`).
- Test `apps/api/test/sueldos-vacaciones-modelo.e2e-spec.ts`.

**Interfaces:**
- **Schema:**
  - `enum TipoConcepto` suma `VACACIONES`;
  - modelos `VacacionPeriodo` (con `liquidadoAfuera Boolean @default(false)`) y `VacacionSaldoInicial` (spec §2, §11);
  - `ReciboSueldoRenglon.vacacionPeriodoId String? @db.Uuid`;
  - `ConfiguracionSueldos.anioInicioVacaciones Int @default(2026)`.
- **Migración:**
  - conceptos `150 Vacaciones` (`VACACIONES`, `REMUNERATIVO`, `{ "divisor": 25 }`, orden 150) y `151 Descuento días de vacaciones` (`{ "divisor": 30 }`, orden 151) en cada empresa con el convenio de Comercio, si el código está libre;
  - `anioInicioVacaciones` = 2026 en las configuraciones existentes.

- [ ] **Step 1: Tests que fallan:**
  - `it('empresa nueva trae conceptos de vacaciones')`: GET conceptos → `150` y `151` de tipo `VACACIONES`; la configuración tiene `anioInicioVacaciones` 2026 (el año del reloj).
  - `it('concepto de vacaciones inválido')`: POST concepto `VACACIONES` con clase `DESCUENTO` → 400.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Migrate diff (revisar el índice parcial), deploy y generate. Verificar la migración sobre una base con la demo.
- [ ] **Step 4:** PASS; `test/sueldos*` en verde.
- [ ] **Step 5:** Commit `feat(sueldos): modelo de vacaciones`.

### Task 3: Saldos, períodos y liquidación

**Files:**
- Create `apps/api/src/sueldos/{vacaciones.service.ts,vacaciones.controller.ts}`.
- Modify `apps/api/src/sueldos/{liquidaciones.service.ts,egresos.service.ts,f931.service.ts,sueldos.module.ts}`.
- Test `apps/api/test/sueldos-vacaciones.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** Task 1 y Task 2.
- **Produces** `VacacionesService`:
  - `saldos(anio)`;
  - `delEmpleado(empleadoId)`;
  - `crear(d)`, `modificar(id, d)` y `eliminar(id)`, que responden `{ id, avisos }` o `{ ok }`;
  - `saldoInicial(d)`;
  - `saldoAnio(tx, empleadoId, anio): Promise<{ corresponden; tomados; pendientes }>`, que usa la Entrega 20 para la final.
- **Endpoints:** los del spec §3 y §4.
- **Cambios en `liquidaciones.service.ts`:**
  - **`calcular` de una mensual:** los períodos del empleado con `desde` en el mes y `liquidadoAfuera = false` se pasan a `liquidarMes`. El renglón se graba con `vacacionPeriodoId`.
  - **`calcular` de una final:** los períodos que empiezan en el mes del egreso, con los días recortados al egreso; los pendientes de los años anteriores (desde `anioInicioVacaciones` o con saldo inicial, nunca negativos); los tomados y el saldo inicial del año del egreso.
  - **`mejoresRemuneraciones`:** para la mejor del último año, resta de cada recibo la suma de sus renglones 150 y 151 (§11.3).
- **Cambio en `egresos.service.ts`:** rechaza la baja si hay períodos que empiezan después del egreso (§11.1).
- **Cambio en el F.931:** el campo 40 suma los 150; los 151 entran en `sueldoAdicionales` (son de tipo `VACACIONES`: se agregan a la lista de tipos de sueldo solo para el 151).

- [ ] **Step 1: Tests que fallan:**
  - `it('alta con avisos y saldo')`:
    - período 2026 del 09/11 al 22/11 → 201 con `avisos: []`;
    - GET saldos 2026 → `{ corresponden: 21, tomados: 14, pendientes: 7 }`;
    - un segundo período 2026 de 10 días en diciembre → aviso `Supera el saldo de 2026 (quedan 7 días)`;
    - uno en junio 2027 para 2026 → aviso `Comienza fuera del período legal (1/10 al 30/4)`.
  - `it('validaciones')`:
    - superposición → 400 `El período se superpone con otro del empleado (09/11/2026 al 22/11/2026)`;
    - desde antes del ingreso → 400;
    - empleado con egreso 2026-11-15 y período hasta 2026-11-20 → 400 `El período termina después del egreso del empleado (15/11/2026)` (Review Focus 5).
  - `it('la mensual paga las vacaciones')`:
    - mensual de 11/2026 en borrador, alta del período → GET con `150 '588000.00'`, `151 '-490000.00'` y `neto '994549.32'`;
    - cerrar → GET saldos con `liquidado: true`;
    - PUT del período → 400 `El período ya se pagó en la liquidación mensual de 11/2026: reábrala para modificarlo`;
    - reabrir → PUT 200.
  - `it('período de otro mes')` (Review Focus 1): período de enero 2027 → la mensual de 11/2026 sin 150.
  - `it('período eliminado tras reabrir')` (Review Focus 3): cerrar con el período, reabrir, DELETE, recalcular → sin 150/151.
  - `it('concepto inactivo')` (Review Focus 4): con el 150 inactivo → sin renglones y saldo `tomados: 14`.
  - `it('mes cerrado')`:
    - con la mensual de 10/2026 cerrada, período de octubre → 400 `La liquidación mensual de 10/2026 ya está cerrada: marque el período como liquidado fuera del sistema o reabra la liquidación`;
    - con `liquidadoAfuera: true` → 201 y cuenta como tomado.
  - `it('saldo inicial')`: PUT saldo inicial 2025 = 10 → saldos 2025 `corresponden 10`; con `anioInicioVacaciones` 2026, 2024 → 0.
  - `it('final descuenta lo tomado')`:
    - período del 01/10 al 14/10 marcado `liquidadoAfuera`;
    - baja por despido sin causa el 2026-11-15 → `330 '198074.73'`;
    - con un período del 20/11 → la baja da 400 `El empleado tiene vacaciones registradas después del egreso: modifíquelas antes de darlo de baja`.
  - `it('mejor remuneración sin vacaciones')`: mensual de 10/2026 cerrada con un período de 14 días → la base del 300 en una baja de noviembre es el remunerativo de octubre menos (150 + 151).
  - `it('F.931 con vacaciones')` (Review Focus 2): dos períodos en noviembre, cerrar → campo 40 = suma de los dos 150; el total de remuneración igual al remunerativo.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. Correr la suite API completa (dos mitades con `--shard`, sin otras pruebas en paralelo).
- [ ] **Step 5:** Commit `feat(sueldos): períodos y saldo de vacaciones, y su liquidación`.

### Task 4: Web

**Files:**
- Create `apps/web/src/sueldos/{VacacionesPage.tsx,vacaciones.test.tsx}`.
- Modify `apps/web/src/sueldos/{comun.ts,EmpleadosPage.tsx}`, `apps/web/src/layout/menu.ts` ("Vacaciones" en Sueldos) y `apps/web/src/paginas/rutas.tsx` (`/sueldos/vacaciones`).

**Interfaces:** exportados para las pruebas:
- `TablaSaldosVacaciones({ filas, onElegir })`;
- `DialogoPeriodo({ empleado, anio, onGuardar, avisos })`, donde `onGuardar` recibe `{ empleadoId, anio, desde, hasta, liquidadoAfuera }`.

- [ ] **Step 1: Tests que fallan:**
  - `TablaSaldosVacaciones`: una fila con pendientes `-3` se muestra en rojo (`data-negativo="true"`); otra con `7`, normal.
  - `DialogoPeriodo`: desde `2026-11-09` y hasta `2026-11-22` → muestra `14 días`, y guardar llama a `onGuardar` con los datos.
  - `DialogoPeriodo` con `avisos={['Supera el saldo de 2026 (quedan 7 días)']}` → se ve el aviso.
  - Menú: con `sueldos.ver` aparece "Vacaciones".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar:
  - página con selector de año, tabla, saldo inicial editable y períodos del empleado (alta, edición y borrado deshabilitados si están liquidados);
  - pestaña "Vacaciones" en la ficha del empleado.
- [ ] **Step 4:** PASS; suite web y build en verde.
- [ ] **Step 5:** Commit `feat(web): vacaciones`.

### Task 5: E2E y README

**Files:** Create `e2e/sueldos-vacaciones.spec.ts`; Modify `README.md` y `e2e/playwright.config.ts` si hace falta ordenar.

- [ ] **Step 1: Test** `test('sueldos: el contador registra vacaciones, ve el saldo y la mensual con el renglón de vacaciones')`:
  - empleado nuevo (CUIL libre entre los de la demo y las pruebas, por ejemplo `27-30111222-3` validado con `validarCuit`);
  - período de 14 días en el mes siguiente (la mensual del mes actual la cierra otra prueba);
  - saldo `7` pendientes si tiene 5 años o más; si no, según la banda;
  - mensual del mes siguiente en borrador con `Vacaciones`.
  - Si choca con la mensual del mes siguiente que crea `sueldos-pagos.spec.ts`, correr en el proyecto `sueldos-final` o en uno propio posterior.
- [ ] **Step 2:** Recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 19/19.
- [ ] **Step 3:** README, sección "Vacaciones (Entrega 21)".
- [ ] **Step 4:** Suites en verde.
- [ ] **Step 5:** Commit `test(e2e): vacaciones; docs: README entrega 21`.
