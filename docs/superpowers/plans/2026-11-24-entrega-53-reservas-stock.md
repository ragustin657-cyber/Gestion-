# Entrega 53 — Reservas de stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Calcular lo reservado por los pedidos pendientes, mostrar reservado y disponible, y avisar (sin bloquear) cuando una operación usa mercadería reservada por otros pedidos.

**Architecture:** Un servicio `ReservasStock` (en `src/stock/reservas.ts`) calcula lo reservado por artículo y depósito desde los renglones de pedido; lo usan la confirmación del pedido, el remito, el control de stock de ventas y la consulta de existencias. Sin tablas nuevas.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-entrega-53-reservas-stock-design.md`

## Global Constraints
- Reservan pedidos `CONFIRMADO` y `PARCIALMENTE_ENTREGADO`; reservado del renglón = `cantidad − máx(cantidadEntregada, cantidadFacturada)` si > 0; solo artículos con `controlaStock`.
- Depósito de la reserva: `pedido.depositoId` o el del primer punto de venta con depósito (orden por número).
- Texto exacto del aviso: `Disponible de <código> en <depósito>: stock <s>, reservado por otros pedidos <r>, disponible <d>; el pedido pide <q>` (confirmación) o `…; se entregan <q>` (remito y factura).
- Nunca bloquea, ni con el modo de stock BLOQUEAR.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Pedido confirmado remitido en parte y luego facturado del resto sin remito: la reserva baja a cero.
2. Factura desde el propio pedido (o remito de ese pedido): no se avisa por su propia reserva.
3. Pedido anulado o cerrado con pendiente: deja de reservar.
4. Pedido sin depósito y empresa sin puntos de venta con depósito: no reserva y no rompe.
5. Existencias con filtro de depósito: reservado y disponible solo de ese depósito.

---

### Task 1: Cálculo y avisos
**Files:** Create `apps/api/src/stock/reservas.ts`: `reservado(tx: TxEmpresa, f: { articuloIds?: string[]; depositoId?: string; excluirPedidoIds?: string[] }): Promise<{ pedidoId: string; numero: number; fecha: Date; terceroId: string; depositoId: string; articuloId: string; cantidad: Dec }[]>` y `totalReservado(filas, articuloId, depositoId): Dec`; `avisoDisponible(...)` que arma el texto. Modify `ventas/pedidos/pedidos.service.ts` (`confirmarEn`: el aviso nuevo con lo reservado por otros pedidos, en lugar del de hoy), `ventas/remitos/remitos.service.ts` (al crear: aviso por artículo con `stock antes del movimiento − reservado por otros pedidos`, excluyendo los pedidos de sus renglones), `stock/ventas-stock.ts` (`controlar`, solo FACTURA/NOTA_DEBITO: mismo aviso excluyendo los pedidos de los renglones, sin repetir si ya avisó stock insuficiente; recibe `pedidoIds?: string[]` desde `comprobantes.service`).
**Test:** `apps/api/test/reservas-stock.e2e-spec.ts`.
- [ ] Pruebas que fallan: artículo con stock 10 en el depósito; pedido A confirmado por 8; pedido B por 5 → aviso `Disponible de <cod> en <dep>: stock 10, reservado por otros pedidos 8, disponible 2; el pedido pide 5`; remito de B por 5 → el mismo texto con `se entregan 5`; remito de A por 8 → sin aviso de reserva (es su propio pedido); A entregado 3 por remito y facturado 8 desde el pedido sin remito → reservado 0; pedido anulado y cerrado → no reservan; factura directa (sin pedido) por 3 con A pendiente 8 y stock 10 → aviso con `se entregan 3`; modo BLOQUEAR con stock suficiente pero reservado → se emite (201) con aviso; pedido sin depósito y sin puntos de venta con depósito → no reserva.
- [ ] `npx jest --runInBand test/reservas-stock test/ventas-pedidos test/ventas-remitos test/stock-ventas` → PASS. Commit `feat(stock): reservas de los pedidos y avisos de disponible`.

### Task 2: Consultas, pantalla y pendientes
**Files:** `stock/consultas/consultas-stock.service.ts` (`existencias`: por depósito `reservado` y `disponible`, y totales por artículo; con `depositoId`, solo ese depósito), `consultas-stock.controller.ts` (Excel/PDF con *Reservado* y *Disponible*; `GET /api/stock/reservas?articuloId=&depositoId=` con `stock.ver`, filas: pedido (número), fecha, cliente, depósito, artículo, cantidad), web `apps/web/src/stock/ExistenciasPage.tsx` (columnas *Reservado* y *Disponible*, botón *Reservas* por fila con un modal de la consulta), `e2e/reservas-stock.spec.ts` (encadenado después de `listas-derivadas`), `docs/pendientes.md` (ítems 1, 2, 3, 5, 6 y 20 tachados con su entrega).
**Test:** e2e de la API (agregar a `reservas-stock.e2e-spec.ts`), `apps/web/src/stock/reservas.test.tsx`.
- [ ] Pruebas que fallan: existencias del artículo con stock 10 y pedido de 8 → `reservado: '8'`, `disponible: '2'` (total y depósito); con filtro de otro depósito → 0; `GET /api/stock/reservas?articuloId=` → una fila con el número del pedido y 8; Excel con las columnas; web: la tabla muestra Reservado y Disponible y el modal lista el pedido.
- [ ] e2e: confirmar un pedido de un artículo con stock y ver *Reservado* en Existencias.
- [ ] `npx jest --runInBand test/reservas-stock test/stock`, vitest, `pnpm build`, e2e del proyecto → PASS. Commit `feat(stock): reservado y disponible en existencias`.

Al final: suite completa de la API (dos shards), web y e2e sola sobre base nueva; revisión final.
