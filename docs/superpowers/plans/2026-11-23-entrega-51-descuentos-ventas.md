# Entrega 51 — Descuentos y bonificaciones en las ventas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** % de bonificación por renglón en pedidos y comprobantes de venta y % de descuento general en el comprobante, repartido en los netos.

**Architecture:** El cálculo compartido (`calcularVenta`) recibe la bonificación de cada renglón y el descuento general y devuelve el neto final y el importe antes del descuento general; la API guarda los porcentajes y el neto final; PDF y web muestran precio de lista, % e importes.

**Tech Stack:** TypeScript (packages/shared, Vitest); NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-entrega-51-descuentos-ventas-design.md`

## Global Constraints
- Sin bonificación ni descuento, todos los importes son idénticos a los de hoy.
- `bonificacionPct` 0 a 100 y `descuentoPct` 0 a menos de 100, hasta 2 decimales; mensajes: `Hasta 2 decimales`, `Entre 0 y 100`, `Debe ser menor que 100`, `El total del comprobante debe ser mayor a cero`.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Comprobantes y pedidos existentes (sin los campos): mismos importes, PDF igual al de hoy (sin columna Bonif. ni líneas de descuento).
2. Letra B con descuento general y varias alícuotas: el PDF suma exacto (subtotal − descuento + percepciones = total).
3. Nota de crédito con bonificación sobre una factura con descuento: el tope de saldo de NC usa el total final.
4. Factura en USD con descuento: totalPesos y percepciones sobre el neto bonificado.
5. Renglón al 100 % junto con otros: se emite; solo renglones al 100 % → error de total.

---

### Task 1: Cálculo compartido
**Files:** `packages/shared/src/ventas/calculo.ts`, `calculo.test.ts`.
**Interfaces — Produces:** `RenglonCalculo.bonificacionPct?: string` (default `'0'`); `calcularVenta(renglones, letra, descuentoPct = '0')`; cada `renglones[i]` del resultado agrega `importe: string` (= `redondeo2(cantidad × precio × (1 − b/100))`, antes del descuento general); el resultado agrega `subtotal: string` (Σ importes) y `descuentoGeneral: string` (subtotal − Σ netos). `neto = redondeo2(cantidad × precio × (1 − b/100) × (1 − d/100))`.
- [ ] Pruebas que fallan: sin bonificación ni descuento, el resultado de tres casos existentes es idéntico al de hoy (mismos netos, IVA, total) y `subtotal === netoGravado+noGravado+exento`, `descuentoGeneral === '0.00'`; 2 × 1000 con 10 % → neto 1800.00; 3 × 333.33 con 15 % y descuento 5 % → neto `redondeo2(999.99 × 0.85 × 0.95) = 807.49`, importe 849.99; dos alícuotas (21 y 10,5) con descuento 10 % → IVA por alícuota sobre los netos descontados; bonificación 100 % → neto 0.00; letra C → netoGravado = total.
- [ ] `npx vitest run src/ventas/calculo.test.ts` (shared) y `pnpm build` del paquete → PASS. Commit `feat(shared): bonificación y descuento general en el cálculo de ventas`.

### Task 2: API (comprobantes, pedidos, pendientes de facturar)
**Files:**
- `prisma/schema.prisma` + migración: `ComprobanteVentaRenglon.bonificacionPct Decimal @default(0) @db.Decimal(5,2)`, `ComprobanteVenta.descuentoPct Decimal @default(0) @db.Decimal(5,2)`, `PedidoVentaRenglon.bonificacionPct Decimal @default(0) @db.Decimal(5,2)`.
- `ventas/comprobantes/dto.ts`: renglón `bonificacionPct: z.number().min(0, 'Entre 0 y 100').max(100, 'Entre 0 y 100').refine(dos decimales, 'Hasta 2 decimales').default(0)`; comprobante `descuentoPct: z.number().min(0).lt(100, 'Debe ser menor que 100').refine(dos decimales).default(0)`.
- `ventas/comprobantes/comprobantes.service.ts`: `calcularVenta(..., letra, String(d.descuentoPct))`, guarda `bonificacionPct` y `descuentoPct`; total final 0 → 400 `El total del comprobante debe ser mayor a cero`.
- `ventas/pedidos/dto.ts` y `pedidos.service.ts`: `bonificacionPct` por renglón (sin descuento general), misma validación de total.
- Endpoint de pendientes de facturar (`/ventas/pendientes-facturar`): los pedidos devuelven `bonificacionPct`; los remitos de un pedido devuelven `bonificacionPedido`.
- `GET /ventas/comprobantes/:id` y del pedido: devuelven `bonificacionPct` por renglón y `descuentoPct` (salen del modelo).
- **Test:** `apps/api/test/descuentos-ventas.e2e-spec.ts`.
- [ ] Pruebas que fallan: factura A 2 × 1000 al 21 % con bonif. 10 % y descuento 5 % → neto 1710.00, IVA 359.10, total 2069.10, renglón guardado con `bonificacionPct` 10, comprobante con `descuentoPct` 5, y lo que recibió el simulado (`ArcaSimulado.ultimaSolicitud`) tiene `impNeto` 1710.00; sin los campos → mismos importes que hoy; renglón al 100 % junto con otro → 201; todos al 100 % → 400 con el mensaje; `bonificacionPct: 10.555` → 400 `Hasta 2 decimales`; `descuentoPct: 100` → 400; pedido con bonif. → neto bonificado y los pendientes de facturar lo devuelven; NC con bonif. sobre la factura con descuento: el tope usa el total final (una NC por el total exacto se emite, un centavo más → 400 del tope); factura USD con descuento: `totalPesos = total × cotización`.
- [ ] `npx jest --runInBand test/descuentos-ventas test/ventas-comprobantes test/ventas-pedidos test/ventas-remitos` → PASS. Commit `feat(ventas): bonificación por renglón y descuento general`.

### Task 3: PDF de la venta y del pedido
**Files:** `ventas/comprobantes/comprobantes.service.ts` (datos del PDF), `ventas/pdf/pdf-venta.ts`, `ventas/pedidos/pdf-pedido.ts` (`renglonesPdf` con precio de lista y bonificación), `pdf-pedido.spec.ts`.
**Reglas:** columna *Bonif. %* solo si algún renglón tiene bonificación; importe del renglón = `importe` de `calcularVenta` (antes del descuento general); con descuento general, en el pie `Subtotal` y `Descuento general X %` antes de los totales. Letra B: importes con IVA con `importesConIva` sobre los importes antes del descuento; `Subtotal` = su suma; `Descuento general` = Subtotal − (total − percepciones). Pedido: precio unitario = precio de lista (letra B: precio × (1 + alícuota/100)), no importe ÷ cantidad.
- [ ] Pruebas que fallan: `renglonesPdf` con bonificación da el precio de lista y la columna; e2e (texto del PDF decodificado como en la entrega 50): factura A con bonif. y descuento contiene `Bonif. %`, `Subtotal`, `Descuento general 5 %`; factura B con descuento y alícuotas 21 y 10,5: los importes del pie suman exacto (leer los textos y comprobar subtotal − descuento + percepciones = total); factura sin descuentos no contiene `Bonif.` ni `Descuento general`.
- [ ] `npx jest --runInBand test/descuentos-ventas test/ventas-pdf src/ventas/pedidos` → PASS. Commit `feat(ventas): bonificación y descuento en los PDF`.

### Task 4: Pantallas y e2e
**Files:** `apps/web/src/ventas/GrillaVenta.tsx` (columna `% Bonif.` con `NumberInput`, importe del renglón y totales con `calcularVenta(..., descuento)`; prop `descuentoPct`), `ComprobanteVentaPage.tsx` (campo `Descuento general (%)`, cuerpo con `bonificacionPct`/`descuentoPct`, edición, renglones desde pedidos y remitos con la bonificación, NC de anulación FCE copiando ambos), `PedidoVentaPage.tsx` (columna `% Bonif.`), `e2e/ventas-descuentos.spec.ts` (proyecto encadenado después de `fce`), `docs/pendientes.md` (ítem 16 hecho, escalas por cantidad pendientes).
**Test:** `apps/web/src/ventas/descuentos.test.tsx`.
- [ ] Pruebas que fallan (vitest): la grilla muestra `% Bonif.` y con 2 × 1000, 10 % y descuento 5 % el total es `$ 2.069,10` (letra A); el cuerpo enviado lleva `bonificacionPct` y `descuentoPct`; agregar un renglón de pedido trae su bonificación.
- [ ] e2e: factura B a consumidor final con bonificación 10 % y descuento 5 %, total esperado, emitida (Autorizado).
- [ ] vitest completo, `pnpm build`, e2e del proyecto → PASS. Commit `feat(web): bonificación y descuento general en ventas`.

Al final: suite completa de la API (dos shards), web y e2e sola sobre base nueva; revisión final.
