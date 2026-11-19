# Entrega 33 — Pulido de Ganancias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los 9 menores diferidos de la revisión de la E32.

**Architecture:** Cambios puntuales sobre el código de Ganancias de la E32 (`apps/api/src/sueldos/ganancias`, `liquidaciones.service.ts`, `maestros.service.ts`, `impuestos/retenciones/sicore.ts`) y una línea en `apps/web/src/sueldos/ConceptosPage.tsx`. Sin migraciones.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest/supertest; React 19 + Mantine 7 + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-entrega-33-pulido-ganancias-design.md`

## Global Constraints

- Mensajes exactos de la spec:
  - `Hay saldos de la liquidación anual de Ganancias sin aplicar: active un concepto de ajuste anual de Ganancias`
  - `El F.1359 no admite deducciones generales en cero (sin aportes): <Apellido, Nombre>, …` (nombres `Apellido, Nombre` separados por `, `).
- Reloj de pruebas congelado en 2026-11-06T15:00:00Z; `jest.setSystemTime` se restaura en `afterEach`.
- Liquidaciones de 2025 en pruebas necesitan `crearEjercicio(tx, empresaId, 2025-01-01, 0)`.
- No correr jest y la e2e en paralelo (comparten el extracto demo).

## Review Focus

1. Dos liquidaciones en borrador con el mismo ajuste pendiente y un concepto de ajuste nuevo creado entre ellas: no se retiene dos veces (prueba en Task 1).
2. SAC (tipo SAC) con anual cerrada: no lleva renglón 561 (prueba en Task 1).
3. Empleado con egreso en marzo y final pagada en abril, anual cerrada antes del pago: el ajuste aparece en la final (prueba en Task 1).
4. Empleado con dos liquidaciones en el mes del SICORE (devolución en una, retención en otra): una sola línea con el neto (prueba en Task 3).
5. Concepto exento editado por API sin `exentoGanancias`: el rubro se conserva (prueba en Task 4).

---

### Task 1: Ajuste anual — conteo, aviso, tipos y egresos de enero a marzo

**Files:**
- Modify: `apps/api/src/sueldos/ganancias/retencion.service.ts` (`ajustes`), `apps/api/src/sueldos/ganancias/anual.service.ts` (`recalcular`), `apps/api/src/sueldos/liquidaciones.service.ts` (~166–237)
- Test: `apps/api/test/ganancias-ajuste.e2e-spec.ts`, `apps/api/test/ganancias-anual.e2e-spec.ts`

**Interfaces:**
- Consumes: `RetencionGananciasService.ajustes(tx, l, empleadoId, r, concepto, conceptoGanancias)`, `esDistracto(tx, l, empleadoId)` (E32).
- Produces: `RetencionGananciasService.pendientesSinConcepto(tx, empleadoIds: string[], fechaPago: Date): Promise<boolean>`.

- [ ] **Step 1: Pruebas que fallan** (en `ganancias-ajuste`, usando el `escenario` existente):
  - `'lo aplicado con otro concepto de ajuste cuenta'`: escenario(1000000); cerrar nov 2026 (aplica 1.000.000); desactivar el 561 y crear `{codigo:'562', nombre:'Ajuste anual bis', clase:'DESCUENTO', tipo:'GANANCIAS_AJUSTE', parametros:{}, orden:562}`; la mensual de dic 2026 no tiene renglón 562 ni 561.
  - `'aviso sin concepto de ajuste activo'`: escenario(1000000); desactivar el 561; `POST /api/sueldos/liquidaciones` nov 2026 → `body.aviso` contiene `Hay saldos de la liquidación anual de Ganancias sin aplicar: active un concepto de ajuste anual de Ganancias`.
  - `'el SAC no lleva ajuste'`: escenario(1000000); crear `SAC` 2026 mes 12 → sin renglón 561.
  - En `ganancias-anual`: `'egreso de marzo con la final en abril entra en la anual'`: escenario; tercer empleado con egreso `2026-03-20` y `fechaPago` `2026-04-05` (con `jest.setSystemTime` en 2026-04-05); con el reloj en 2026-11-06, `calcular` 2025 → incluye a ese empleado; el de `fechaEgreso 2026-02-15, fechaPago 2026-02-20` con su final cerrada (distracto) no.
- [ ] **Step 2:** `cd apps/api && npx jest --runInBand test/ganancias-ajuste test/ganancias-anual` → las 4 nuevas FAIL.
- [ ] **Step 3: Implementar.**
  - `aplicado` en `ajustes`: sin `conceptoId`.
  - `ajustes` sale sin hacer nada si `l.tipo` no es `MENSUAL` ni `FINAL`.
  - `pendientesSinConcepto`: true si algún empleado tiene una fila de anual cerrada (`cerradoEn < fechaPago`, no distracto) con saldo − aplicado ≠ 0. En `liquidaciones.service`, cuando no hay `conceptoAjuste` activo y `conceptoGanancias` existe, se agrega el mensaje a `avisos`.
  - `recalcular` (anual): excluir egresos `>= 1/1/anio && <= 31/12/anio`, y de los egresos `1/1–31/3/anio+1` solo a quienes tienen fila `distracto: true` en esa anual.
- [ ] **Step 4:** mismo comando → todo PASS.
- [ ] **Step 5:** commit `fix(ganancias): ajuste anual — conteo por año, aviso, solo mensual y final, egresos de marzo`.

### Task 2: Anual con lock y F.1359 sin deducciones generales

**Files:**
- Modify: `apps/api/src/sueldos/ganancias/anual.service.ts`, `apps/api/src/sueldos/ganancias/f1359.service.ts`
- Test: `apps/api/test/ganancias-anual.e2e-spec.ts`, `apps/api/test/ganancias-f1359.e2e-spec.ts`

**Interfaces:**
- Produces: `AnualGananciasService.bloquear(tx)` (privado) — `SELECT id FROM "ConfiguracionSueldos" WHERE "empresaId" = $1::uuid FOR UPDATE`, igual que `liquidaciones.service`.

- [ ] **Step 1: Pruebas que fallan:**
  - `ganancias-anual` `'calcular simultáneo no da error'`: `Promise.all([calcular(), calcular()])` → los dos status 201.
  - `ganancias-f1359` `'deducciones generales en cero'`: escenario; un concepto NO_REMUNERATIVO FIJO 500000 y las escalas en 0 para que el empleado no tenga aportes (o poner aportes en 0 por prisma en sus renglones de clase DESCUENTO de destino SEGURIDAD_SOCIAL/OBRA_SOCIAL/SINDICAL antes de calcular); anual; `GET …/f1359/anual/2025` → `[400, 'El F.1359 no admite deducciones generales en cero (sin aportes): <apellido>, <nombre>']` con el empleado de la prueba.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `calcular`, `cerrar` y `reabrir` llaman `bloquear(tx)` al empezar; el encabezado se crea con `upsert`. En `F1359Service`, antes de armar el archivo, juntar los empleados con `r05.total === '0.00'` y lanzar el 400 con sus nombres ordenados por legajo.
- [ ] **Step 4:** `npx jest --runInBand test/ganancias-anual test/ganancias-f1359` → PASS.
- [ ] **Step 5:** commit `fix(ganancias): lock en la anual y F.1359 sin deducciones generales`.

### Task 3: SAC por cuota y SICORE por empleado

**Files:**
- Modify: `apps/api/src/sueldos/ganancias/acumulado.ts` (`sumar`), `apps/api/src/impuestos/retenciones/sicore.ts`
- Test: `apps/api/test/ganancias-f1359.e2e-spec.ts`, `apps/api/test/ganancias-sicore.e2e-spec.ts`

- [ ] **Step 1: Pruebas que fallan:**
  - `ganancias-f1359` `'SAC de la final en la cuota'`: final de 2026 con egreso 2026-11-03 (DESPIDO_SIN_CAUSA, sin preaviso) cerrada; en el F.1359 final, registro 03: «SAC segunda cuota» (pos. 59–73) = suma de los renglones 201, 311, 321 y 331 del recibo (> 0).
  - `ganancias-sicore` `'una línea por empleado'`: dos liquidaciones cerradas del mismo empleado en el período, con renglón 560 de 100000 en una y de −30000 en la otra (insertados por prisma como en las pruebas existentes) → una sola línea de empleado con importe de retención 70000.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** en `sumar`, los renglones sin concepto con código en `['200','201','311','321','331']` van a `sac1`/`sac2` por mes de pago. En `sicore`, agrupar por `recibo.cuil`; fecha y número: los de la liquidación de mayor `fechaPago`; importe y base: suma de brutos.
- [ ] **Step 4:** `npx jest --runInBand test/ganancias-f1359 test/ganancias-sicore test/impuestos-retenciones` → PASS.
- [ ] **Step 5:** commit `fix(ganancias): SAC por cuota y SICORE neto por empleado`.

### Task 4: Rubro exento (API y web)

**Files:**
- Modify: `apps/api/src/sueldos/maestros.service.ts` (~229), `apps/web/src/sueldos/ConceptosPage.tsx`
- Test: `apps/api/test/ganancias-anual.e2e-spec.ts`, `apps/web/src/sueldos/ganancias-anual.test.tsx`

**Interfaces:**
- Produces (web): `cambiarClase(f: Form, clase: Clase): Form` exportada de `ConceptosPage.tsx` — con `clase === 'DESCUENTO'` devuelve `exentoGanancias: false, rubroExentoGanancias: null`.

- [ ] **Step 1: Pruebas que fallan:**
  - API `'editar sin exentoGanancias conserva el rubro'`: crear el concepto 900 exento con `CURSOS_SEMINARIOS`; `PUT` con `{ nombre: 'Viático 2' }` → `rubroExentoGanancias === 'CURSOS_SEMINARIOS'`.
  - Web `'pasar a descuento desmarca exento'`: `cambiarClase({ …, exentoGanancias: true, rubroExentoGanancias: null }, 'DESCUENTO')` → `exentoGanancias: false`, `rubroExentoGanancias: null`, y `faltaRubroExento` del resultado es false.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** en `maestros.service`, `const exento = d.exentoGanancias ?? actual.exentoGanancias` para decidir el rubro (y en la validación). En la web, el `onChange` de la clase usa `cambiarClase`.
- [ ] **Step 4:** `cd apps/api && npx jest --runInBand test/ganancias-anual test/sueldos-maestros`; `cd apps/web && npx vitest run && pnpm build` → PASS.
- [ ] **Step 5:** commit `fix(sueldos): rubro exento al editar y al pasar a descuento`.

Al final: suite completa de la API (dos shards), web y e2e sola en base nueva.
