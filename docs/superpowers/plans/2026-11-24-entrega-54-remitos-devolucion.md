# Entrega 54 — Remitos de devolución Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remitos de devolución desde remitos de entrega, con entrada de stock al costo de salida, pendientes de facturar y de acreditar, y notas de crédito desde devoluciones.

**Architecture:** `Remito.tipo` (`ENTREGA`/`DEVOLUCION`) y campos de seguimiento en los renglones; la creación y anulación de devoluciones en `remitos.service.ts` (método aparte `crearDevolucion`/`anularDevolucion` reusando motor, asiento y numeración); el origen `DEVOLUCION` en los renglones de la nota de crédito (`origenes.ts`); `vendido()` descuenta las devoluciones por remito.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-entrega-54-remitos-devolucion-design.md`

## Global Constraints
- Mensajes exactos de la spec: `Los renglones deben ser de remitos del mismo depósito`, `No se puede devolver más de lo entregado en el remito <número> (<descripción>): quedan <q>`, `La devolución ya tiene notas de crédito: anúlelas primero`, `El remito tiene devoluciones: anúlelas primero`, `El remito tiene una factura sin autorizar: emítala o elimínela antes de la devolución`, `La mercadería de este remito ya se devolvió con una nota de crédito`, `La devolución no corresponde a la factura asociada`, `La factura <número> facturó <q> de <descripción>`, `La mercadería ya entró con el remito de devolución`.
- Enum nuevo en su propia migración; desplegar en las tres bases.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Remitos de entrega existentes: pendientes, facturación, anulación y PDF iguales (tipo ENTREGA por defecto).
2. Renglón de remito facturado en dos facturas: el tope por factura de la nota de crédito.
3. Devolución de un artículo sin control de stock: no mueve stock pero sí pendientes y acreditación.
4. Reservas (entrega 53): un remito de devolución no cuenta como entrega ni libera ni consume reservas.
5. Anular la devolución después de facturar el resto del remito: no deja `cantidadDevuelta` negativa ni pendientes inconsistentes.

---

### Task 1: Remito de devolución (API)
**Files:** `prisma/schema.prisma` + migraciones (`enum TipoRemito { ENTREGA DEVOLUCION }` sola; luego `Remito.tipo TipoRemito @default(ENTREGA)`, `RemitoRenglon.remitoRenglonOrigenId String? @db.Uuid`, `cantidadDevuelta`, `cantidadAAcreditar`, `cantidadAcreditada` (Decimal 18,4 default 0), `PedidoVentaRenglon.cantidadDevuelta` (default 0)). `ventas/remitos/dto.ts` (`esquemaDevolucion = { terceroId, puntoVentaId, fecha, observaciones?, renglones: { remitoRenglonOrigenId, cantidad > 0 }[] ≥ 1 }`). `ventas/remitos/remitos.service.ts`: `crearDevolucion(d)` (numeración `REMITO_DEVOLUCION` por punto de venta; validaciones de la spec en este orden: origen existe, es de un remito ENTREGA CONFIRMADO del cliente; mismo depósito; factura sin autorizar; NC con devolución del artículo en la factura que lo facturó; cantidad ≤ `cantidad − cantidadDevuelta` del origen (sumando renglones repetidos); entrada de stock con `motor.moverVarios` tipo `DEVOLUCION_VENTA` al `costoUnitario` del movimiento de salida del origen; asiento Mercaderías debe / CMV haber con `ORIGEN_COSTO_REMITO`; `cantidadDevuelta` del origen y del renglón de pedido del origen (si tiene); `cantidadAAcreditar = máx(0, q − (cantidad − facturada − devuelta antes))`), `anularDevolucion` dentro de `anular(id)` según el tipo (bloqueo si `cantidadAcreditada > 0`; reversa de stock y asiento; restar devueltas), y `anular` de una entrega con devoluciones confirmadas → 400. Pendientes de facturar del remito y del pedido (listados y `origenes.ts`) con `− cantidadDevuelta`. `remitos.controller.ts`: `POST /api/ventas/remitos/devoluciones` (`pedido.gestionar`); `GET /api/ventas/remitos/devolvibles?terceroId=` (renglones de entrega con lo que queda por devolver); listado con `tipo` y filtro `?tipo=`.
**Test:** `apps/api/test/remitos-devolucion.e2e-spec.ts`.
- [ ] Pruebas que fallan: remito de entrega de 10 (stock 20, costo 100) sin facturar → devolución de 4: stock 14, movimiento DEVOLUCION_VENTA a costo 100, asiento 1.1.04 D 400 / 5.1.01 H 400 (usar las cuentas de los conceptos), pendiente de facturar del remito 6, `cantidadAAcreditar` 0; devolver 7 más → 400 con `quedan 6`; facturar 6 y devolver 2 → `cantidadAAcreditar` 2; remito con factura sin autorizar → 400; NC con devolución del artículo en la factura → devolución 400; remito de otro cliente → 400; dos depósitos → 400; anular la entrega con devoluciones → 400; anular la devolución sin NC → stock y pendientes vuelven; artículo sin stock: sin movimiento, pendientes sí; pedido del origen: pendiente de facturar del pedido baja.
- [ ] `npx jest --runInBand test/remitos-devolucion test/ventas-remitos test/ventas-pedidos test/reservas-stock` → PASS. Commit `feat(ventas): remitos de devolución`.

### Task 2: Nota de crédito desde devoluciones (API)
**Files:** `prisma/schema.prisma` + migración (`ComprobanteVentaRenglon.devolucionRenglonId String? @db.Uuid`), `ventas/comprobantes/dto.ts` (`origen` admite `DEVOLUCION`, `devolucionRenglonId`), `ventas/comprobantes/origenes.ts` (rama DEVOLUCION: solo en NOTA_CREDITO; renglón de devolución CONFIRMADA del cliente; pendiente `cantidadAAcreditar − cantidadAcreditada`; la factura asociada facturó el renglón de origen; tope por factura (lo facturado por esa factura del renglón de origen − lo acreditado con NC autorizadas o con número reservado asociadas a esa factura por devoluciones de ese origen); no mueve stock; `registrar` suma `cantidadAcreditada`), `comprobantes.service.ts` (NC con renglones DEVOLUCION y `devuelveMercaderia` → 400 `La mercadería ya entró con el remito de devolución`; el control de stock ignora esos renglones), `stock/ventas-stock.ts` (`vendido()` resta, por artículo, lo devuelto con remitos de devolución de los renglones de remito facturados en esa factura), `remitos.controller.ts` (`GET /api/ventas/remitos/pendientes-acreditar?terceroId=` con la factura propuesta, precio y bonificación del renglón de esa factura).
**Test:** `apps/api/test/remitos-devolucion.e2e-spec.ts` (agregar).
- [ ] Pruebas que fallan: entrega 10 facturada (factura F1) → devolución 3 → pendientes de acreditar 3 con F1 propuesta y su precio; NC desde la devolución por 3 → 201, stock sin cambio, `cantidadAcreditada` 3; otra NC por 1 → 400 (pendiente 0); NC desde devolución asociada a otra factura → 400 `La devolución no corresponde a la factura asociada`; renglón facturado 6 en F1 y 4 en F2, devuelto 8 → NC contra F2 por 5 → 400 `La factura … facturó 4 de …`; NC desde devolución con `devuelveMercaderia` → 400; NC con devolución de mercadería sobre F1 después de devolver 3 por remito: puede devolver 7 y no 8; anular la devolución con NC → 400.
- [ ] `npx jest --runInBand test/remitos-devolucion test/stock-ventas test/ventas-comprobantes` → PASS. Commit `feat(ventas): notas de crédito desde devoluciones`.

### Task 3: PDF, pantallas y e2e
**Files:** API `remitos.service.ts` PDF (título `Remito de devolución`, remitos de origen); web: `apps/web/src/ventas/RemitoDevolucionPage.tsx` (ruta `/ventas/remito-devolucion`, menú *Remito de devolución* con `pedido.gestionar`: cliente, punto de venta, fecha, *Agregar desde remitos* con `devolvibles`, cantidades, *Confirmar devolución*, PDF), `PedidosRemitosPages.tsx` (columna *Tipo* y filtro en la consulta de remitos), `ComprobanteVentaPage.tsx` (en NC: *Agregar desde devoluciones* con `pendientes-acreditar`, que propone la factura asociada y renglones `origen: 'DEVOLUCION'`), `e2e/remitos-devolucion.spec.ts` (encadenado después de `reservas-stock`), `docs/pendientes.md` (ítem 19 hecho).
**Test:** `apps/web/src/ventas/devolucion.test.tsx`; e2e de la API para el PDF (texto `Remito de devolución`).
- [ ] Pruebas que fallan (vitest): la pantalla de devolución lista lo devolvible y no deja confirmar sin cantidades; la NC agrega renglones desde devoluciones con la factura asociada propuesta; la consulta muestra el tipo.
- [ ] e2e: remito de entrega de un artículo, remito de devolución de una parte, verlo en la consulta con tipo Devolución.
- [ ] vitest, `pnpm build`, e2e del proyecto y `npx jest --runInBand test/remitos-devolucion` → PASS. Commit `feat(web): remitos de devolución`.

Al final: suite completa de la API (dos shards), web y e2e sola sobre base nueva; revisión final.
