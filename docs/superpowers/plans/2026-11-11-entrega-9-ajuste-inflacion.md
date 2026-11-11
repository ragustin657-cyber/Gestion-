# Entrega 9 — Ajuste por inflación contable: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** asiento de ajuste por inflación contable (RT 6, método directo) a cualquier fin de mes, con índices FACPCE globales, clasificación monetaria del plan de cuentas, anticuación de la apertura del primer ejercicio, bloqueo del cierre y comparativo reexpresado.

**Architecture:** módulo `apps/api/src/contabilidad/ajuste-inflacion/` con una función pura de cálculo (`calcularAjuste`) que leen la vista previa, el generador del asiento y el control del cierre; índices en un módulo global `apps/api/src/indices-inflacion/`. Web: tres pantallas nuevas y cambios en Plan de cuentas y Estados.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL 16), Zod, exceljs; React 19 + Mantine 7 + TanStack Query; Jest/supertest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-entrega-9-ajuste-inflacion-design.md` (los números de sección §N se refieren al spec).

## Global Constraints

- Todos los mensajes de error y textos de UI en español, **exactamente** como los fija el spec.
- Importes en `Prisma.Decimal` (`D`, `Dec` de `contabilidad/consultas/saldos.ts`); sin `Number` en el cálculo. Redondeo a 2 decimales solo por grupo (§5).
- Fechas como `Date` UTC a medianoche; parsear query con `fechaQuery` y body con `zFecha`.
- Multi-tenant: los modelos nuevos de empresa van en `MODELOS_DE_EMPRESA` (`apps/api/src/prisma/modelos-empresa.ts`); `IndiceInflacion` **no**.
- Migraciones: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://gestion:gestion@localhost:5432/gestion_shadow --script` + SQL de datos, `migrate deploy` en `gestion` y `gestion_test`, y verificar diff vacío.
- Postgres: `service postgresql start` si está caído. Reloj de pruebas congelado en 2026-11-06 (ejercicio 1 = 2026-01-01..2026-12-31).
- Commits terminan con las líneas `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` y `Claude-Session: https://claude.ai/code/session_01PUxLkCHXNYj9n2P64zhXBQ`.

## Review Focus

1. **Asiento cargado después del ajuste con fecha anterior** → el siguiente ajuste lo recoge (cálculo desde el inicio del ejercicio). Prueba en Task 5 (`complementario con gasto de febrero`).
2. **Ajuste anulado y vuelto a generar** → el anulado y su contraasiento no cuentan; el nuevo da el mismo asiento original. Prueba en Task 6.
3. **Cuenta no monetaria que pasa a monetaria entre dos ajustes** → los ajustes ya registrados en esa cuenta quedan en su saldo y el cálculo deja de tocarla (no hay renglón inverso). Prueba en Task 5 (`cuenta reclasificada`).
4. **Índices con mes faltante en el medio del ejercicio o de la anticuación** → 400 con la lista ordenada, sin generar nada. Prueba en Task 5.
5. **CSV de índices con encabezado, BOM UTF-8 y líneas `\r\n`** → se importa igual. Prueba en Task 3.

---

### Task 1: Esquema, migración y plan modelo

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/prisma/modelos-empresa.ts`, `apps/api/src/seed/plan-cuentas-modelo.ts`, `apps/api/src/compras/config/conceptos.ts`, `apps/api/src/compras/comun.ts` (union de `bloquear`)
- Create: `apps/api/prisma/migrations/20261111090000_ajuste_inflacion/migration.sql`
- Test: `apps/api/test/ajuste-plan.e2e-spec.ts`

**Interfaces — Produces:**
- `CuentaContable.monetaria: boolean` (default `true`), `CuentaContable.cuentaAjusteId: string | null` (relación `"Ajuste"` consigo misma, `onDelete: Restrict`).
- `model IndiceInflacion { id uuid, anio Int, mes Int, valor Decimal(18,6), actualizadoPor String, actualizadoEn DateTime @updatedAt; @@unique([anio, mes]) }`.
- `model ConfigAjusteInflacion { id uuid, empresaId uuid @unique, primerEjercicioId uuid, asientoAperturaId uuid?, actualizadoPor String, actualizadoEn DateTime @updatedAt }`.
- `model AnticuacionApertura { id uuid, empresaId uuid, cuentaContableId uuid, anio Int, mes Int, importe Decimal(18,2); @@unique([empresaId, cuentaContableId, anio, mes]) }`.
- `enum TipoAsiento` + `AJUSTE_INFLACION`.
- `CONCEPTOS_CUENTA.RECPAM = '4.2.03'`, `CONCEPTOS_CUENTA.RESULTADOS_NO_ASIGNADOS = '3.2.01'`.
- `bloquear(..., 'ConfigAjusteInflacion', ...)` admitido.
- `PLAN_CUENTAS_MODELO` con `monetaria` en cada `CuentaModelo` y las cuentas `3.1.02 Ajuste de capital` (PN, imputable) y `4.2.03 Resultado por exposición a la inflación (RECPAM)` (RP, imputable); `cargarPlanModelo` asigna `cuentaAjusteId` de 3.1.01 = 3.1.02.
- Regla `monetaria` (modelo y migración): `false` si tipo ∈ {PATRIMONIO_NETO, RESULTADO_POSITIVO, RESULTADO_NEGATIVO} o código `1.2.01` / `1.2.01.%`; si no `true`.

- [ ] **Step 1: Test que falla** — `ajuste-plan.e2e-spec.ts`, `it('el plan modelo trae la clasificación monetaria, las cuentas nuevas y los conceptos')` con `sesionConPlan`:
```ts
const c = async (codigo: string) => prisma.cuentaContable.findFirstOrThrow({ where: { empresaId: s.empresaId, codigo } });
expect((await c('1.1.01.002')).monetaria).toBe(true);
expect((await c('1.2.01.002')).monetaria).toBe(false);
expect((await c('3.1.01')).cuentaAjusteId).toBe((await c('3.1.02')).id);
expect((await c('4.2.03')).nombre).toBe('Resultado por exposición a la inflación (RECPAM)');
expect((await c('4.1.01')).monetaria).toBe(false);
// conceptos precargados (GET /api/compras/config devuelve { ..., cuentas: [{ concepto, cuentaContableId }] })
const cuentas = (await s.http.get('/api/compras/config')).body.cuentas;
expect(cuentas).toContainEqual({ concepto: 'RECPAM', cuentaContableId: (await c('4.2.03')).id });
expect(cuentas).toContainEqual({ concepto: 'RESULTADOS_NO_ASIGNADOS', cuentaContableId: (await c('3.2.01')).id });
```
- [ ] **Step 2:** `pnpm --filter api test:e2e -- ajuste-plan` → FAIL (columna inexistente).
- [ ] **Step 3:** esquema + plan modelo + conceptos + `MODELOS_DE_EMPRESA` (`ConfigAjusteInflacion`, `AnticuacionApertura`) + union de `bloquear`. Generar la migración con `migrate diff` y agregar SQL de datos para empresas existentes: `UPDATE "CuentaContable" SET monetaria=false WHERE tipo IN (...) OR codigo='1.2.01' OR codigo LIKE '1.2.01.%'`; `INSERT` de 3.1.02 y 4.2.03 donde exista la madre (3.1 / 4.2) y no el código (`gen_random_uuid()`, `monetaria=false`); `UPDATE` de `cuentaAjusteId` de 3.1.01; `INSERT INTO "ConfigCuenta"` (concepto texto) para `RECPAM` y `RESULTADOS_NO_ASIGNADOS` en las empresas que tengan la cuenta y no el concepto. Deploy a `gestion` y `gestion_test`; diff vacío.
- [ ] **Step 4:** test → PASS; `pnpm --filter api test:e2e` completo verde (los tests que cuentan cuentas del plan modelo pueden necesitar actualizar el total: hacerlo).
- [ ] **Step 5:** commit `feat(contabilidad): clasificación monetaria, cuentas de ajuste y modelos de ajuste por inflación`.

### Task 2: Plan de cuentas — clasificación y cuenta de ajuste

**Files:**
- Modify: `apps/api/src/contabilidad/plan-cuentas/plan-cuentas.service.ts`, `plan-cuentas.controller.ts`
- Test: `apps/api/test/ajuste-plan.e2e-spec.ts`

**Interfaces — Produces:** `NodoCuenta` suma `monetaria: boolean; cuentaAjusteId: string | null`. `crear(d)` acepta `monetaria?: boolean` (si falta: la del padre; sin padre: regla de Task 1 por tipo). `modificar(id, d)` acepta `monetaria?: boolean; cuentaAjusteId?: string | null`.

- [ ] **Step 1: Tests que fallan:**
  - `it('una cuenta nueva hereda la clasificación de la madre')`: POST `1.2.01.004` bajo `1.2.01` → `monetaria === false`; POST `1.1.01.006` bajo `1.1.01` → `true`.
  - `it('valida la cuenta de ajuste')`, PATCH con estos casos y `body.message` exacto:
    - `1.1.01.002` con `cuentaAjusteId` de 3.1.02 → `Solo las cuentas no monetarias tienen cuenta de ajuste`
    - `1.2.01.002` con ajuste `1.1.01.002` → `La cuenta de ajuste debe ser imputable y no monetaria`
    - `1.2.01.002` con ajuste `1.2.01` (no imputable) → `La cuenta de ajuste debe ser imputable y no monetaria`
    - `1.2.01.002` con ajuste `1.2.01.002` → `La cuenta de ajuste no puede ser la misma cuenta`
    - `1.2.01.002` con ajuste `3.1.02` → `La cuenta de ajuste ya ajusta a la cuenta 3.1.01`
    - `3.1.02` con ajuste `1.2.01.003` → `Una cuenta de ajuste no puede tener a su vez cuenta de ajuste`
    - `1.2.01.002` con ajuste `1.2.01.003`, y luego `1.2.01.003` con ajuste `5.2.01` → `Una cuenta de ajuste no puede tener a su vez cuenta de ajuste`
    - `1.2.01.002` con ajuste `1.2.01.003` → 200; `GET /api/plan-cuentas` muestra `cuentaAjusteId`.
  - Pasar una cuenta con `cuentaAjusteId` a `monetaria: true` en el mismo PATCH o con el vínculo existente → `Solo las cuentas no monetarias tienen cuenta de ajuste`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar; las validaciones dentro de la transacción, en el orden de la lista.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(plan-cuentas): clasificación monetaria y cuenta de ajuste editables`.

### Task 3: Índices de inflación

**Files:**
- Create: `apps/api/src/indices-inflacion/{csv.ts,csv.spec.ts,indices.ts,indices-inflacion.service.ts,indices-inflacion.controller.ts,indices-inflacion.module.ts}`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/indices-inflacion.e2e-spec.ts`

**Interfaces — Produces:**
- `parsearCsvIndices(texto: string): { anio: number; mes: number; valor: string }[]` — lanza `BadRequestException('Línea N: <motivo>')`. Motivos: `período inválido`, `valor inválido`, `período repetido`.
- `type Mes = { anio: number; mes: number }`; `claveMes(m: Mes): string` → `'2026-03'`; `mesDe(fecha: Date): Mes`; `mesAnterior(m: Mes): Mes`.
- `indicesPara(tx: TxEmpresa, meses: Mes[]): Promise<Map<string, Dec>>` — lanza 400 `Faltan los índices de: 06/2025, 02/2026` (únicos, ordenados).
- Endpoints de §2.

- [ ] **Step 1: Tests que fallan:**
  - `csv.spec.ts`: `'2025-06;50\n2025-07;55,5'` → `[{2025,6,'50'},{2025,7,'55.5'}]`; `'Período,Índice\r\n06/2025,50.25\r\n\r\n'` → un elemento con `'50.25'`; texto con BOM `'﻿2025-06;50'` → un elemento; `'2025-13;5'` → `Línea 1: período inválido`; `'2025-06;0'` → `Línea 1: valor inválido`; `'2025-06;5\n2025-06;6'` → `Línea 2: período repetido`.
  - e2e `it('solo el superadmin carga índices')`: usuario sin superadmin (`sesion(app, prisma, { permisos: ['contabilidad.cerrar'] })`) PUT → 403; GET → 200.
  - e2e `it('importa, actualiza y lista')`: superadmin PUT `2025/12 {valor: 80}` → 200; importar `'2025-12;81\n2026-01;100'` → `{ creados: 1, actualizados: 1 }`; GET → `[{anio:2026,mes:1,valor:'100'}, {anio:2025,mes:12,valor:'81'}]` (orden desc; valor como string sin ceros de más vía `Decimal.toString()`); importar con línea mala → 400 y la lista no cambia.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar. Importar dentro de una transacción (todo o nada). `actualizadoPor` = usuario del contexto.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(indices): índices de inflación globales con importación CSV`.

### Task 4: Configuración del ajuste y anticuación

**Files:**
- Create: `apps/api/src/contabilidad/ajuste-inflacion/{config.service.ts,ajuste-inflacion.controller.ts,dto.ts}`; registrar en `contabilidad.module.ts`
- Create: `apps/api/test/helpers-ajuste.ts`
- Test: `apps/api/test/ajuste-config.e2e-spec.ts`

**Interfaces — Produces:**
- `ConfigAjusteService.obtener(tx): Promise<ConfigAjusteInflacion | null>`; `requerir(tx)` → 400 `Configure el ajuste por inflación`.
- `aperturaDe(tx, ejercicio, config): Promise<Map<string, Dec>>` — saldo de apertura por cuenta (§4: `asientoAperturaId` si es el primer ejercicio y está configurado, si no los asientos `tipo APERTURA` del ejercicio).
- `GET/PUT /api/contabilidad/ajuste-inflacion/config` (§4).
- `helpers-ajuste.ts`: `escenarioEjemplo(app, prisma)` → `{ s, ej, indices(valores: Record<string, number>), apertura(renglones: [codigo, debe, haber][]) , asiento(fecha, [codigo, debe, haber][]) }`. `indices` escribe `IndiceInflacion` directo con prisma; `apertura` crea un asiento `tipo APERTURA`, `origenTipo 'APERTURA'` con prisma (renglones con `empresaId`) fechado 2026-01-01 y `ejercicioId`; `asiento` usa `POST /api/contabilidad/asientos`.

- [ ] **Step 1: Tests que fallan** (apertura del ejemplo §5):
  - `it('lista las cuentas no monetarias con saldo de apertura')`: PUT config `{ primerEjercicioId: ej.id, anticuacion: [] }`; GET → `anticuacion` con códigos `['1.2.01.002', '3.1.01']` y `saldoApertura` `'600'` y `'-1000'` (no incluye 1.1.01.002 ni 3.2.01).
  - `it('valida la anticuación')`: Rodados tramos `[{2025,6,700}]` → `La anticuación de 1.2.01.002 supera su saldo de apertura`; `[{2025,6,-100}]` → mismo mensaje (signo opuesto); mes `{2026,1}` → `El mes de origen debe ser anterior al inicio del ejercicio`; cuenta monetaria → `Solo se anticúan cuentas no monetarias con saldo de apertura`.
  - `it('apertura cargada con asiento manual')`: sin asiento APERTURA, un asiento manual 2026-01-01 Rodados D 600 / Capital H 600 elegido como `asientoAperturaId` → GET lista Rodados `'600'`; un `asientoAperturaId` de otro ejercicio → `El asiento de apertura debe ser del primer ejercicio ajustado`.
  - Permiso: usuario con solo `plancuentas.ver` PUT → 403.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar (el PUT reemplaza todos los tramos en transacción; el cambio de primer ejercicio con ajustes vigentes se prueba en Task 6). - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(ajuste-inflacion): configuración y anticuación de la apertura`.

### Task 5: Cálculo y vista previa

**Files:**
- Create: `apps/api/src/contabilidad/ajuste-inflacion/calculo.ts`, `ajuste-inflacion.service.ts`
- Modify: `ajuste-inflacion.controller.ts`
- Test: `apps/api/test/ajuste-calculo.e2e-spec.ts`

**Interfaces — Produces:**
```ts
export interface CuentaAjuste { cuentaContableId: string; codigo: string; nombre: string; saldoContable: string; reexpresado: string; ajuste: string; cuentaAjuste: string | null }
export interface ResultadoAjuste { ejercicio: Ejercicio; fecha: Date; cuentas: CuentaAjuste[]; renglones: RenglonAsiento[]; recpam: string; avisos: string[] }
export function calcularAjuste(tx: TxEmpresa, fecha: Date): Promise<ResultadoAjuste>
```
`GET /api/contabilidad/ajuste-inflacion/previa?fecha=` devuelve `ResultadoAjuste` con `ejercicio` reducido a `{ id, numero }` (el xlsx en Task 6). Los montos van como string de `Decimal.toFixed(2)`. `recpam` positivo = ganancia. Errores de §5 con sus textos.

Algoritmo (el que el spec fija y los tests no determinan del todo):
1. validar fecha (último día de mes) y ejercicio ≥ primero; si no es el primero, exigir ajuste vigente (asiento `origenTipo 'AJUSTE_INFLACION'` sin contraasiento y que no sea contraasiento) en `ejercicioAnterior.hasta`.
2. leer apertura (`aperturaDe`), movimientos agrupados por `(cuenta, anio, mes)` con SQL `groupBy` sobre renglones (excluyendo apertura, REFUNDICION, CIERRE, `origenTipo 'AJUSTE_INFLACION'`), y saldo de ajustes previos por cuenta.
3. armar grupos; pedir de una vez a `indicesPara` todos los meses necesarios (B, M, meses de movimientos, orígenes de anticuación).
4. paso A, paso B, ajuste, renglones (orden por código), RECPAM.

- [ ] **Step 1: Tests que fallan** con `escenarioEjemplo` y los datos exactos del ejemplo de §5:
  - `it('reproduce el ejemplo del spec')`: previa `2026-03-31` → `cuentas` filtradas a ajuste ≠ 0: `1.2.01.002 saldoContable '600.00' reexpresado '1440.00' ajuste '840.00'`; `3.1.01 '-1000.00' '-2400.00' '-1400.00' cuentaAjuste '3.1.02'`; `3.2.01 '0.00' '360.00' '360.00'`; `4.1.01 '-220.00' '-240.00' '-20.00'`; `1.2.01.001` con ajuste `'0.00'`; `recpam === '-220.00'`; `renglones` = Rodados debe 840, 3.2.01 debe 360, 4.2.03 debe 220, 3.1.02 haber 1400, 4.1.01 haber 20; `avisos` = `[]`.
  - `it('avisa lo no anticuado')`: anticuación de Rodados solo 400 en 06/2025 → aviso `1.2.01.002: 200.00 sin anticuar, se toma al inicio del ejercicio` y Rodados reexpresado `= (400×80/50 + 200) × 1.5 = 1260.00`.
  - `it('índices faltantes')`: sin el índice 02/2026 → 400 `Faltan los índices de: 02/2026`; sin 06/2025 y 02/2026 → `Faltan los índices de: 06/2025, 02/2026`.
  - `it('fecha inválida')`: `2026-03-30` → `La fecha debe ser el último día de un mes`; sin config → `Configure el ajuste por inflación`.
  - `it('las cuentas monetarias no se reexpresan')`: pasar 4.1.01 a monetaria (PATCH) → la previa no lista 4.1.01 y `recpam === '-200.00'`.
  - Los casos de Review Focus 1 y 3 necesitan un asiento generado: van en Task 6.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(ajuste-inflacion): cálculo por método directo y vista previa`.

### Task 6: Asiento de ajuste, lista, anulación y Excel

**Files:**
- Modify: `ajuste-inflacion.service.ts`, `ajuste-inflacion.controller.ts`, `apps/api/src/contabilidad/manuales/asientos-manuales.service.ts` (`manual()`), `config.service.ts` (cambio de primer ejercicio)
- Test: `apps/api/test/ajuste-asiento.e2e-spec.ts`

**Interfaces — Produces:** `AjusteInflacionService.generar(fecha: Date)`, `listar()`, `anular(asientoId: string, motivo: string)`, `previaXlsx(fecha): Promise<Buffer>`; `ultimoVigente(tx, ejercicioId?): Promise<Asiento | null>`; endpoints de §6. Auditoría `AJUSTE_INFLACION_GENERAR` / `AJUSTE_INFLACION_ANULAR` (entidad `Asiento`).

- [ ] **Step 1: Tests que fallan** (escenario del ejemplo):
  - `it('genera el asiento del ejemplo')`: POST `{fecha:'2026-03-31'}` → 201; el asiento tiene `tipo 'AJUSTE_INFLACION'`, `descripcion 'Ajuste por inflación al 31/03/2026'`, `origenId` `${ej.id}:2026-03` y los 5 renglones del ejemplo. Una segunda previa al 31/03 → `renglones` vacío; POST → 400 `No hay diferencias para ajustar`.
  - `it('complementario con gasto de febrero')`: tras el ajuste, asiento `2026-02-20` 5.2.01 D 100 / 1.1.01.002 H 100 → POST 31/03 → renglones `5.2.01 debe 9.09`, `4.2.03 haber 9.09`. Con el gasto fechado `2026-03-20` → `No hay diferencias para ajustar`.
  - `it('cuenta reclasificada después de un ajuste')` (Review Focus 3): ajuste al 31/03; pasar 4.1.01 a monetaria → previa al 31/03 con `renglones` vacío (el H 20 ya registrado queda en Ventas y no se revierte).
  - `it('rechaza una fecha anterior al último ajuste')`: ajuste al 31/03 y luego POST `2026-02-28` → `Ya hay un ajuste al 31/03/2026: genere uno a esa fecha o posterior`.
  - `it('anula solo el último y el siguiente lo recalcula')`: ajustes al 28/02 y 31/03 (índices hasta 03); anular el de febrero → `Solo se puede anular el último ajuste (31/03/2026)`; anular el de marzo → 201 (contraasiento fechado 31/03); otra previa al 31/03 → los mismos renglones que el ajuste anulado. `listar()` muestra `anulado: true` en el anulado. Anular por `POST /api/contabilidad/asientos/:id/anular` → `Anule el ajuste desde Ajuste por inflación`.
  - `it('no cambia el primer ejercicio con ajustes vigentes')`: PUT config con otro `primerEjercicioId` → `Hay ajustes generados: anúlelos antes de cambiar el primer ejercicio`.
  - `it('dos generaciones simultáneas no duplican')`: 4 rondas con `Promise.all` de dos POST iguales → exactamente un 201 y el otro 400 `No hay diferencias para ajustar`.
  - `it('ejercicio siguiente')`: abrir el ejercicio 2 (`POST /ejercicios/siguiente`), índices hasta 01/2027; previa `2027-01-31` sin ajuste al 31/12/2026 → `Genere primero el ajuste al cierre del ejercicio 1`.
  - `it('exporta la previa')`: `?formato=xlsx` → `content-type` de xlsx; leer con exceljs: fila de encabezado `Código, Cuenta, Saldo contable, Reexpresado, Ajuste`; última fila de datos `RECPAM` con `-220`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar. `generar` y `anular`: en `tenant.transaccion`, primero `bloquear(tx, 'ConfigAjusteInflacion', empresaId, [config.id])`, luego calcular y `AsientosService.generar` / `contraasiento`.
- [ ] **Step 4:** PASS; suite e2e completa verde.
- [ ] **Step 5:** commit `feat(ajuste-inflacion): asiento de ajuste, anulación y Excel de la previa`.

### Task 7: Cierre del ejercicio exige el ajuste

**Files:**
- Modify: `apps/api/src/contabilidad/cierre/cierre-ejercicio.service.ts` (`faltantes`)
- Test: `apps/api/test/ajuste-cierre.e2e-spec.ts`

**Interfaces — Consumes:** `ConfigAjusteService.obtener`, `ultimoVigente`, `calcularAjuste`.

- [ ] **Step 1: Tests que fallan** (escenario del ejemplo; índices del ejemplo hasta 03/2026 y 120 de 04/2026 a 12/2026; cerrar 11 meses y abrir el ejercicio 2 como `listoParaCerrar` de `contabilidad-revision.e2e-spec.ts`):
  - previa de cierre → `faltantes` contiene `Genere el ajuste por inflación al cierre`; POST cerrar → 400 con ese mensaje.
  - generar al 31/12/2026; luego corregir el índice 12/2026 a 132 (los meses 1–11 están cerrados, así que el cambio llega por índice) → `El ajuste por inflación al cierre está desactualizado: genere uno nuevo`.
  - generar el complementario al 31/12 → cerrar 200.
  - sin el índice 12/2026 → `faltantes` contiene `Faltan los índices de: 12/2026`.
  - empresa sin config → el cierre no pide nada (test existente sigue verde).
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar; `calcularAjuste` se llama con el `tx` del cierre. - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(cierre): el cierre exige el ajuste por inflación al día`.

### Task 8: Comparativo reexpresado

**Files:**
- Modify: `apps/api/src/contabilidad/estados/estados.service.ts`, `estados.controller.ts`
- Test: `apps/api/test/ajuste-estados.e2e-spec.ts`

**Interfaces — Produces:** query `comparativoReexpresado=true` en `GET /api/contabilidad/estados/situacion` y `/resultados`; `comparativo.coeficiente: string` (6 decimales) cuando se pidió; importes del comparativo (`importeAnterior` en filas y totales del comparativo) multiplicados y redondeados a 2 decimales. El PDF actual no muestra el comparativo: no cambia (ruling: el spec mencionaba Excel, que estos estados no tienen).

- [ ] **Step 1: Test que falla**: ejercicio 1 cerrado con un asiento Bancos D 1000 / Capital H 1000 (sin config de ajuste), ejercicio 2 con índices 12/2026 = 100 y 06/2027 = 150 y `FECHA_TEST` no hace falta: pedir `situacion?fecha=2027-06-30&comparativoReexpresado=true` → `comparativo.activo === '1500.00'`, `comparativo.coeficiente === '1.500000'`, fila `1.1.01.002` `importeAnterior '1500.00'`; sin el flag → `'1000'` y sin `coeficiente`. Resultados con `desde=2027-01-01&hasta=2027-06-30` → coeficiente `I(06/2027)/I(06/2026)`; sin índice 06/2026 → 400 `Faltan los índices de: 06/2026`.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(estados): comparativo reexpresado por índices`.

### Task 9: Web

**Files:**
- Create: `apps/web/src/contabilidad/ajuste-inflacion/{IndicesInflacionPage.tsx,ConfigAjustePage.tsx,AjusteInflacionPage.tsx,ajuste.test.tsx}`
- Modify: `apps/web/src/layout/menu.ts`, `apps/web/src/paginas/rutas.tsx`, `apps/web/src/paginas/PlanCuentasPage.tsx`, `apps/web/src/contabilidad/EstadosPages.tsx`

**Interfaces — Produces:**
- Rutas: `/admin/indices-inflacion` (menú admin, `soloSuperadmin: true`, título `Índices de inflación`), `/contabilidad/ajuste-inflacion` (Registraciones › Contabilidad General, `Ajuste por inflación`, permiso `contabilidad.cerrar`), `/admin/ajuste-inflacion` (menú admin, `Configuración del ajuste por inflación`, permiso `contabilidad.cerrar`).
- Componentes exportados para test: `TablaPreviaAjuste({ previa })`, `TablaAjustes({ filas, onAnular })`, `GrillaAnticuacion({ cuentas, onChange })`.

- [ ] **Step 1: Tests que fallan** (`ajuste.test.tsx`, con `MantineProvider`):
  - `TablaPreviaAjuste` con la previa del ejemplo → muestra `840,00`, `-1.400,00` y la fila `RECPAM` con `-220,00`; con `avisos: ['x']` muestra `x`.
  - `TablaAjustes` con dos filas (31/03 vigente, 28/02 anulado) → un solo botón `Anular` (en la de 31/03) y el texto `Anulado` en la otra.
  - `GrillaAnticuacion` con Rodados saldo 600 y un tramo 400 → muestra `Sin anticuar: 200,00`.
  - `menu.test.ts`: `Índices de inflación` solo aparece con `superadmin=true`.
- [ ] **Step 2:** `pnpm --filter web test` → FAIL.
- [ ] **Step 3:** implementar las páginas (patrones de `impuestos/ConfigImpuestosPage.tsx` y `PresentacionesPages.tsx`):
  - Índices: tabla Período / Valor con edición en línea (PUT), alta, borrar, botón `Importar CSV` (muestra `Creados: N · Actualizados: M` o el error).
  - Configuración: selector de ejercicio, selector de asiento de apertura (opcional), `GrillaAnticuacion` y `Guardar`.
  - Ajuste: `MonthPickerInput` que envía el último día del mes, `Ver previa`, `TablaPreviaAjuste`, botones `Excel` y `Generar`, `TablaAjustes` con modal de motivo al anular.
  - Plan de cuentas: columna `Monetaria` (Sí/No), interruptor `Monetaria` y selector `Cuenta de ajuste` (solo imputables no monetarias) en el formulario de edición.
  - Estados: casilla `Comparativo reexpresado` que agrega el query param.
- [ ] **Step 4:** PASS; `pnpm --filter web build` sin errores de tipos.
- [ ] **Step 5:** commit `feat(web): índices, configuración y ajuste por inflación`.

### Task 10: E2E y README

**Files:**
- Create: `e2e/ajuste-inflacion.spec.ts`
- Modify: `README.md` (sección Entrega 9)

- [ ] **Step 1: Test** — `test('ajuste por inflación: el superadmin carga índices y el contador genera el ajuste')`: login `admin@demo.com` / `admin1234`, `/admin/indices-inflacion`, importar un CSV (`setInputFiles` con buffer) con `2025-12;100` … `2026-10;120` (uno por mes) → ve `Creados: 11`. Login `contador@demo.com`, `/admin/ajuste-inflacion`: elegir ejercicio 1 y guardar; `/contabilidad/ajuste-inflacion`: mes octubre 2026, `Ver previa` → visible `RECPAM`; `Generar` → la lista muestra `31/10/2026`.
- [ ] **Step 2:** recrear la base e2e (`su postgres -c "dropdb --if-exists gestion_e2e && createdb -O gestion gestion_e2e"`) y `pnpm e2e -- --trace off` → 9/9.
- [ ] **Step 3:** README: qué hace la entrega, cómo cargar índices, configurar y generar; limitaciones (§1 fuera de alcance).
- [ ] **Step 4:** suites completas: API, web, e2e verdes.
- [ ] **Step 5:** commit `test(e2e): ajuste por inflación; docs: README entrega 9`.
