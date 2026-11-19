# Entrega 34 — Pulido de Ganancias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corregir los 6 menores diferidos de la E33.
**Architecture:** Cambios puntuales en `sicore.ts`, `f1359.service.ts`, `anual.service.ts`, `retencion.service.ts`, `maestros.service.ts` y `GananciasAnualPage.tsx`. Sin migraciones.
**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest.
**Spec:** `docs/superpowers/specs/2026-11-20-entrega-34-pulido-ganancias-design.md`

## Global Constraints
- Mensaje exacto: `Su final ya está cerrada: el saldo se retiene o devuelve fuera del sistema`.
- No correr jest y la e2e en paralelo.

## Review Focus
1. Anual reabierta y vuelta a cerrar después de una final de abril cerrada: el aviso sigue (Task 2).
2. Empleado distracto: nunca lleva el aviso (Task 2).
3. SICORE con tres liquidaciones el mismo día: siempre la de mayor número (Task 1).
4. Concepto exento pasado a DESCUENTO con rubro en el cuerpo: igual queda sin rubro (Task 1).
5. Aviso de ajuste sin concepto con un empleado sin filas y otro con saldo: sigue avisando (Task 1).

---

### Task 1: SICORE, F.1359, upsert, DESCUENTO y aviso agrupado

**Files:** `apps/api/src/impuestos/retenciones/sicore.ts`, `apps/api/src/sueldos/ganancias/f1359.service.ts`, `apps/api/src/sueldos/ganancias/anual.service.ts` (calcular), `apps/api/src/sueldos/maestros.service.ts`, `apps/api/src/sueldos/ganancias/retencion.service.ts` (`pendientesSinConcepto`).
**Tests:** `test/ganancias-sicore`, `test/ganancias-f1359`, `test/ganancias-anual`, `test/ganancias-ajuste`.

- [ ] **Step 1: Pruebas que fallan:**
  - sicore `'misma fecha de pago: la de mayor número'`: copia por prisma de la mensual con la misma `fechaPago` y `numero + 1` (como la prueba de neto por empleado) → la línea lleva `numero + 1` (pos. 13–28).
  - f1359 `'deducciones generales en cero'` (existente) se extiende: cambiar el CUIL del empleado después de cerrar la anual → el mensaje sigue nombrando `Apellido, Nombre`.
  - anual `'calcular simultáneo sin configuración de sueldos'`: borrar la fila de `ConfiguracionSueldos` de la empresa y `Promise.all` de dos `calcular` → `[201, 201]`.
  - anual `'pasar a descuento por API lo desmarca exento'`: concepto 900 exento con rubro; PUT con `clase: 'DESCUENTO'`, `destino: 'OTRO'`, sin `exentoGanancias` → `[200, false, null]`.
  - ajuste `'aviso sin concepto con varios empleados'`: escenario(1000000) más un segundo empleado sin filas, 561 desactivado → el detalle avisa.
- [ ] **Step 2:** FAIL (la del aviso puede pasar: es cobertura del agrupado).
- [ ] **Step 3:** implementar según la spec (1–5).
- [ ] **Step 4:** `npx jest --runInBand test/ganancias test/impuestos-retenciones` → PASS.
- [ ] **Step 5:** commit `fix(ganancias): pulido de la E33 (SICORE, F.1359, anual, conceptos, aviso)`.

### Task 2: Aviso de final cerrada en la anual (API y web)

**Files:** `apps/api/src/sueldos/ganancias/anual.service.ts` (`ver`), `apps/web/src/sueldos/GananciasAnualPage.tsx`.
**Tests:** `test/ganancias-anual`, `apps/web/src/sueldos/ganancias-anual.test.tsx`.

**Interfaces:** `ver()` agrega a cada empleado `aviso: string | null`; `FilaAnualGanancias.aviso?: string | null` en la web.

- [ ] **Step 1: Pruebas que fallan:**
  - API `'final de abril cerrada: aviso en la anual'`: escenario con un empleado extra; egreso `2026-03-20`, `fechaPago 2026-04-05` (reloj en esa fecha), cerrar la final; con el reloj en 2026-11-06, `calcular` → la fila de ese empleado tiene el aviso exacto; la de `x.e` tiene `aviso: null`.
  - Web: `TablaAnualGanancias` con una fila con `aviso` → se ve el texto del aviso.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** en `ver`, una consulta de finales cerradas con `fechaPago` en el año siguiente para los empleados no distracto; aviso si la anual no está cerrada o `cerradoEn >= fechaPago`. En la web, el aviso va debajo del nombre en texto chico color naranja.
- [ ] **Step 4:** `npx jest --runInBand test/ganancias-anual`; `cd apps/web && npx vitest run && pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(ganancias): aviso de final ya cerrada en la anual`.

Al final: suite completa de la API, web y e2e sola; revisión final.
