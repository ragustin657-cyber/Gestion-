# Entrega 59 — Pulido de ventas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolver los 18 menores visibles de las entregas 54 a 58 (spec, puntos 1–18).

**Architecture:** Cambios puntuales en los servicios y pantallas existentes; sin modelos nuevos. Tres tareas: API (puntos 1–5, 8, 11–13, 15), web (6, 7, 9, 10, 14, 15 web, 16, 17), PDF y pendientes (18 y lo que queda fuera).

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-28-entrega-59-pulido-ventas-design.md`

## Global Constraints
- Mensajes exactos: `No hay remitos pendientes de facturar: los renglones están en facturas sin autorizar`, `Rubro inválido`, `ARBA respondió <status>: <texto>`, `ARBA rechazó el usuario o la clave CIT`, `El rubro <nombre> está inactivo: no aporta escalas`, `No hay cotización de USD para la fecha`.
- Ningún cambio de comportamiento fuera de los 18 puntos.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Remito de entrega sin devoluciones: `devoluciones: []` y la consulta igual que antes.
2. Pendientes a acreditar de una devolución de un renglón facturado en una sola factura: una fila, igual que hoy.
3. Lote con pedido en USD (no lista): precio del pedido sin cambios.
4. Clave CIT: guardar otros campos sin `clave` la conserva.
5. Exportación destildada en un comprobante guardado con renglones exentos de un artículo exento: siguen exentos.

---

### Task 1: API
**Files:** `ventas/remitos/remitos.service.ts` (`obtener` con `devoluciones` para entregas; `pendientesAcreditar` por factura), `ventas/lotes/armado.ts` (sugerido con la cotización de `f.fecha`; problema de cotización), `ventas/lotes/lotes.service.ts` (mensaje con borradores), `ventas/precios/precios.service.ts` (`margen`/`origenMargen` solo COSTO), `articulos/articulos.controller.ts` (`rubroId` UUID → 400 `Rubro inválido`), `ventas/remitos/cot/traslado.ts` (`provincia` null/vacía = sin destino; `horaArgentina` con `hourCycle: 'h23'`; patente sin espacios ni guiones), `ventas/remitos/cot/cliente-cot.ts` (no 2xx o no XML → errores con el texto; 401/403 con el mensaje de clave), `transportistas.ts` (patente normalizada), `ventas/remitos/cot/config-cot.service.ts` (`clave: null` borra).
**Test:** `apps/api/test/pulido-ventas.e2e-spec.ts`, `apps/api/src/ventas/remitos/cot/cliente-cot.spec.ts`.
- [ ] Pruebas que fallan: entrega con devolución → `devoluciones[0].numeroTexto`; entrega sin → `[]`; renglón facturado 6 en F1 y 4 en F2, devuelto 8 (todo a acreditar) → pendientes-acreditar con dos filas (F2 4 y F1 4, o lo que corresponda por factura); lote con precio de lista USD y cotización del día de emisión distinta de la de hoy → precio con la de la fecha; sin cotización → problema; lote con todo en borradores → 400 con el mensaje; recálculo de lista LISTA → filas sin `origenMargen`; `?rubroId=abc` → 400 `Rubro inválido`; alta de remito con `traslado: { provincia: null }` y cliente con entrega → destino del cliente; `patente: 'AB 123 CD'` → `AB123CD`; `horaArgentina(new Date('2026-11-06T03:30:00Z'))` → `0030`; config `clave: null` → `tieneClave: false`; unitarias de `parsearRespuestaCot`/cliente real con fetch simulado: 403 → errores `['ARBA rechazó el usuario o la clave CIT']`, 200 con HTML → `ARBA respondió 200: …`.
- [ ] `npx jest --runInBand test/pulido-ventas test/cot-arba test/remitos-devolucion test/facturacion-lotes test/rubros-escalas src/ventas/remitos/cot` → PASS. Commit `fix(ventas): pulido de la API de ventas`.

### Task 2: Web
**Files:** `ventas/GrillaVenta.tsx` (quitar artículo borra la bonificación no manual), `abm/TablaAbm.tsx` (cambiar `filtros` vuelve a la página 1), `articulos/RubrosArticulosPage.tsx` (columna *Escalas* solo con `articulo.editar`), `paginas/ArticulosPage.tsx` (aviso de rubro inactivo; necesita `rubroActivo` en el listado: `articulos.service.listar` agrega `rubroActivo`), `ventas/cot.tsx` (rojo con el motivo si RECHAZADO; *Borrar clave*), `ventas/ComprobanteVentaPage.tsx` + `ventas/exportacion.tsx` (renglones agregados pasan a exento con Exportación; destildar o cliente local → alícuota del artículo y ARS; cliente del exterior → primer punto de venta de exportación), `ventas/PedidosRemitosPages.tsx` (columna *Devoluciones*).
**Test:** `apps/web/src/ventas/pulido-ventas.test.tsx`.
- [ ] Pruebas que fallan: `quitarArticulo(renglon)` (función de GrillaVenta) deja `bonificacionPct: ''` si no es manual y la conserva si es manual; `restaurarAlicuotas(renglones, articulos)` vuelve a la alícuota del artículo y 21 sin artículo; `RemitosPage` con una fila con devoluciones muestra el número; `etiquetaResultadoCot({cotEstado:'RECHAZADO', cotMensaje:'x'})` → `{ color: 'red', texto: 'ARBA rechazó el COT: x' }`; `cuerpoConfigCot` con `borrarClave` → `clave: null`.
- [ ] vitest y `pnpm build` → PASS. Commit `fix(web): pulido de las pantallas de ventas`.

### Task 3: PDF de la E y pendientes
**Files:** `ventas/comprobantes/comprobantes.service.ts` (`datosPdf`: documento del cliente E `NIF <nif>` o `CUIT país <cuitPais>`), `docs/pendientes.md` (§3.5: los puntos fuera de la spec).
**Test:** `apps/api/test/exportacion.e2e-spec.ts` (agregar).
- [ ] Prueba que falla: PDF de la E contiene `NIF US-123456789`; sin NIF → `CUIT país 55000002126`.
- [ ] `npx jest --runInBand test/exportacion` → PASS. Commit `fix(ventas): documento del cliente del exterior en el PDF de la E`.

Al final: suite completa de la API (dos shards), web y e2e sola sobre base nueva; revisión final.
