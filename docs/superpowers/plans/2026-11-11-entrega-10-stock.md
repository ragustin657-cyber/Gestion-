# Entrega 10 — Stock: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stock por depósito con kardex, costo promedio ponderado móvil por artículo, integración con recepción/factura de compra y emisión/NC de venta, documentos internos, consultas y su contabilización.

**Architecture:** módulo `apps/api/src/stock/` con un motor único (`moverStock`) que todos los circuitos llaman dentro de su transacción; cada circuito arma su propio asiento con los importes que devuelve el motor. Las consultas leen el kardex. Web: pantallas nuevas en `apps/web/src/stock/` y campos nuevos en formularios existentes.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL 16), Zod, exceljs/pdfkit (`tablaXlsx`/`tablaPdf`); React 19 + Mantine 7 + TanStack Query; Jest/supertest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-entrega-10-stock-design.md` (§N = sección del spec).

## Global Constraints

- Mensajes y textos de UI en español, **exactamente** como los fija el spec.
- Importes `Prisma.Decimal` (`D`/`Dec` de `contabilidad/consultas/saldos.ts`): cantidades 4 decimales, costo unitario 6, importes 2. Sin `Number` en cálculos de costo.
- Modelos nuevos de empresa en `MODELOS_DE_EMPRESA`; `bloquear()` suma `'Articulo' | 'SaldoStock' | 'DocumentoStock'`.
- Migración con `prisma migrate diff` + SQL de datos; deploy a `gestion` y `gestion_test`; diff vacío.
- Reloj de pruebas 2026-11-06; fechas de prueba en noviembre 2026.
- Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` y `Claude-Session: https://claude.ai/code/session_01PUxLkCHXNYj9n2P64zhXBQ`.

## Review Focus

1. **Factura de compra en dólares de un artículo con stock** → la entrada / diferencia se valúa en pesos con la cotización del comprobante. Prueba en Task 4 (`factura directa en USD`).
2. **Anular una recepción cuando parte de ese stock ya se vendió** → con BLOQUEAR, 400 de stock insuficiente; con AVISAR, queda negativo. Prueba en Task 4.
3. **Una factura de venta con dos renglones del mismo artículo** → el control suma ambos renglones contra el saldo. Prueba en Task 5.
4. **Desactivar "Controla stock" en un artículo con movimientos** → 400. Prueba en Task 1.
5. **Venta de un artículo que no controla stock (o servicio)** → no mueve stock ni genera asiento de costo. Prueba en Task 5.

---

### Task 1: Esquema, migración, cuentas, permisos y maestros

**Files:**
- Modify: `apps/api/prisma/schema.prisma`; `apps/api/src/prisma/modelos-empresa.ts`; `apps/api/src/compras/comun.ts` (union de `bloquear`); `apps/api/src/seed/plan-cuentas-modelo.ts`; `apps/api/src/compras/config/conceptos.ts`; `packages/shared/src/permisos.ts`; `apps/api/src/seed/demo.ts` (roles); `apps/api/src/articulos/*`; `apps/api/src/empresas/*` (puntos de venta)
- Create: `apps/api/prisma/migrations/20261112090000_stock/migration.sql`; `apps/api/src/stock/{stock.module.ts,config-stock.service.ts,stock.controller.ts}`
- Test: `apps/api/test/stock-maestros.e2e-spec.ts`

**Interfaces — Produces:**
- Modelos de §2 (`SaldoStock`, `MovimientoStock`, `DocumentoStock`, `DocumentoStockRenglon`, `ConfigStock`), enums `TipoMovimientoStock`, `TipoDocumentoStock { TRANSFERENCIA INVENTARIO INICIAL SALIDA }`, `EstadoDocumentoStock { CONFIRMADO ANULADO }`, `ModoStockNegativo { BLOQUEAR AVISAR }`.
- Campos: `Articulo.controlaStock/stockCantidad/stockValor/costoPromedio`; `PuntoVenta.depositoId`; `ComprobanteVenta.depositoId/devuelveMercaderia`; `ComprobanteCompra.depositoId`; `InformeRecepcion.asientoId/asientoAnulacionId`.
- Conceptos `MERCADERIAS '1.1.05.001'`, `MERCADERIA_A_FACTURAR '2.1.01.003'`, `SOBRANTES_INVENTARIO '4.2.04'`, `FALTANTES_INVENTARIO '5.2.06'`, `COSTO_MERCADERIAS_VENDIDAS '5.1.01'`.
- Permisos `'stock.ver': 'Ver existencias, kardex y valuación'`, `'stock.operar': 'Registrar movimientos de stock y configurarlo'`; roles demo: Contador ambos, Comprador y Facturación `stock.ver`; Administrador ya tiene todos.
- `ConfigStockService.modo(tx): Promise<'BLOQUEAR' | 'AVISAR'>` (sin fila → `BLOQUEAR`); `GET/PUT /api/stock/config { stockNegativo }`.
- `PATCH /api/empresas/actual/puntos-venta/:id { depositoId: uuid | null }` (permiso `empresa.administrar`); el GET devuelve `depositoId`.
- Artículos: alta/modificación aceptan `controlaStock`; la respuesta incluye los campos de stock.

- [ ] **Step 1: Tests que fallan** (`stock-maestros.e2e-spec.ts`, `sesionConPlan`):
  - `it('plan modelo con cuentas y conceptos de stock')`: existen 1.1.05.001 (`monetaria false`), 2.1.01.003 (`true`), 4.2.04, 5.2.06; `GET /api/compras/config` `cuentas` contiene los 5 conceptos nuevos.
  - `it('controla stock en artículos')`: alta con `controlaStock: true` → 201 y `stockCantidad '0'`; servicio con `controlaStock: true` → 400 `Un servicio no controla stock`; tras crear con prisma un `MovimientoStock` del artículo, PATCH `controlaStock: false` → 400 `El artículo tiene movimientos de stock` (Review Focus 4).
  - `it('depósito por defecto del punto de venta')`: PATCH con un depósito → GET lo muestra; depósito inexistente → 400 `Depósito inexistente`.
  - `it('configuración de stock')`: GET → `{ stockNegativo: 'BLOQUEAR' }`; PUT `AVISAR` → GET `AVISAR`; usuario sin `stock.operar` → 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** esquema, migración (SQL de datos: cuentas donde exista la madre `1.1` / `2.1.01` / `4.2` / `5.2` y no el código — `1.1.05` rubro no imputable con `1.1.05.001` debajo —, `monetaria=false` para `1.1.05%`, conceptos en `ConfigCuenta` como en la entrega 9), plan modelo (`monetariaPorDefecto` suma `1.1.05`), conceptos, permisos, roles demo, endpoints. Actualizar los tests que cuentan conceptos (28 → 33) y las cuentas del plan modelo.
- [ ] **Step 4:** PASS + suite e2e completa verde.
- [ ] **Step 5:** commit `feat(stock): modelos, cuentas, permisos y configuración de stock`.

### Task 2: Motor de stock, inventario inicial y salida manual

**Files:**
- Create: `apps/api/src/stock/motor.ts`, `apps/api/src/stock/documentos/{documentos.service.ts,documentos.controller.ts,dto.ts}`
- Create: `apps/api/test/helpers-stock.ts`
- Test: `apps/api/test/stock-motor.e2e-spec.ts`

**Interfaces — Produces:**
```ts
// motor.ts
export interface Movimiento { fecha: Date; articuloId: string; depositoId: string | null; cantidad: Dec; costoUnitario?: Dec; tipo: TipoMovimientoStock; origenTipo: string; origenId: string; origenRenglonId?: string | null; anulaAId?: string | null }
export interface Resultado { id: string; importe: Dec; costoUnitario: Dec; regularizacion: Dec; advertencia?: string }
@Injectable() export class MotorStock { mover(tx: TxEmpresa, m: Movimiento): Promise<Resultado>; moverVarios(tx, ms: Movimiento[]): Promise<Resultado[]> /* ordena por articuloId, depositoId y llama mover */ }
```
`regularizacion` = importe del movimiento `REGULARIZACION` generado (0 si no hubo); el llamador lo lleva a Costo de mercaderías vendidas. Algoritmo exacto: §3 pasos 1–6, con esta precisión para la salida que supera el stock positivo: importe = −stockValor − exceso × costoPromedio (el valor queda negativo en exceso × promedio).
- `DocumentosStockService.crear(d)`, `anular(id, motivo)`, `listar(q)`, `obtener(id)`; `POST /api/stock/documentos` con `tipo` discriminado; asientos `origenTipo 'DOC_STOCK'`.
- `helpers-stock.ts`: `prepararStock(app, prisma)` → `{ s, deposito, deposito2, articulo(codigo?, controlaStock = true), inicial(articuloId, cantidad, costo, depositoId?), salida(articuloId, cantidad, depositoId?), modo(m) }` sobre `sesionConPlan` + `datosCompras`.

- [ ] **Step 1: Tests que fallan:**
  - `it('inicial y salida al promedio')`: inicial 100 @ 10 y 50 @ 13 (`conAsiento: true`, cuenta 3.2.01) → artículo `stockCantidad '150'`, `stockValor '1650'`, `costoPromedio '11'`; asiento Mercaderías D 1000 / 3.2.01 H 1000. Salida manual 30 a 5.2.01 → movimiento importe `-330.00`, asiento 5.2.01 D 330 / Mercaderías H 330.
  - `it('la salida que agota el stock deja el valor en cero')`: inicial 3 @ 10 y 3 @ 10.01 (valor 60.03), salidas de 1, 1, 4 → último importe = `-` valor restante; `stockValor '0'`.
  - `it('bloquea el stock negativo')`: inicial 10; salida 12 → 400 `Stock insuficiente de ART-1 en Central: hay 10, se piden 12`.
  - `it('permite con aviso y regulariza al entrar')`: modo AVISAR; inicial 10 @ 10; salida 12 → 201 con `advertencias: ['Stock insuficiente de ART-1 en Central: hay 10, se piden 12']`, stock −2, valor −20; inicial 5 @ 12 → stock 3, valor `36.00`, movimiento `REGULARIZACION` importe `-4.00` (valor previo −20 + 60 = 40 → forzado a 36), asiento del documento con Costo de mercaderías vendidas D 4 / Mercaderías H 4 además de Mercaderías D 60 / 3.2.01 H 60.
  - `it('inicial sin asiento')`: `conAsiento: false` → sin asiento, movimientos creados.
  - `it('anula un documento con el costo original')`: inicial 10 @ 10, salida 4, anular la salida → entrada `+4` importe `40.00` con `anulaAId`; contraasiento; anular dos veces → 409 `El documento ya está anulado`.
  - `it('dos salidas simultáneas sobre el último stock')`: 4 rondas; inicial 5; `Promise.all` de dos salidas de 5 → un 201 y un 400 de stock insuficiente; `stockCantidad '0'`.
  - Validaciones: artículo sin `controlaStock` → 400 `El artículo ART-2 no controla stock`; inicial con `conAsiento` sin cuenta → 400 `Indique la cuenta contable`.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar motor y documentos INICIAL/SALIDA. - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(stock): motor de costo promedio, inventario inicial y salida manual`.

### Task 3: Transferencias e inventario físico

**Files:** Modify `apps/api/src/stock/documentos/*`; Test `apps/api/test/stock-documentos.e2e-spec.ts`

- [ ] **Step 1: Tests que fallan:**
  - `it('transfiere sin cambiar el costo')`: inicial 10 @ 10 en Central; transferencia 4 a Sucursal → saldos 6 / 4, valor total 100, sin asiento; destino igual al origen → 400 `El depósito de destino debe ser distinto del de origen`; transferir 11 → 400 de stock insuficiente.
  - `it('inventario físico con sobrante y faltante')`: A: inicial 10 @ 10; B: inicial 5 @ 20; inventario en Central contado A 12, B 4 → movimientos A +2 importe 20, B −1 importe −20; asiento Mercaderías D 20 / Sobrantes H 20 y Faltantes D 20 / Mercaderías H 20. Renglón sin diferencia no genera movimiento.
  - `it('sobrante de un artículo sin costo')`: artículo nuevo, contado 3 → 400 `El artículo ART-3 no tiene costo: cárguelo con inventario inicial`.
  - `it('lista y anula')`: `GET /api/stock/documentos?tipo=TRANSFERENCIA` devuelve el documento con número; anular la transferencia devuelve los saldos.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(stock): transferencias e inventario físico`.

### Task 4: Compras

**Files:** Modify `apps/api/src/compras/recepciones/recepciones.service.ts`, `apps/api/src/compras/comprobantes/{comprobantes.service.ts,dto.ts}`; Create `apps/api/src/stock/compras-stock.ts`; Test `apps/api/test/stock-compras.e2e-spec.ts`

**Interfaces — Produces:** `repartir(tx, articuloId, cantidad: Dec, diferenciaPesos: Dec): Promise<{ aStock: Dec; aCosto: Dec }>` (usa `stockCantidad` actual bajo bloqueo; `aStock = round(d × min(max(stock,0), cantidad) / cantidad, 2)`, `aCosto = d − aStock`).
Decisión de asientos (el spec deja el armado abierto): la factura conserva su asiento; los renglones de artículos con stock van con recepción a `MERCADERIA_A_FACTURAR` y sin recepción a `MERCADERIAS`. Un asiento aparte `origenTipo 'STOCK_COMPRA'` (mismo `origenId`) registra: para diferencias de recepción `aStock` a Mercaderías + `aCosto` a CMV contra Mercadería recibida a facturar (signos según `d`); para NC/ND y para el `aCosto` de factura directa, el traspaso Mercaderías ↔ CMV. La anulación de la factura contraasienta también este asiento y revierte los movimientos.

- [ ] **Step 1: Tests que fallan** (OC con `ocAprobada` sobre un artículo `controlaStock`):
  - `it('la recepción exige depósito y entra al precio de la OC')`: sin depósito → 400 `Indique el depósito: hay artículos que controlan stock`; con depósito, OC 100 @ 10 bonif 0 → artículo 100 / 1000; asiento Mercaderías D 1000 / Mercadería recibida a facturar H 1000; recepción de artículo sin stock → sin asiento.
  - `it('factura con diferencia de precio, stock completo')`: factura del IR 100 @ 11 → asiento de la factura con 2.1.01.003 D 1100; asiento STOCK_COMPRA Mercaderías D 100 / 2.1.01.003 H 100; artículo valor 1100, promedio 11.
  - `it('factura con parte vendida reparte la diferencia')`: tras recibir 100 @ 10, salida manual 60; factura 100 @ 11 → `AJUSTE_COSTO` importe 40.00, CMV D 60, artículo valor 440.
  - `it('factura directa con depósito')`: sin depósito → 400; 50 @ 13 con depósito → entrada 650, renglón a Mercaderías.
  - `it('factura directa en USD')` (Review Focus 1): 10 @ USD 2 con cotización 1000 → entrada importe `20000.00`, costo unitario 2000.
  - `it('nota de crédito de compra ajusta costo')`: stock 100 @ 10, NC directa del artículo neto 50 → `AJUSTE_COSTO` −50, valor 950; asiento de la NC con Mercaderías H 50.
  - `it('anular la recepción con stock vendido')` (Review Focus 2): recibir 10, salida 8, anular IR → 400 stock insuficiente; con AVISAR → 200, stock −8 (quedaban 2, salen 10) y contraasiento.
  - `it('anular la factura revierte stock y asientos')`: factura directa 50 @ 13 anulada → stock 0 / valor 0; contraasientos de COMPRA y STOCK_COMPRA si existía.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS; suites `test/compras*` y `test/pagos*` verdes.
- [ ] **Step 5:** commit `feat(stock): recepción y facturas de compra mueven stock`.

### Task 5: Ventas

**Files:** Modify `apps/api/src/ventas/comprobantes/{comprobantes.service.ts,dto.ts}`, `apps/api/src/ventas/emision/emision.service.ts`; Create `apps/api/src/stock/ventas-stock.ts`; Test `apps/api/test/stock-ventas.e2e-spec.ts`

**Interfaces — Produces:** `VentasStock.controlar(tx, c): Promise<string[]>` (al crear/modificar; suma cantidades por artículo; con BLOQUEAR lanza; con AVISAR devuelve advertencias) y `VentasStock.alEmitir(tx, comprobante, fechaAsiento): Promise<string[]>` (llamado en `autorizar` antes de `alAutorizar`; genera movimientos y asiento `COSTO_VENTA`). Los comprobantes devuelven `advertencias` al crear cuando las hay. DTO suma `depositoId?` y `devuelveMercaderia?` (solo en NOTA_CREDITO; en otro tipo → 400 `Solo las notas de crédito devuelven mercadería`).

- [ ] **Step 1: Tests que fallan** (`prepararVentas` + `prepararStock`, renglón con `articuloId`):
  - `it('toma el depósito del punto de venta')`: PV con depósito; factura sin `depositoId` → guarda el del PV; sin ninguno → 400 `Indique el depósito: hay artículos que controlan stock`.
  - `it('controla al crear y descuenta al emitir con asiento de costo')`: inicial 10 @ 10; factura 12 → 400; factura 4 emitida → stock 6; asiento `COSTO_VENTA` 5.1.01 D 40 / Mercaderías H 40.
  - `it('suma renglones del mismo artículo')` (Review Focus 3): inicial 5; factura con dos renglones de 3 → 400 `... hay 5, se piden 6`.
  - `it('con aviso emite igual')`: AVISAR; factura 12 sobre 10 → 201 con `advertencias`, stock −2.
  - `it('nota de crédito con devolución vuelve al costo de salida')`: inicial 3 @ 10 y 3 @ 20 → factura 4 (costo 60.00, unitario 15) → inicial 10 @ 30 (promedio cambia) → NC asociada con devolución 1 → entrada importe `15.00`; asiento COSTO_VENTA inverso; devolver 5 → 400 `No se puede devolver más de lo vendido de ART-1`; NC sin devolución → sin movimiento.
  - `it('no mueve stock de servicios ni artículos sin control')` (Review Focus 5): factura con un artículo sin `controlaStock` → sin movimientos ni asiento `COSTO_VENTA`.
  - `it('devuelveMercaderia solo en notas de crédito')`.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS; `test/ventas*` y `test/arca*` verdes.
- [ ] **Step 5:** commit `feat(stock): ventas descuentan stock y registran el costo`.

### Task 6: Consultas y ejemplo completo

**Files:** Create `apps/api/src/stock/consultas/{consultas-stock.service.ts,consultas-stock.controller.ts}`; Test `apps/api/test/stock-consultas.e2e-spec.ts`

**Interfaces — Produces:** endpoints de §7 con `formato=xlsx|pdf`. Respuestas:
- existencias: `{ filas: [{ articuloId, codigo, descripcion, unidad, depositos: [{ depositoId, nombre, cantidad }], cantidad, costoPromedio, valor }], total }`;
- kardex: `{ articulo, saldoInicial: { cantidad, valor }, movimientos: [{ id, fecha, tipo, documento, entrada, salida, saldoCantidad, costoUnitario, importe, saldoValor }] }` (`saldoValor` null con filtro de depósito; `documento` legible: `IR 0001-00000003`, `Factura A 00001-00000012`, `Transferencia N° 4`, etc.);
- valuación: `{ fecha, filas: [{ articuloId, codigo, descripcion, cantidad, valor }], total, mayor, control }`.

- [ ] **Step 1: Tests que fallan:**
  - `it('reproduce el ejemplo del spec')` con el circuito real (OC 100 @ 10 → IR → factura 100 @ 11 → factura directa 50 @ 13 → venta 120 emitida → NC con devolución 10): artículo stock 40, valor `466.67`, promedio `11.66675`; kardex con los 5 movimientos de la tabla de §3 (importes `1000.00`, `100.00`, `650.00`, `-1400.00`, `116.67`) y `saldoValor` final `466.67`; valuación al 2026-11-30 `total '466.67'`, `mayor '466.67'`, `control '0.00'`; saldo de 5.1.01 = `1283.33`.
  - `it('existencias por depósito')`: 2 depósitos, transferencia → filas con las dos cantidades; `soloConStock` filtra.
  - `it('kardex con saldo inicial')`: `desde` posterior al primer movimiento → `saldoInicial` correcto.
  - `it('exporta a Excel y PDF')`: `content-type` correcto.
  - Permiso: usuario sin `stock.ver` → 403.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(stock): existencias, kardex y valuación`.

### Task 7: Web

**Files:**
- Create: `apps/web/src/stock/{DocumentoStockPage.tsx,DocumentosStockPage.tsx,ExistenciasPage.tsx,KardexPage.tsx,ValuacionPage.tsx,ConfigStockPage.tsx,stock.test.tsx}`
- Modify: `apps/web/src/layout/menu.ts` (+ `menu.test.ts`), `apps/web/src/paginas/rutas.tsx`, `apps/web/src/paginas/ArticulosPage.tsx`, la página de puntos de venta (`EmpresaPage.tsx`), el formulario de factura de compra (`apps/web/src/compras/…`), el de comprobante de venta (`apps/web/src/ventas/…`)

**Interfaces — Produces:** rutas `/stock/transferencia`, `/stock/inventario`, `/stock/inicial`, `/stock/salida` (una página `DocumentoStockPage` con `tipo` por prop), `/stock/documentos`, `/stock/existencias`, `/stock/kardex`, `/stock/valuacion`, `/admin/stock`. Menú: Registraciones › Stock (`stock.operar`), Consultas › Stock (`stock.ver`), Administración › Configuración de stock (`stock.operar`). Componentes exportados para test: `GrillaInventario({ renglones, saldos })`, `TablaKardex({ kardex })`, `ControlValuacion({ valuacion })`.

- [ ] **Step 1: Tests que fallan** (`stock.test.tsx`):
  - `GrillaInventario` con saldo 10 y contado 12 → muestra `+2`; contado 9 → `-1`.
  - `TablaKardex` con el kardex del ejemplo → muestra `$ 466,67` como saldo final y `-$ 1.400,00` en la venta (formato `formatoMoneda`).
  - `ControlValuacion` con `control '0.00'` → `Coincide con el Mayor`; con `'10.00'` → `Diferencia con el Mayor: $ 10,00`.
  - `menu.test.ts`: con `stock.ver` aparece `Existencias`; sin permisos no.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar páginas y campos: artículo (`Controla stock`, columnas Stock/Costo promedio), punto de venta (`Depósito por defecto`), factura de compra (`Depósito`), comprobante de venta (`Depósito`, `Con devolución de mercadería` en NC, alerta con `advertencias`).
- [ ] **Step 4:** PASS; `pnpm --filter web build` sin errores.
- [ ] **Step 5:** commit `feat(web): stock`.

### Task 8: Demo, E2E y README

**Files:** Modify `apps/api/src/seed/demo.ts` (LAM-LED `controlaStock: true`; PV con depósito central); Create `e2e/stock.spec.ts`; Modify `README.md`

- [ ] **Step 1: Test** `test('stock: el contador carga inventario inicial, factura una venta y ve existencias y valuación')`: login contador; `/stock/inicial` LAM-LED 100 @ 1500 con asiento a 3.2.01 → `Documento N° 1`; login facturación: factura de 30 LAM-LED emitida; login contador: `/stock/existencias` muestra 70; `/stock/valuacion` muestra `Coincide con el Mayor`.
- [ ] **Step 2:** recrear `gestion_e2e` y `pnpm e2e -- --trace off` → 10/10.
- [ ] **Step 3:** README sección Entrega 10.
- [ ] **Step 4:** suites completas API, web, e2e verdes.
- [ ] **Step 5:** commit `test(e2e): stock; docs: README entrega 10`.
