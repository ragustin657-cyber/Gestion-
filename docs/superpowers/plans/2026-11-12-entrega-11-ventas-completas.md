# Entrega 11 — Ventas completas: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** listas de precios con aumento masivo e importación, pedidos de venta con estado de presupuesto, remitos que mueven stock y registran el costo, y facturación desde remitos y pedidos.

**Architecture:** módulos nuevos `apps/api/src/ventas/{precios,pedidos,remitos}/` siguiendo el patrón de compras (OC → recepción → factura). El remito usa el motor de stock de la Entrega 10. La factura de venta acepta renglones con origen REMITO/PEDIDO; las cantidades facturadas se registran al autorizar. Web: pantallas nuevas en `apps/web/src/ventas/`.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL 16), Zod, exceljs, pdfkit; React 19 + Mantine 7; Jest/supertest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-entrega-11-ventas-completas-design.md` (§N = sección del spec).

## Global Constraints

- Mensajes y textos de UI en español, exactamente como los fija el spec.
- Importes con `Prisma.Decimal`; precios Decimal(18,4); cantidades Decimal(18,4); importes 2 decimales.
- Modelos nuevos de empresa en `MODELOS_DE_EMPRESA`; `bloquear()` suma `'PedidoVenta' | 'PedidoVentaRenglon' | 'Remito' | 'RemitoRenglon'`.
- Orden de bloqueo: renglones de pedido/remito → artículos (stock) → asiento (período y numeración).
- Migración con `prisma migrate diff` + deploy a `gestion` y `gestion_test`; diff vacío.
- Reloj de pruebas 2026-11-06; fechas de prueba en noviembre 2026.
- Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` y `Claude-Session: https://claude.ai/code/session_01PUxLkCHXNYj9n2P64zhXBQ`.

## Review Focus

1. **Factura de remito rechazada por ARCA o borrador eliminado** → lo pendiente de facturar del remito queda intacto. Prueba en Task 5.
2. **Dos facturas en borrador sobre el mismo remito, emitidas una tras otra** → la segunda se rechaza antes del CAE (prevalidar). Prueba en Task 5.
3. **Remito de un pedido en dólares** → el remito no tiene precios; la factura toma el precio que se cargue (sugerido por la lista convertido). Prueba en Task 5 (`factura de un remito en USD`).
4. **Aumento masivo de una lista con 0 artículos elegidos o porcentaje 0** → 400 claro, sin tocar precios. Prueba en Task 2.
5. **Anular un remito de un pedido cerrado** → el remito se anula y lo entregado baja, pero el pedido sigue CERRADO. Prueba en Task 4.

---

### Task 1: Esquema, permisos y lista en clientes

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/prisma/modelos-empresa.ts`, `apps/api/src/compras/comun.ts`, `packages/shared/src/permisos.ts`, `apps/api/src/seed/demo.ts` (roles), `apps/api/src/terceros/{dto.ts,terceros.service.ts}`
- Create: `apps/api/prisma/migrations/20261113090000_ventas_completas/migration.sql`
- Test: `apps/api/test/ventas-completas-maestros.e2e-spec.ts`

**Interfaces — Produces:** modelos de §2–§5 (`ListaPrecios`, `PrecioLista`, `HistorialPrecio` con enum `MotivoPrecio`, `PedidoVenta`, `PedidoVentaRenglon` con enum `EstadoPedido`, `Remito`, `RemitoRenglon` con enum `EstadoRemito`), `Tercero.listaPreciosId`, `ComprobanteVentaRenglon.remitoRenglonId/pedidoRenglonId`. Permisos `'precios.editar': 'Editar listas de precios'`, `'pedido.gestionar': 'Gestionar pedidos y remitos de venta'`; rol demo Facturación con ambos. Terceros: alta/modificación aceptan `listaPreciosId` (lista inexistente → 400 `Lista de precios inexistente`).

- [ ] **Step 1: Tests que fallan:** `it('el cliente tiene lista de precios')` (crear lista con prisma, PATCH tercero con `listaPreciosId` → GET lo devuelve; id inexistente → 400 con el mensaje) y `it('permisos nuevos existen')` (usuario con `pedido.gestionar` creado con `otroUsuario`; el login funciona y `PERMISOS['pedido.gestionar']` está definido).
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** esquema, migración, permisos, roles, terceros. - [ ] **Step 4:** PASS + suite e2e completa verde.
- [ ] **Step 5:** commit `feat(ventas): modelos de listas, pedidos y remitos`.

### Task 2: Listas de precios

**Files:** Create `apps/api/src/ventas/precios/{precios.service.ts,precios.controller.ts,dto.ts,aumento.ts,aumento.spec.ts,importacion.ts}`; registrar en `ventas.module.ts`; Test `apps/api/test/ventas-precios.e2e-spec.ts`

**Interfaces — Produces:**
- `aumentar(precio: Dec, porcentaje: number, redondeo: '0.01' | '1' | '10' | '100'): Dec` (pura; §2).
- `PreciosService.sugerido(tx, { terceroId, articuloId, monedaCodigo, cotizacion? }): Promise<{ precio: string | null; lista: { id; nombre } | null }>` — la usan pedidos y la web.
- Endpoints de §2.

- [ ] **Step 1: Tests que fallan:**
  - `aumento.spec.ts`: `aumentar(2500, 7.3, '10') = 2680`; `aumentar(1234.56, 10, '1') = 1358`; `aumentar(0.5, -90, '1') = 1`; `aumentar(100, 5, '0.01') = 105`.
  - e2e `it('una sola lista por defecto')`: crear A con `porDefecto`, crear B con `porDefecto` → A queda `false`.
  - e2e `it('precio, baja e historial')`: PUT 2500 → PUT 2600 → DELETE → historial `[MANUAL null→2500, MANUAL 2500→2600, BAJA 2600→null]` (orden de alta).
  - e2e `it('aumento masivo')`: dos artículos 2500 y 1000, `{ porcentaje: 7.3, redondeo: '10' }` → `{ actualizados: 2 }`, precios 2680 y 1070, historial `AUMENTO`; `articuloIds: []` → 400 `Elija al menos un artículo`; `porcentaje: 0` → 400.
  - e2e `it('importa todo o nada')`: csv `'Código;Precio\nART-1;1.234,50\nART-2;99'` → `{ creados: 2, actualizados: 0 }`, ART-1 `1234.5`; con `XX;5` en línea 2 → 400 `Línea 2: artículo inexistente` y nada cambia; xlsx de 2 filas también importa.
  - e2e `it('precio sugerido')`: lista del cliente; sin lista del cliente → la por defecto; lista USD precio 2, comprobante ARS cotización 1000 → `'2000.00'`; lista ARS 2500, comprobante USD cotización 1250 → `'2.00'`; artículo sin precio → `precio: null`.
  - e2e `it('no cambia la moneda con precios')` → 400 `La lista tiene precios: no se puede cambiar la moneda`.
  - Permisos: sin `precios.editar` PUT → 403; con `venta.ver` GET → 200.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar (importación con `exceljs` para xlsx; csv con `;` o `,`). - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(ventas): listas de precios con aumento e importación`.

### Task 3: Pedidos de venta

**Files:** Create `apps/api/src/ventas/pedidos/{pedidos.service.ts,pedidos.controller.ts,dto.ts,pdf-pedido.ts}`; Test `apps/api/test/ventas-pedidos.e2e-spec.ts`

**Interfaces — Produces:** `PedidosService.recalcularEstado(tx, pedidoId): Promise<void>` (lo usa remitos) y endpoints de §3. Respuesta del pedido con `renglones[].{cantidadEntregada, cantidadFacturada, pendienteEntregar, pendienteFacturar}`.

- [ ] **Step 1: Tests que fallan** (`prepararVentas` + `prepararStock` de las entregas anteriores):
  - `it('presupuesto editable y confirmación')`: POST → `PRESUPUESTO`, total con IVA como factura A (1 × 1000 + 21 % = 1210); PUT con versión correcta → 200; versión vieja → 409 `El pedido fue modificado por otro usuario: actualice la pantalla`; confirmar → `CONFIRMADO`; PUT → 400 `Solo se modifica un presupuesto`.
  - `it('avisa stock al confirmar')`: artículo con stock 5 en Central y pedido de 8 con depósito Central → `advertencias: ['Stock disponible de ART-1 en Central: 5, el pedido pide 8']`.
  - `it('cierra y anula')`: cerrar con motivo → `CERRADO`; anular otro presupuesto → `ANULADO`; anular un pedido con `cantidadEntregada > 0` (seteada con prisma) → 400 `El pedido tiene entregas o facturas: ciérrelo en vez de anularlo`.
  - `it('pdf con título según estado')`: `content-type` pdf; el texto del PDF (sin comprimir en test) contiene `Presupuesto` y luego de confirmar `Pedido de venta`.
  - `it('lista con filtros')`: `estado=CONFIRMADO` y `pendientes=entregar`.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar (PDF con el estilo de `pdf-venta.ts`). - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(ventas): pedidos de venta con presupuesto`.

### Task 4: Remitos

**Files:** Create `apps/api/src/ventas/remitos/{remitos.service.ts,remitos.controller.ts,dto.ts,pdf-remito.ts}`; Test `apps/api/test/ventas-remitos.e2e-spec.ts`

**Interfaces — Consumes:** `MotorStock.moverVarios`, `revertirOrigen`, `contabilizarRegularizacion`, `Partida` (Entrega 10), `ConfigStockService`, `PedidosService.recalcularEstado`. **Produces:** `ORIGEN_REMITO = 'REMITO'`, asiento `'COSTO_REMITO'`; endpoints de §4.

- [ ] **Step 1: Tests que fallan:**
  - `it('el circuito del criterio de éxito')`: inicial 100 @ 1500; pedido 30 confirmado; remito 20 → stock 80, asiento COSTO_REMITO 5.1.01 D 30000 / 1.1.05.001 H 30000; pedido `PARCIALMENTE_ENTREGADO`, renglón `cantidadEntregada '20'`; remito 10 → `ENTREGADO`; número `R 0001-00000002` en el PDF (texto).
  - `it('tope de entrega y cliente')`: remito 31 → 400 `La cantidad a entregar (31) supera lo pendiente del pedido (30)`; dos renglones de 20 del mismo renglón de pedido → 400 `... (40) supera lo pendiente del pedido (30)`; pedido de otro cliente → 400 `Todos los renglones deben ser del cliente indicado`; pedido en presupuesto → 400 `El pedido no está confirmado`.
  - `it('remito directo')`: sin pedido, artículo con stock → sale; artículo sin stock → sin movimiento.
  - `it('anula y devuelve stock y pedido')`: anular → stock 100, pedido `CONFIRMADO`, contraasiento; con un renglón facturado (prisma `cantidadFacturada`) → 400 `El remito tiene renglones facturados`.
  - `it('anular un remito de un pedido cerrado')` (Review Focus 5): pedido 30, remito 20, cerrar pedido, anular remito → 200, pedido sigue `CERRADO`, entregado `0`.
  - `it('dos remitos simultáneos por lo pendiente')`: 4 rondas, pedido 10, dos remitos de 10 a la vez → un 201 y un 400 de tope.
  - `it('pendientes de facturar')`: remito 20 → `GET /pendientes-facturar?terceroId` devuelve el renglón con pendiente `20`.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(ventas): remitos con salida de stock y costo`.

### Task 5: Facturación desde remitos y pedidos

**Files:** Modify `apps/api/src/ventas/comprobantes/{comprobantes.service.ts,dto.ts}`, `apps/api/src/ventas/emision/emision.service.ts`, `apps/api/src/stock/ventas-stock.ts`; Create `apps/api/src/ventas/comprobantes/origenes.ts`; Test `apps/api/test/ventas-facturar-remitos.e2e-spec.ts`

**Interfaces — Produces:** `OrigenesVenta.validar(tx, c): Promise<void>` (al crear/modificar y en `prevalidar`), `OrigenesVenta.registrar(tx, comprobanteId)` (en `autorizar`, incrementa `cantidadFacturada` de remito y pedido, con bloqueo); `VentasStock.alEmitir` ignora renglones con `remitoRenglonId`; `vendido()` suma los movimientos VENTA de los remitos vinculados; `GET /api/ventas/pendientes-facturar?terceroId`.

- [ ] **Step 1: Tests que fallan:**
  - `it('factura del remito no mueve stock ni registra costo')`: remito 20 (stock 80); factura con renglón `origen REMITO` 20 @ 2500 emitida → stock sigue 80, sin asiento `COSTO_VENTA`; remito `cantidadFacturada '20'`; pedido renglón `cantidadFacturada '20'`.
  - `it('tope de facturación')`: 21 → 400 `La cantidad a facturar (21) supera lo pendiente del remito (20)`.
  - `it('borrador eliminado o rechazado no consume')` (Review Focus 1): crear factura del remito sin emitir → remito `cantidadFacturada '0'`; eliminar el borrador → otra factura de 20 pasa.
  - `it('la segunda factura del mismo remito se rechaza antes del CAE')` (Review Focus 2): dos borradores de 20; emitir el primero → OK; emitir el segundo → 400 con el mensaje de tope y sin `numeroReservado`.
  - `it('desde pedido solo servicios')`: pedido con un servicio y un artículo con stock; renglón PEDIDO del servicio → 201; del artículo con stock → 400 `Los artículos que controlan stock se facturan desde un remito o como venta directa`.
  - `it('NC solo con renglones directos')` → 400 `Las notas de crédito y débito solo admiten renglones directos`.
  - `it('NC con devolución de una factura de remitos')`: NC con devolución de 5 sobre la factura del remito → entrada `DEVOLUCION_VENTA` costo 1500, importe `7500.00`; devolver 21 → 400 `No se puede devolver más de lo vendido de LAM-1`.
  - `it('factura de un remito en USD')` (Review Focus 3): factura USD cotización 1250 con renglón REMITO precio 2 → total USD 48.40 (20 × 2 + 21 %); sin movimiento de stock.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS; suites `test/ventas*`, `test/stock-*`, `test/arca*` verdes.
- [ ] **Step 5:** commit `feat(ventas): facturación desde remitos y pedidos`.

### Task 6: Web

**Files:**
- Create: `apps/web/src/ventas/{ListasPreciosPage.tsx,PedidoVentaPage.tsx,RemitoPage.tsx,PedidosRemitosPages.tsx,precios.ts,ventas-completas.test.tsx}`
- Modify: `apps/web/src/layout/menu.ts` (+ test), `apps/web/src/paginas/rutas.tsx`, `apps/web/src/paginas/TercerosPage.tsx` (lista de precios), `apps/web/src/ventas/ComprobanteVentaPage.tsx` (selector de pendientes y precio sugerido)

**Interfaces — Produces:** rutas `/maestros/listas-precios`, `/ventas/pedido` (y `/ventas/pedido?id=`), `/ventas/remito`, `/ventas/pedidos`, `/ventas/remitos`. Componentes y funciones exportados para test: `vistaPreviaAumento(precios: { codigo; precio }[], porcentaje, redondeo): { codigo; antes; despues }[]` (primeros 5, misma regla que `aumentar`), `TablaPendientes({ pendientes, seleccion, onChange })`, `usePrecioSugerido`.

- [ ] **Step 1: Tests que fallan:**
  - `vistaPreviaAumento([{ codigo: 'A', precio: '2500' }], 7.3, '10')` → `[{ codigo: 'A', antes: '2500', despues: '2680' }]`; con 7 artículos devuelve 5.
  - `TablaPendientes` con un renglón de remito pendiente 20 → muestra `R 0001-00000001` y `20`; tildar llama `onChange` con `{ [id]: '20' }`.
  - menú: con `pedido.gestionar` aparecen `Pedido de venta` y `Remito`; con `precios.editar` aparece `Listas de precios`.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar páginas y cambios de formularios. - [ ] **Step 4:** PASS; `pnpm --filter web build`.
- [ ] **Step 5:** commit `feat(web): listas de precios, pedidos y remitos`.

### Task 7: Demo, E2E y README

**Files:** Modify `apps/api/src/seed/demo.ts` (listas Minorista por defecto con precios de los artículos de la demo — LAM-LED 2500 — y Mayorista un 15 % menor); Create `e2e/ventas-completas.spec.ts`; Modify `README.md`

- [ ] **Step 1: Test** `test('ventas: pedido, remito parcial y factura del remito')`: login facturación; `/ventas/pedido` cliente demo, LAM-LED 30 (precio sugerido 2500 visible), Confirmar → `Pedido N° …`; `/ventas/remito` elegir el pedido, entregar 20 → `Remito R 0001-…`; `/ventas/comprobante` Agregar desde remitos, tildar, Emitir → autorizada; `/ventas/pedidos` muestra el pedido `Parcialmente entregado` con pendiente 10.
- [ ] **Step 2:** recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 11/11.
- [ ] **Step 3:** README sección Entrega 11.
- [ ] **Step 4:** suites API, web, e2e verdes.
- [ ] **Step 5:** commit `test(e2e): ventas completas; docs: README entrega 11`.
