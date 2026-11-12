# Entrega 16 — Presupuesto contra real Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presupuestos mensuales por cuenta de resultados y centro de costo (con versiones y uno vigente), carga asistida (repartir, real del año anterior, Excel) y comparación contra el Mayor con desvíos, en un informe y en el tablero.

**Architecture:** Módulo `apps/api/src/presupuestos/` con `calculo.ts` (repartir, emparejar presupuesto y real, agrupar — puro), `presupuestos.service.ts` (CRUD, grilla, líneas, copiar, vigente), `carga.service.ts` (repartir, desde-real, importar/exportar), `comparacion.service.ts` (real desde `AsientoRenglon` + cálculo). El tablero de la Entrega 13 consume la comparación del vigente.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, ExcelJS, Jest/supertest, React 19 + Mantine 7 + `@mantine/charts`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-entrega-16-presupuesto-design.md`

## Global Constraints

- `Presupuesto` y `PresupuestoImporte` en `MODELOS_DE_EMPRESA`; todo acceso por `TenantPrisma`.
- Importes `Decimal(18,2)`, en texto con 2 decimales; signo natural (positivo).
- Real: tipos de asiento `REFUNDICION`, `CIERRE`, `APERTURA` excluidos y `origenTipo = 'AJUSTE_INFLACION'` excluido; RP = haber − debe, RN = debe − haber.
- Permisos `presupuesto.ver: 'Ver presupuestos'`, `presupuesto.editar: 'Editar presupuestos'` (demo: Administrador y Contador).
- Mensajes exactos del spec (§2, §3).
- Reloj de pruebas 2026-11-06; las sesiones con plan tienen el ejercicio 1 = 2026.

## Review Focus

1. **Dos líneas de la misma cuenta, una con centro y otra sin** → cada una compara con su real; agrupar por cuenta las suma sin duplicar el real. Prueba en Task 3.
2. **Importar un archivo con una fila mala entre filas buenas** → no graba nada y devuelve todas las líneas con error. Prueba en Task 2.
3. **Marcar vigente con otro vigente en el mismo ejercicio / en otro ejercicio** → queda uno solo por ejercicio; el del otro ejercicio no cambia. Prueba en Task 1.
4. **Rango que excede el ejercicio o `desde > hasta`** → 400 con mensaje; tablero con período fuera del ejercicio → tarjeta null sin error. Prueba en Task 3 y Task 4.
5. **Cuenta de gastos con saldo acreedor en el año anterior** → al traer el real queda 0, no negativo. Prueba en Task 2.

---

### Task 1: Modelo, permisos, CRUD y grilla

**Files:**
- Modify: `apps/api/prisma/schema.prisma`; Create migración `apps/api/prisma/migrations/20261115090000_presupuestos/migration.sql` (incluye `CREATE UNIQUE INDEX "PresupuestoImporte_linea_mes" ON "PresupuestoImporte" ("presupuestoId", "cuentaContableId", COALESCE("centroCostoId", '00000000-0000-0000-0000-000000000000'::uuid), "anio", "mes")`)
- Modify: `packages/shared/src/permisos.ts`, `apps/api/src/seed/demo.ts`, `apps/api/src/prisma/modelos-empresa.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/presupuestos/{presupuestos.module.ts,presupuestos.service.ts,presupuestos.controller.ts,dto.ts}`
- Test: `apps/api/test/presupuestos-crud.e2e-spec.ts`, helper `apps/api/test/helpers-presupuestos.ts`

**Interfaces — Produces:**
- Endpoints de spec §3: lista, crear (con `copiarDeId`), modificar, vigente, eliminar, grilla, `PUT/DELETE lineas`.
- `PresupuestosService.validarLinea(tx, presupuesto, cuentaContableId, centroCostoId | null)` y `mesesDelEjercicio(ejercicio): string[]` ('AAAA-MM') exportada.
- `helpers-presupuestos.ts`: `prepararPresupuestos(app, prisma)` → sesión con plan + centros `ROS` (Rosario) y `COR` (Córdoba) + `{ ejercicio, crear(nombre, extra?), linea(id, codigo, importes, centro?), asiento(fecha, renglones: [codigo, debe, haber, centro?][]) }` (asiento manual por API).

- [ ] **Step 1: Tests que fallan:**
  - `it('crea, edita líneas y arma la grilla')`: crear "Original 2026"; `PUT lineas` 4.1.01 `{ '2026-11': 1000000 }`, 5.2.01 `{ '2026-11': 200000 }`, 5.2.01 ROS `{ '2026-11': 100000 }` → grilla con 12 `meses` (`2026-01`…`2026-12`), 3 líneas ordenadas (4.1.01, 5.2.01 sin centro, 5.2.01 ROS), `totales.ingresos '1000000.00'`, `egresos '300000.00'`, `resultado '700000.00'`; línea toda en 0 → desaparece.
  - `it('valida líneas')`: cuenta 1.1.01.001 → `La cuenta 1.1.01.001 no es de resultados`; mes `2027-01` → `El mes 01/2027 no pertenece al ejercicio`; importe negativo → 400.
  - `it('vigente único y copiar')` (Review Focus 3): A vigente, B vigente → A deja de serlo; presupuesto de otro ejercicio (crear ejercicio 2 por API de ejercicios) vigente sigue; copiar A → C con los mismos importes; eliminar el vigente → `Marque otro presupuesto como vigente antes de eliminarlo`; nombre repetido en el ejercicio → 400.
  - `it('permisos')`: `presupuesto.ver` lista pero no crea (403).
- [ ] **Step 2:** FAIL. **Step 3:** implementar (migración con `prisma migrate diff` + índice único manual; deploy en `gestion` y `gestion_test`; rebuild de `packages/shared`). **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(presupuestos): modelo, versiones y grilla`.

### Task 2: Carga asistida e Excel

**Files:**
- Create: `apps/api/src/presupuestos/calculo.ts` (+ `calculo.spec.ts`), `apps/api/src/presupuestos/carga.service.ts`
- Modify: `presupuestos.controller.ts`
- Test: `apps/api/test/presupuestos-carga.e2e-spec.ts`

**Interfaces — Produces:** `repartir(total: Dec, meses: string[]): Record<string, Dec>`; endpoints `POST lineas/repartir`, `POST desde-real { ajustePct }`, `GET exportar`, `POST importar`.

- [ ] **Step 1: Tests que fallan:**
  - `calculo.spec.ts`: `repartir(120000, 12 meses)` → todos `10000.00`; `repartir(100000, 12)` → 11 × `8333.33` y el último `8333.37`.
  - `it('repartir un total anual')`: 4.1.01 total 120.000 → grilla con `10000.00` en cada mes.
  - `it('traer el real del ejercicio anterior')` (Review Focus 5): ejercicio 2025 creado y con asientos (insertar con prisma: ventas 4.1.01 50.000 en 2025-03; 5.2.01 sin centro 10.000 en 2025-03; 5.2.04 con saldo acreedor 500 en 2025-03) → `desde-real { ajustePct: 30 }` sobre el presupuesto 2026 → 4.1.01 `2026-03` `65000.00`, 5.2.01 `13000.00`, 5.2.04 sin línea (0); sin ejercicio anterior → `No hay un ejercicio anterior`.
  - `it('exporta e importa')`: exportar → xlsx con encabezados `Cuenta`, `Centro de costo`, `01/2026`…`12/2026`, `Total`; importar ese mismo archivo en otro presupuesto → misma grilla.
  - `it('importar con errores no graba nada')` (Review Focus 2): CSV con filas `4.1.01;;1000…`, `9.9.99;;…`, `1.1.01.001;;…`, `5.2.01;XX;…`, `4.1.01;;…` (repetida) → 400 con `errores` de las líneas 3, 4, 5 y 6 con los mensajes del spec; la grilla sigue vacía.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (lectura xlsx/csv como `apps/api/src/ventas/precios/importacion.ts`, números con `numeroAR`). **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(presupuestos): repartir, real del año anterior e importación`.

### Task 3: Presupuesto contra real

**Files:**
- Modify: `apps/api/src/presupuestos/calculo.ts` (comparar y agrupar), `presupuestos.controller.ts`
- Create: `apps/api/src/presupuestos/comparacion.service.ts`
- Test: `apps/api/test/presupuestos-comparacion.e2e-spec.ts`

**Interfaces — Produces:**
- `ComparacionService.comparar(presupuestoId, q: { desde?, hasta?, agrupar?, centroCostoId? })` → respuesta de spec §4 (`{ presupuesto, desde, hasta, agrupar, filas, totales, serie }`).
- `ComparacionService.resultado(tx, presupuestoId, desde: string, hasta: string): Promise<{ presupuestado: Dec; real: Dec }>` (para el tablero).

- [ ] **Step 1: Tests que fallan** (ejemplo de spec §7 con `prepararPresupuestos`: presupuesto de noviembre y asientos manuales de noviembre: 4.1.01 haber 900.000; 5.2.01 debe 220.000; 5.2.01 ROS debe 120.000; 5.2.01 COR debe 15.000; contrapartida 1.1.01.002):
  - `it('por cuenta')` (Review Focus 1): `desde=2026-11&hasta=2026-11&agrupar=cuenta` → 4.1.01 `{ presupuesto '1000000.00', real '900000.00', desvio '-100000.00', desvioPct '-10.00', favorable false }`; 5.2.01 `{ presupuesto '300000.00', real '355000.00' }`; `totales.resultado { presupuesto '700000.00', real '545000.00', desvio '-155000.00', desvioPct '-22.14' }`.
  - `it('por centro y sin presupuestar')`: `agrupar=centro` → Rosario `{ tipo 'RESULTADO', presupuesto '-100000.00', real '-120000.00', favorable false }`; Córdoba `{ presupuesto '0.00', real '-15000.00', sinPresupuesto true }`; con `centroCostoId=ROS&agrupar=cuenta` → solo 5.2.01 `{ presupuesto '100000.00', real '120000.00' }`.
  - `it('por rubro')`: `agrupar=rubro` → `4.1` y `5.2` con los mismos totales.
  - `it('excluye el ajuste por inflación y la refundición')`: asiento con `origenTipo 'AJUSTE_INFLACION'` sobre 4.1.01 (insertado con prisma) → real de ventas sin cambios.
  - `it('valida el rango')` (Review Focus 4): `desde=2026-12&hasta=2026-11` → 400; `hasta=2027-01` → 400 `El mes 01/2027 no pertenece al ejercicio`.
  - `it('serie y exportación')`: `desde=2026-10&hasta=2026-11` → `serie` `[{ mes '2026-10', presupuesto '0.00', real '0.00' }, { mes '2026-11', presupuesto '700000.00', real '545000.00' }]`; xlsx y pdf.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(presupuestos): comparación contra el Mayor`.

### Task 4: Tarjeta del tablero

**Files:** Modify `apps/api/src/informes/informes.service.ts` (tablero), `apps/api/src/informes/informes.module.ts`; Test `apps/api/test/presupuestos-tablero.e2e-spec.ts`.

**Interfaces:** Consumes `ComparacionService.resultado` (Task 3). Produces `indicadores.presupuesto: { nombre, resultadoPresupuestado, resultadoReal, desvioPct } | null`.

- [ ] **Step 1: Tests que fallan:**
  - `it('tarjeta con el vigente')`: ejemplo de Task 3 con el presupuesto vigente → `GET /api/informes/tablero?desde=2026-11-01&hasta=2026-11-30` → `presupuesto { nombre: 'Original 2026', resultadoPresupuestado '700000.00', resultadoReal '545000.00', desvioPct '-22.14' }`.
  - `it('sin vigente, sin permiso o fuera del ejercicio')` (Review Focus 4): sin vigente → `null`; usuario con `informes.ver` sin `presupuesto.ver` → `null`; período 2027 → `null` (sin error).
- [ ] **Step 2:** FAIL. **Step 3:** implementar (meses del período recortados al ejercicio que contiene `desde`). **Step 4:** PASS; suite API completa verde (dos mitades con `--shard`, sin otras pruebas en paralelo).
- [ ] **Step 5:** commit `feat(presupuestos): tarjeta del tablero`.

### Task 5: Web

**Files:**
- Create: `apps/web/src/presupuestos/{PresupuestosPage.tsx,ComparacionPage.tsx,comun.ts,presupuestos.test.tsx}`
- Modify: `apps/web/src/layout/menu.ts` (Informes de gestión: "Presupuestos" y "Presupuesto contra real", `presupuesto.ver`), `apps/web/src/paginas/rutas.tsx` (`/informes/presupuestos`, `/informes/presupuestos/:id`, `/informes/presupuesto-real`), `apps/web/src/informes/TableroPage.tsx` (tarjeta si `indicadores.presupuesto`)

**Interfaces — Produces:** exportados para test: `GrillaPresupuesto({ grilla, editable, onCambiar })`, `TablaComparacion({ datos })`, `TarjetaPresupuesto({ datos })`.

- [ ] **Step 1: Tests que fallan** (`presupuestos.test.tsx`):
  - `GrillaPresupuesto` con dos líneas → fila de totales por mes y celda `Resultado` `$ 700.000,00`; editar una celda llama `onCambiar` con la línea y los importes.
  - `TablaComparacion` → fila desfavorable con `data-favorable="false"`, fila sin presupuestar con el texto `Sin presupuestar`, totales de resultado.
  - `TarjetaPresupuesto` → `$ 545.000,00`, `de $ 700.000,00` y `-22,14 %` en rojo.
  - menú: con `presupuesto.ver` aparecen "Presupuestos" y "Presupuesto contra real".
- [ ] **Step 2:** FAIL. **Step 3:** implementar (grilla con `NumberInput` por celda y guardado por línea con `PUT lineas`; modales Nuevo/Copiar, Agregar línea, Repartir, Traer real anterior, Importar; comparación con `BarChart` presupuesto vs real por mes). **Step 4:** PASS; suite web y build.
- [ ] **Step 5:** commit `feat(web): presupuestos y presupuesto contra real`.

### Task 6: E2E y README

**Files:** Create `e2e/presupuestos.spec.ts`; Modify `README.md`.

- [ ] **Step 1: Test** `test('presupuesto: el contador crea uno, reparte ventas, lo marca vigente y ve la comparación')`: login contador; `/informes/presupuestos` → Nuevo "Plan 2026" → Agregar línea `4.1.01 Ventas` → Repartir 1.200.000 → ve `$ 100.000,00` en la grilla → Marcar vigente; `/informes/presupuesto-real` → ve la fila de Ventas con su presupuesto.
- [ ] **Step 2:** recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 15/15.
- [ ] **Step 3:** README sección "Presupuesto contra real (Entrega 16)".
- [ ] **Step 4:** suites API, web y e2e verdes.
- [ ] **Step 5:** commit `test(e2e): presupuestos; docs: README entrega 16`.
