# Entrega 18 — Sueldos (parte 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Legajos, convenios con escalas, conceptos por tipo de cálculo, liquidación mensual y SAC con borrador y cierre, recibos art. 140 LCT y resumen.

**Architecture:** Módulo `apps/api/src/sueldos/` con `calculo.ts` puro (un empleado → renglones y totales; SAC), servicios de maestros, de liquidaciones y de salidas (PDF/Excel). Precarga de Comercio por empresa al crear el plan modelo y por migración para las existentes. Web en `apps/web/src/sueldos/`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, pdfkit, ExcelJS, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-entrega-18-sueldos-liquidacion-design.md`

## Global Constraints

- Modelos nuevos (`Convenio`, `Categoria`, `Escala`, `Empleado`, `Concepto`, `Liquidacion`, `Novedad`, `ReciboSueldo`, `ReciboSueldoRenglon`) en `MODELOS_DE_EMPRESA`; acceso por `TenantPrisma`.
- Importes `Decimal(18,2)`, redondeo a 2 decimales por renglón (half-up).
- Permisos `sueldos.ver: 'Ver sueldos'`, `sueldos.liquidar: 'Liquidar sueldos'` (demo: Administrador y Contador).
- Mensajes exactos del spec (§3, §5, §11).
- Reloj de pruebas 2026-11-06; ejercicio y empresa de `sesionConPlan`.

## Review Focus

1. **Empleado que ingresa a mitad de mes** → básico, antigüedad y presentismo proporcionales; horas extra y ausencias con valores del mes completo (§11.1). Prueba en Task 1.
2. **Empleado que cumple años de antigüedad dentro del mes liquidado** → cuenta el año si el aniversario es ≤ al último día del período. Prueba en Task 1.
3. **Cambio de escala entre meses** → noviembre usa la escala de noviembre; diciembre sin escala propia usa la de noviembre (vigente más reciente). Prueba en Task 3.
4. **Reabrir una mensual usada por un SAC cerrado** → 400 con el mensaje de §11.4. Prueba en Task 3.
5. **Neto en letras con centavos y millones** ("novecientos cuarenta y un mil dieciséis con 82/100") → correcto. Prueba en Task 4.

---

### Task 1: Cálculo puro

**Files:** Create `apps/api/src/sueldos/calculo.ts`, `apps/api/src/sueldos/calculo.spec.ts`.

**Interfaces — Produces:**
- `interface ConceptoCalc { id: string; codigo: string; nombre: string; clase: 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'DESCUENTO'; tipo: 'BASICO' | 'ANTIGUEDAD' | 'PORCENTAJE' | 'HORAS_EXTRA' | 'AUSENCIA' | 'FIJO' | 'DESCUENTO_LEY'; parametros: Record<string, unknown>; orden: number; soloAfiliados: boolean }`
- `interface EmpleadoCalc { fechaIngreso: Date; fechaEgreso: Date | null; afiliadoSindicato: boolean; basicoMensual: Dec; horasMensuales: number }`
- `interface NovedadCalc { tipo: 'HORAS_EXTRA_50' | 'HORAS_EXTRA_100' | 'AUSENCIA_INJUSTIFICADA' | 'IMPORTE'; conceptoId?: string; cantidad?: Dec; importe?: Dec }`
- `liquidarMes(e: EmpleadoCalc, conceptos: ConceptoCalc[], novedades: NovedadCalc[], anio: number, mes: number): { renglones: { conceptoId; codigo; nombre; clase; cantidad: Dec | null; base: Dec | null; porcentaje: Dec | null; importe: Dec; orden }[]; totalRemunerativo: Dec; totalNoRemunerativo: Dec; totalDescuentos: Dec; neto: Dec; diasTrabajados: number; antiguedadAnios: number }`
- `liquidarSac(e: EmpleadoCalc, conceptos: ConceptoCalc[], mejorRemunerativo: Dec, anio: number, semestre: 1 | 2): mismo resultado` (renglón `200 SAC` + descuentos de ley).
- `antiguedadAnios(ingreso: Date, finPeriodo: Date): number`; `diasTrabajados(ingreso, egreso, anio, mes): number` (mes completo = 30).

- [ ] **Step 1: Tests que fallan** (`calculo.spec.ts`, conceptos precargados de spec §4 como fixture):
  - `it('ejemplo del spec')`: básico 1.000.000, ingreso 2021-03-01, afiliado, noviembre 2026, novedad 4 horas al 50 % → renglones `100 1000000.00`, `110 50000.00`, `120 87465.00`, `130 31500.00`, `500 128586.15`, `510 35068.95`, `520 35068.95`, `530 5844.83`, `540 23379.30`; `totalRemunerativo '1168965.00'`, `totalDescuentos '227948.18'`, `neto '941016.82'`.
  - `it('ausencia injustificada')`: más 1 día de ausencia → `140 -35000.00`, sin renglón `120`, remunerativo `'1046500.00'`.
  - `it('no afiliado')`: sin `540`.
  - `it('ingreso a mitad de mes')` (Review Focus 1): ingreso 2026-11-16 (15 días), básico 1.000.000, 2 horas al 50 % → `100 500000.00`, `110` sin renglón (0 años), presentismo 8,33 % × 500.000 = `41650.00`, horas extra 2 × (1.000.000/200) × 1,5 = `15000.00`.
  - `it('antigüedad en el aniversario')` (Review Focus 2): ingreso 2021-11-30 → noviembre 2026: 5 años; ingreso 2021-12-01 → 4 años.
  - `it('base remunerativo + no remunerativo')`: concepto `FIJO` no remunerativo 100.000 → obra social 3 % = 3 % de (remunerativo + 100.000); jubilación sin cambio.
  - `it('SAC')`: mejor remunerativo 1.168.965 → `200 584482.50`; ingreso 2026-10-01 en el 2.º semestre → `292241.25`.
- [ ] **Step 2:** `npx jest src/sueldos/calculo` → FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(sueldos): cálculo de la liquidación`.

### Task 2: Modelo, permisos, precarga y maestros

**Files:**
- Modify `apps/api/prisma/schema.prisma`, migración `apps/api/prisma/migrations/20261117090000_sueldos/migration.sql` (tablas + precarga de Comercio, categorías y conceptos en cada empresa existente), `apps/api/src/seed/plan-cuentas-modelo.ts` (llama a `cargarSueldosModelo(tx, empresaId)` de `apps/api/src/sueldos/modelo.ts`), `packages/shared/src/permisos.ts`, `apps/api/src/seed/demo.ts`, `modelos-empresa.ts`, `app.module.ts`
- Create `apps/api/src/sueldos/{sueldos.module.ts,modelo.ts,maestros.service.ts,maestros.controller.ts,dto.ts}`
- Test `apps/api/test/sueldos-maestros.e2e-spec.ts`; helper `apps/api/test/helpers-sueldos.ts`

**Interfaces — Produces:** endpoints de maestros (spec §6); `cargarSueldosModelo`; `helpers-sueldos.ts` → `prepararSueldos(app, prisma)` = sesión con plan + `{ convenio, categoria(nombre), escala(categoria, 'AAAA-MM', basico), empleado(datos parciales) }`.

- [ ] **Step 1: Tests que fallan:**
  - `it('empresa nueva trae Comercio')`: convenio `Comercio (CCT 130/75)` con 20 categorías (`Vendedor B` incluida) y los 11 conceptos de §4 (`100`…`540`) con sus tipos y parámetros.
  - `it('escalas a mano e importadas')`: `PUT escalas` Vendedor B 11/2026 1.000.000; importar CSV `Categoría;MM/AAAA;Básico` con `Vendedor A;12/2026;1.050.000,50` → guardado; categoría inexistente → 400 con línea.
  - `it('empleados')`: alta con legajo correlativo `1`; CUIL `20-12345678-5` → `CUIL inválido`; categoría de otro convenio → 400.
  - `it('conceptos editables')`: cambiar `pct` de `120` a 10 → guardado; tipo inválido → 400.
  - `it('permisos')`: `sueldos.ver` lista, no crea.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (migración con `prisma migrate diff` + SQL de precarga; deploy en `gestion` y `gestion_test`; rebuild de `packages/shared`). **Step 4:** PASS; `test/plan*`, `test/compras-config` verdes.
- [ ] **Step 5:** commit `feat(sueldos): legajos, convenios, escalas y conceptos`.

### Task 3: Liquidaciones

**Files:** Create `apps/api/src/sueldos/{liquidaciones.service.ts,liquidaciones.controller.ts}`; Test `apps/api/test/sueldos-liquidaciones.e2e-spec.ts`.

**Interfaces:** Consumes `liquidarMes`, `liquidarSac` (Task 1). Produces endpoints de liquidaciones (spec §6) y `GET …/:id` → `{ liquidacion, recibos: [{ empleado, renglones, totales, numero }], errores, aviso?, totales }`.

- [ ] **Step 1: Tests que fallan** (escenario: Vendedor B 1.000.000 en 11/2026, empleado del ejemplo):
  - `it('liquida noviembre y recalcula con novedades')`: crear MENSUAL 11/2026 → `totalRemunerativo '1137465.00'`, `totalDescuentos '221805.68'`, neto `'915659.32'`; novedad 4 horas al 50 % → neto `'941016.82'`.
  - `it('falta de escala bloquea el cierre')`: empleado Vendedor A sin escala → `errores` `Falta la escala de Vendedor A para 11/2026`; cerrar → 400.
  - `it('escala vigente más reciente')` (Review Focus 3): MENSUAL 12/2026 sin escala de diciembre → básico 1.000.000.
  - `it('cerrar numera y reabrir conserva')`: cerrar → recibo `numero 1`, modificar novedades → 400; reabrir, agregar otro empleado y cerrar → números 1 y 2.
  - `it('SAC de diciembre')`: mensual 11/2026 cerrada; SAC 12/2026 → `200 584482.50`, `aviso` `La liquidación mensual de 12/2026 no está cerrada: no se considera en la mejor remuneración`; sin mensuales cerradas → `No hay liquidaciones mensuales cerradas en el semestre`.
  - `it('no reabre una mensual usada por un SAC cerrado')` (Review Focus 4): cerrar el SAC → reabrir la mensual 11/2026 → `La liquidación se usó en el SAC de 12/2026: reábralo primero`.
  - `it('empleados que entran')`: ingresado el 2026-11-16 → `diasTrabajados 15`; egresado el 2026-10-31 → no entra en noviembre.
  - `it('una por período y eliminar borrador')`: segunda MENSUAL 11/2026 → 400; eliminar borrador → 200; eliminar cerrada → 400.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(sueldos): liquidaciones mensuales y SAC`.

### Task 4: Recibos y resumen

**Files:** Create `packages/shared/src/letras.ts` (+ `letras.test.ts`), `apps/api/src/sueldos/{recibo-pdf.ts,salidas.controller.ts}`; Test `apps/api/test/sueldos-recibos.e2e-spec.ts`.

**Interfaces — Produces:** `montoEnLetras(importe: string): string` en `@gestion/shared` (formato: `pesos novecientos cuarenta y un mil dieciséis con 82/100`); `GET …/recibos.pdf?empleadoId`, `GET …/resumen?formato`.

- [ ] **Step 1: Tests que fallan:**
  - `letras.test.ts` (Review Focus 5): `941016.82` → `pesos novecientos cuarenta y un mil dieciséis con 82/100`; `1000000` → `pesos un millón con 00/100`; `21.5` → `pesos veintiuno con 50/100`; `2000001` → `pesos dos millones uno con 00/100`.
  - `it('recibo PDF')`: liquidación cerrada del ejemplo → PDF (content-type pdf) cuyo texto contiene `Vendedor B`, `941.016,82`, `novecientos cuarenta y un mil dieciséis`, `Firma del empleado`, el CUIL y `Último depósito`; en borrador contiene `BORRADOR`.
  - `it('resumen')`: xlsx con una fila por concepto (`100 Sueldo básico 1.000.000,00`…) y una hoja por empleado; pdf.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (pdfkit como `apps/api/src/ventas/pdf/pdf-venta.ts`; original y duplicado en la misma hoja). **Step 4:** PASS; suite API completa (dos mitades con `--shard`, sin otras pruebas en paralelo).
- [ ] **Step 5:** commit `feat(sueldos): recibos y resumen`.

### Task 5: Web

**Files:** Create `apps/web/src/sueldos/{EmpleadosPage.tsx,ConveniosPage.tsx,ConceptosPage.tsx,LiquidacionesPage.tsx,LiquidacionPage.tsx,comun.ts,sueldos.test.tsx}`; Modify `apps/web/src/layout/menu.ts` (menú "Sueldos": Empleados, Convenios y escalas, Conceptos, Liquidaciones — `sueldos.ver`), `apps/web/src/paginas/rutas.tsx` (`/sueldos/empleados`, `/sueldos/convenios`, `/sueldos/conceptos`, `/sueldos/liquidaciones`, `/sueldos/liquidaciones/:id`).

**Interfaces — Produces:** exportados para test: `TablaRecibo({ recibo })`, `PanelNovedades({ novedades, onCambiar })`, `TablaLiquidacion({ datos, onElegir })`.

- [ ] **Step 1: Tests que fallan** (`sueldos.test.tsx`):
  - `TablaRecibo` con el recibo del ejemplo → columnas Remunerativo / No remunerativo / Descuentos y `Neto $ 941.016,82`.
  - `PanelNovedades` → cargar 4 en "Horas extra 50 %" llama `onCambiar` con `[{ tipo: 'HORAS_EXTRA_50', cantidad: 4 }]`.
  - `TablaLiquidacion` con un error de escala → fila marcada y botón "Cerrar" deshabilitado.
  - menú: con `sueldos.ver` aparece "Liquidaciones"; sin permisos no.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; suite web y build.
- [ ] **Step 5:** commit `feat(web): sueldos`.

### Task 6: E2E y README

**Files:** Create `e2e/sueldos.spec.ts`; Modify `README.md`.

- [ ] **Step 1: Test** `test('sueldos: el contador da de alta un empleado, carga la escala, liquida, cierra y descarga recibos')`.
- [ ] **Step 2:** recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 16/16.
- [ ] **Step 3:** README sección "Sueldos (Entrega 18)".
- [ ] **Step 4:** suites API, web y e2e verdes.
- [ ] **Step 5:** commit `test(e2e): sueldos; docs: README entrega 18`.
