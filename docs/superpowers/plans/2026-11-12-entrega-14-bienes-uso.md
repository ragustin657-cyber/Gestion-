# Entrega 14 — Bienes de uso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar bienes de uso (desde la factura de proveedor o a mano), contabilizar la amortización mensual con fecha de origen integrada al ajuste por inflación, dar de baja y vender bienes, y emitir la planilla anexa que coincide con el Mayor.

**Architecture:** Módulo NestJS `apps/api/src/bienes-uso/` con cálculo puro (`calculo.ts`) separado de servicios (rubros, bienes, amortización, bajas, planilla). Integraciones puntuales: `AsientoRenglon.fechaOrigen` (asientos + ajuste por inflación), factura de proveedor (alta), comprobante de venta (venta), cierre de ejercicio (requisito), informes de ventas (exclusión). Web con páginas en `apps/web/src/bienes-uso/`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-entrega-14-bienes-uso-design.md`

## Global Constraints

- Todo acceso a datos de empresa por `TenantPrisma` (`this.tenant.db` / `transaccion`); los modelos nuevos `RubroBienUso`, `BienUso`, `AmortizacionBien`, `ProcesoAmortizacion` se agregan a `MODELOS_DE_EMPRESA`.
- Importes `Decimal(18,2)` serializados como texto con 2 decimales; cálculos con `Prisma.Decimal`.
- Mensajes de error exactamente como en el spec (en español).
- Permisos nuevos `bienes.ver: 'Ver bienes de uso'`, `bienes.gestionar: 'Gestionar bienes de uso'`; amortización con `contabilidad.cerrar`. Demo: Administrador (todos) y Contador.
- Fecha de alta de un bien desde factura = `fechaContable` de la factura (la del asiento que debita la cuenta).
- Emisión de venta: toda validación del bien antes de pedir el CAE (`preparar` y `emitir`); en `autorizar` nada puede fallar.
- Reloj de pruebas congelado en 2026-11-06; ejercicio 2026 abierto en las sesiones de prueba con plan.

## Review Focus

1. **Bien cargado tarde en un mes ya amortizado** → la siguiente generación (o re-generar el mismo mes) agrega solo la diferencia, sin duplicar lo ya contabilizado. Prueba en Task 4.
2. **Anular una amortización y volver a generarla** → el total vuelve a ser el mismo; anular una que no es la última da 400. Prueba en Task 4.
3. **Venta de un bien en un comprobante rechazado por ARCA o que queda en borrador** → el bien sigue activo y puede venderse en otro comprobante. Prueba en Task 5.
4. **Bien con vida útil ya cumplida** → no amortiza más ni aparece en la vista previa; su baja no deja residual. Prueba en Task 1 y Task 5.
5. **Planilla de un ejercicio con bienes dados de alta y de baja en el mismo ejercicio** → la fila cierra (inicio + altas − bajas = cierre) y coincide con el Mayor. Prueba en Task 6.

---

### Task 1: Cálculo puro de amortización

**Files:**
- Create: `apps/api/src/bienes-uso/calculo.ts`
- Test: `apps/api/src/bienes-uso/calculo.spec.ts`

**Interfaces — Produces:**
- `type Mes = string` ('AAAA-MM'); `mesDe(fecha: Date): Mes`; `sumarMeses(m: Mes, n: number): Mes`; `mesesEntre(desde: Mes, hasta: Mes): number` (inclusive; 0 si hasta < desde).
- `interface DatosBien { fechaAlta: Date; valorOrigen: Dec; valorResidual: Dec; vidaUtilMeses: number; amortizacionInicial: Dec; fechaAmortizacionInicial: Date | null; fechaBaja: Date | null }`
- `acumuladaEsperada(b: DatosBien, hasta: Mes): Dec` — spec §4 (2 decimales; exacto al cumplir la vida útil; con baja, hasta el mes anterior al de la baja).
- `ultimoMesAmortizable(b: DatosBien): Mes` — mes de alta + vida útil − 1, o el anterior a la baja si es menor.

- [ ] **Step 1: Tests que fallan** (`calculo.spec.ts`):
  - `it('rodado del ejemplo')`: 1.200.000, alta 2026-03-15, 60 meses → `acumuladaEsperada(b,'2026-09')` = `'140000.00'`, `'2026-02'` = `'0.00'`, `'2026-03'` = `'20000.00'`.
  - `it('redondeo del último mes')`: 1.000, 3 meses, alta 2026-01-10 → enero `'333.33'`, febrero `'666.67'`, marzo `'1000.00'`, abril `'1000.00'` (vida cumplida).
  - `it('valor residual')`: 1.000, residual 100, 9 meses → a los 9 meses `'900.00'`.
  - `it('baja: no amortiza el mes de baja')`: rodado con `fechaBaja` 2026-10-15 → `'2026-12'` = `'140000.00'`; `ultimoMesAmortizable` = `'2026-09'`.
  - `it('carga inicial')`: 1.200, 12 meses, alta 2025-01-01, inicial 600 a 2025-06-30 → `'2025-06'` = `'600.00'`, `'2025-07'` = `'700.00'`, `'2025-12'` = `'1200.00'`.
  - `it('meses')`: `mesesEntre('2025-11','2026-02')` = 4; `sumarMeses('2026-11', 3)` = `'2027-02'`.
- [ ] **Step 2:** `npx jest src/bienes-uso/calculo` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar. Carga inicial: hasta el mes de `fechaAmortizacionInicial` vale `amortizacionInicial`; después, inicial + (amortizable − inicial) × (meses transcurridos desde ese mes) / (meses de vida restantes), redondeado; sin pasar del amortizable.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(bienes-uso): cálculo de amortización`.

### Task 2: Esquema, plan de cuentas, rubros y permisos

**Files:**
- Modify: `apps/api/prisma/schema.prisma`; Create migración `apps/api/prisma/migrations/20261114090000_bienes_uso/migration.sql`
- Modify: `apps/api/src/seed/plan-cuentas-modelo.ts` (cuentas §2, regla no monetaria `1.2.02`, rubros precargados), `apps/api/src/compras/config/conceptos.ts`, `packages/shared/src/permisos.ts`, `apps/api/src/seed/demo.ts` (Contador + `bienes.ver`, `bienes.gestionar`), `apps/api/src/prisma/tenant-prisma.service.ts` (`MODELOS_DE_EMPRESA`), `app.module.ts`
- Create: `apps/api/src/bienes-uso/{bienes-uso.module.ts,rubros.service.ts,rubros.controller.ts,dto.ts}`
- Test: `apps/api/test/bienes-rubros.e2e-spec.ts`

**Interfaces — Produces:**
- Modelos del spec §2–§4 con estos nombres de campo exactos; `AsientoRenglon.fechaOrigen DateTime? @db.Date`; `ComprobanteVentaRenglon.bienUsoId String? @db.Uuid`; enums `OrigenBienUso { FACTURA MANUAL INICIAL }`, `EstadoBienUso { ACTIVO BAJA }`, `MotivoBajaBienUso { DESUSO SINIESTRO ROBO VENTA }`, `EstadoProcesoAmortizacion { VIGENTE ANULADO }`.
- `RubrosService.rubroDeCuenta(tx, cuentaContableId): Promise<RubroBienUso | null>` (rubro activo cuya `cuentaOrigenId` es esa cuenta).
- Endpoints `GET/POST /api/bienes-uso/rubros`, `PUT /api/bienes-uso/rubros/:id` (`GET` con `bienes.ver`, escritura con `bienes.gestionar`).
- La migración crea las cuentas y los 3 rubros en cada empresa que tenga `1.2.01.001`…`003` y `5.2` (SQL `INSERT … SELECT … WHERE NOT EXISTS`, como `20261111090000_ajuste_inflacion`), marca `monetaria=false` en `1.2.02%` y precarga los conceptos nuevos.

- [ ] **Step 1: Tests que fallan:**
  - `it('empresa nueva trae cuentas y rubros precargados')`: `sesionConPlan` → `GET /api/bienes-uso/rubros` devuelve `['Equipos de computación', 'Muebles y útiles', 'Rodados']` (orden por nombre) con `vidaUtilMeses` 36/120/60 y la cuenta de origen de Rodados con código `1.2.01.002`; cuenta `1.2.02.002` con `monetaria false`.
  - `it('valida rubros')`: cuenta no imputable → `La cuenta 1.2.01 no es imputable`; cuenta de origen repetida → `La cuenta 1.2.01.002 ya es de otro rubro`; `vidaUtilMeses: 0` → 400.
  - `it('permisos')`: usuario con `bienes.ver` lista (200) y no crea (403).
- [ ] **Step 2:** FAIL. **Step 3:** schema + `prisma migrate diff` (comando del proyecto) + SQL de datos al final de la migración; deploy en `gestion` y `gestion_test`; `cd packages/shared && pnpm build`. **Step 4:** PASS; también `test/ajuste-plan` y `test/plan-cuentas*` verdes.
- [ ] **Step 5:** commit `feat(bienes-uso): esquema, rubros y permisos`.

### Task 3: Bienes — alta manual, carga inicial, factura de proveedor

**Files:**
- Create: `apps/api/src/bienes-uso/{bienes.service.ts,bienes.controller.ts}`
- Modify: `apps/api/src/compras/comprobantes/{dto.ts,comprobantes.service.ts}` (renglón `bien?`, alta al confirmar, control al anular)
- Test: `apps/api/test/bienes-alta.e2e-spec.ts`; helper `apps/api/test/helpers-bienes.ts`

**Interfaces:**
- Consumes: `rubroDeCuenta` (Task 2).
- Produces: `BienesService.crearDesdeFactura(tx, factura: { fechaContable: Date; cotizacion: Dec }, renglones: { id: string; cuentaContableId: string; neto: Dec; bien: DatosBienRenglon }[])`; `BienesService.alAnularFactura(tx, comprobanteId)` (lanza `El bien N° X ya tiene amortizaciones o baja: anúlelas primero` o elimina); `amortizadoVigente(tx, bienId): Promise<Dec>` (suma de `AmortizacionBien` de procesos vigentes + inicial). Endpoints `GET /api/bienes-uso`, `GET /api/bienes-uso/:id`, `POST /api/bienes-uso`, `PUT /api/bienes-uso/:id`, `DELETE /api/bienes-uso/:id`.
- `helpers-bienes.ts`: `prepararBienes(app, prisma)` → sesión con plan + proveedor + `{ rubro(nombre), facturaBien({ neto, fecha, descripcion?, vida? }) → { comprobanteId, bien }, generar(mes), cuenta(codigo), saldo(codigo, hasta?) }`.

- [ ] **Step 1: Tests que fallan:**
  - `it('factura con renglón de rubro exige el bien')`: renglón a cuenta de Rodados sin `bien` → 400 `Indique el bien de uso del renglón 1`.
  - `it('alta desde factura')`: factura 2026-03-15 neto 1.200.000 con `bien: { descripcion: 'Camioneta' }` → un bien `{ numero: 1, origen: 'FACTURA', valorOrigen: '1200000.00', vidaUtilMeses: 60, fechaAlta: '2026-03-15' }`; factura en USD neto 1.000 a 1.000 → `valorOrigen '1000000.00'`.
  - `it('anular factura')`: sin amortizaciones → bien eliminado; con amortización generada → 400 `El bien N° 1 ya tiene amortizaciones o baja: anúlelas primero`.
  - `it('alta manual con asiento')`: `origen 'MANUAL'`, contrapartida `3.1.01` → asiento debe `1.2.01.002` 500.000 / haber `3.1.01`; contrapartida igual a la cuenta del rubro → 400.
  - `it('carga inicial sin asiento')`: `amortizacionInicial` 600.000 a 2026-02-28 sobre 1.200.000 → sin asiento; `amortizacionInicial` mayor que el amortizable → 400.
  - `it('edición bloqueada con amortizaciones')`: cambiar `valorOrigen` tras generar → `El bien ya tiene amortizaciones: anúlelas para modificarlo`; descripción sí.
  - `it('valida residual')`: residual ≥ origen → `El valor residual debe ser menor que el valor de origen`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (el test de "anular factura con amortización" usa el endpoint de Task 4: escribirlo con `it.todo` aquí y completarlo en Task 4 — ver Task 4 Step 1). **Step 4:** PASS; `test/compras*` verdes.
- [ ] **Step 5:** commit `feat(bienes-uso): alta de bienes manual, inicial y desde la factura de proveedor`.

### Task 4: Amortización mensual, fecha de origen y cierre

**Files:**
- Create: `apps/api/src/bienes-uso/{amortizacion.service.ts,amortizacion.controller.ts}`
- Modify: `apps/api/src/contabilidad/asientos/asientos.service.ts` (`RenglonAsiento.fechaOrigen?: Date`; generar lo guarda; contraasiento lo copia), `apps/api/src/contabilidad/ajuste-inflacion/ajuste-inflacion.service.ts` (agrupar por `COALESCE(r."fechaOrigen", a."fecha")`), `apps/api/src/contabilidad/cierre/cierre-ejercicio.service.ts` (faltante de amortización)
- Test: `apps/api/test/bienes-amortizacion.e2e-spec.ts`

**Interfaces — Produces:** `AmortizacionService.previa(mes, tx?)`, `.generar(mes)`, `.anular(id)`, `.listar()`; `AmortizacionService.pendienteHasta(tx, bienId, mes): Promise<Dec>` (esperada − contabilizada) usada por bajas y ventas; `faltanteCierre(tx, ejercicio): Promise<string | null>`.

- [ ] **Step 1: Tests que fallan:**
  - `it('previa y generar del ejemplo')`: rodado 2026-03-15 → `previa?mes=2026-09` total `'140000.00'`; `POST {mes:'2026-09'}` → asiento fecha 2026-09-30, debe `5.2.07` 140.000 / haber `1.2.02.002`, renglones con `fechaOrigen` 2026-03-01; `previa 2026-09` total `'0.00'`; `POST` de nuevo → `No hay amortizaciones para contabilizar en 09/2026`.
  - `it('bien cargado tarde')` (Review Focus 1): generar 2026-09; alta de otro bien con fecha 2026-08-10 (muebles 120.000, 120 meses) → re-generar 2026-09 agrega `'2000.00'` (agosto y septiembre); `previa 2026-10` = `'21000.00'`.
  - `it('anular solo la última')` (Review Focus 2): generar 09 y 10; anular 09 → `Solo se puede anular la última amortización generada`; anular 10 y regenerar 10 → total `'20000.00'`; generar 08 con 10 vigente → `Ya hay una amortización generada para un mes posterior: 10/2026`.
  - `it('ajuste por inflación reexpresa desde el mes de alta')`: índices 2026-01..11 crecientes (100, 101, …), configuración del ajuste (helper `helpers-ajuste.ts`); bien con alta en marzo amortizado en septiembre → la vista previa del ajuste a 2026-09-30 reexpresa el renglón de `1.2.02.002` con I(09)/I(03), no con 1.
  - `it('cierre exige la amortización del mes de cierre')`: empresa con un bien y el ejercicio listo para cerrar salvo la amortización → `Genere la amortización de bienes de uso de 12/2026`; sin bienes → no lo exige (`contabilidad-cierre-ejercicio` sigue verde).
  - completar `it('anular factura')` de Task 3 (rama con amortización).
- [ ] **Step 2:** FAIL. **Step 3:** implementar (asiento tipo `AUTOMATICO`, `origenTipo 'AMORTIZACION'`, `origenId` = id del proceso). **Step 4:** PASS; `test/ajuste*` y `test/contabilidad*` verdes.
- [ ] **Step 5:** commit `feat(bienes-uso): amortización mensual con fecha de origen y requisito de cierre`.

### Task 5: Bajas y venta por comprobante

**Files:**
- Create: `apps/api/src/bienes-uso/bajas.service.ts` (+ rutas en `bienes.controller.ts`)
- Modify: `apps/api/src/ventas/comprobantes/{dto.ts,comprobantes.service.ts}` (`bienUsoId` en renglón, cuenta `RESULTADO_VENTA_BIENES_USO`, validaciones en `preparar`), `apps/api/src/ventas/emision/emision.service.ts` (validar en `emitir` antes de ARCA; baja en `autorizar`), `apps/api/src/informes/fuentes/ventas.ts` (excluir renglones con `bienUsoId`)
- Test: `apps/api/test/bienes-bajas.e2e-spec.ts`

**Interfaces:**
- Consumes: `pendienteHasta` (Task 4), `amortizadoVigente` (Task 3).
- Produces: `BajasService.validarBaja(tx, bienId, fecha): Promise<BienUso>` (todas las reglas §5, lanza 400); `BajasService.registrarBaja(tx, bien, fecha, motivo, cuentaResidualId, comprobanteVentaRenglonId?)`; endpoints `POST /api/bienes-uso/:id/baja`, `POST /api/bienes-uso/:id/baja/anular`.

- [ ] **Step 1: Tests que fallan:**
  - `it('venta del ejemplo')`: rodado amortizado a 09/2026; factura de venta 2026-10-15 con renglón `{ bienUsoId, descripcion: 'Camioneta', cantidad: 1, precioUnitario: 1100000, alicuota: 21 }` emitida → bien `BAJA` motivo `VENTA`; saldo `4.2.05` = `-40000.00` (acreedor); saldo `1.2.01.002` = `0.00`; saldo `1.2.02.002` = `0.00`; informe de ventas de octubre sin ese renglón.
  - `it('venta sin la amortización previa')`: rodado amortizado a 08/2026, venta 2026-10-15 → al guardar 400 `Genere primero la amortización de 09/2026`.
  - `it('bien en dos comprobantes')`: guardar dos borradores con el mismo bien → el segundo 400 `El bien N° 1 ya está en otro comprobante`; NC con `bienUsoId` → `Una nota de crédito no puede vender un bien de uso`.
  - `it('rechazo de ARCA deja el bien activo')` (Review Focus 3): comprobante con el bien rechazado (`RECHAZADO` por el simulador o actualizando estado como en `informes-ventas`) → bien `ACTIVO` y se puede vender en otro comprobante.
  - `it('baja manual y anulación')`: baja 2026-10-15 `DESUSO` → asiento debe `1.2.02.002` 140.000, debe `5.2.08` 1.060.000, haber `1.2.01.002` 1.200.000, renglones con `fechaOrigen` 2026-03-01; anular → bien `ACTIVO`; baja con amortización posterior generada → `El bien tiene amortizaciones posteriores a la baja`.
  - `it('vida útil cumplida')` (Review Focus 4): bien 3.600, 36 meses, alta 2023-01-10 como carga inicial con amortización total a 2025-12-31 → previa 2026-10 sin el bien; baja → `5.2.08` sin importe (renglón omitido) y asiento cuadrado.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; `test/ventas*` e `test/informes*` verdes.
- [ ] **Step 5:** commit `feat(bienes-uso): bajas y venta de bienes por comprobante`.

### Task 6: Planilla anexa

**Files:**
- Create: `apps/api/src/bienes-uso/planilla.service.ts` (+ ruta `GET /api/bienes-uso/planilla` en `bienes.controller.ts`, declarada antes de `:id`)
- Test: `apps/api/test/bienes-planilla.e2e-spec.ts`

**Interfaces — Produces:** `{ ejercicio, fecha, aviso?, filas: [{ rubroId, rubro, origenInicio, altas, bajas, origenCierre, amortInicio, amortBajas, amortEjercicio, amortCierre, neto }], totales, control: { origen, amortizacion } }`; xlsx/pdf con `tablaXlsx`/`tablaPdf` (`src/contabilidad/consultas/exportar.ts`).

- [ ] **Step 1: Tests que fallan:**
  - `it('planilla del ejemplo coincide con el Mayor')` (Review Focus 5): rodado alta 2026-03 amortizado a 09; muebles 120.000 alta 2026-08; venta del rodado 2026-10-15; amortización de muebles a 10 → planilla a 2026-10-31: Rodados `{ origenInicio '0.00', altas '1200000.00', bajas '-1200000.00', origenCierre '0.00', amortEjercicio '140000.00', amortBajas '-140000.00', amortCierre '0.00', neto '0.00' }`; Muebles `{ altas '120000.00', amortEjercicio '3000.00', neto '117000.00' }`; `control { origen: '0.00', amortizacion: '0.00' }`.
  - `it('carga inicial al inicio del ejercicio')`: bien inicial alta 2024-01 con amortización a 2025-12 → `origenInicio` = valor, `amortInicio` = inicial.
  - `it('reexpresada')`: sin índices → `aviso` `Faltan los índices de: …`; con índices 03/2026 = 100 y 10/2026 = 110 → altas de Rodados `'1320000.00'`.
  - `it('exporta')`: xlsx y pdf (content-type); `bienes.ver` requerido (403 sin él).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; suite API completa verde (`timeout 590 npx jest --runInBand`, o en dos mitades con `--shard`).
- [ ] **Step 5:** commit `feat(bienes-uso): planilla anexa de bienes de uso`.

### Task 7: Web

**Files:**
- Create: `apps/web/src/bienes-uso/{RubrosPage.tsx,BienesPage.tsx,AmortizacionPage.tsx,PlanillaBienesPage.tsx,comun.ts,bienes.test.tsx}`
- Modify: `apps/web/src/layout/menu.ts`, `apps/web/src/paginas/rutas.tsx`, la grilla de la factura de proveedor (`apps/web/src/compras/GrillaRenglones.tsx` / `FacturaProveedorPage.tsx`: campos del bien cuando la cuenta es de rubro), el renglón del comprobante de venta (`apps/web/src/ventas/ComprobanteVentaPage.tsx`: opción "Bien de uso")

**Interfaces — Produces:** rutas `/maestros/rubros-bienes`, `/contabilidad/bienes`, `/contabilidad/bienes/:id`, `/contabilidad/amortizacion`, `/contabilidad/planilla-bienes`; menú: Maestros "Rubros de bienes de uso" (`bienes.gestionar`), Registraciones → Contabilidad General "Bienes de uso" (`bienes.ver`) y "Amortización del mes" (`contabilidad.cerrar`), Consultas → Contabilidad General "Planilla de bienes de uso" (`bienes.ver`). Exportados para test: `TablaPlanilla({ datos })`, `CamposBien({ rubro, valor, onChange })`, `VistaPreviaAmortizacion({ datos })`.

- [ ] **Step 1: Tests que fallan** (`bienes.test.tsx`):
  - `TablaPlanilla` con dos rubros → fila `Total` con la suma de `neto` (`$ 117.000,00`) y alerta "Coincide con el Mayor" si el control es 0, si no "Diferencia con el Mayor: $ …".
  - `CamposBien` con rubro Rodados → campo "Vida útil (meses)" precargado con `60`.
  - `VistaPreviaAmortizacion` → total por rubro y botón "Generar" deshabilitado si el total es 0.
  - menú: con `bienes.ver` aparece "Planilla de bienes de uso"; sin permisos no.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS; suite web y `pnpm --filter web build`.
- [ ] **Step 5:** commit `feat(web): bienes de uso, amortización y planilla`.

### Task 8: E2E, demo y README

**Files:** Create `e2e/bienes-uso.spec.ts`; Modify `README.md`, `apps/api/src/seed/demo.ts` si hace falta un proveedor/cuenta para el e2e.

- [ ] **Step 1: Test** `test('bienes de uso: factura con rodado, amortización del mes y planilla')`: login contador; factura de proveedor con renglón a "Rodados" cargando "Camioneta" (fecha = hoy); `/contabilidad/amortizacion` del mes actual → Generar → "Amortización generada"; `/contabilidad/planilla-bienes` muestra "Rodados" y "Coincide con el Mayor".
- [ ] **Step 2:** recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 13/13.
- [ ] **Step 3:** README sección "Bienes de uso (Entrega 14)".
- [ ] **Step 4:** suites API, web y e2e verdes.
- [ ] **Step 5:** commit `test(e2e): bienes de uso; docs: README entrega 14`.
