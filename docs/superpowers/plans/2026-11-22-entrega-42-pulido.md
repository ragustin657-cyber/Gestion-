# Entrega 42 — Pulido de las entregas 38 a 41 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Las 16 correcciones de la spec, cada una con una prueba que falla antes.

**Architecture:** Cambios puntuales en `impuestos/config`, `impuestos/posicion-iibb`, `impuestos/posicion-iva`, `pagos/config`, `ventas/comprobantes`, `compras/comprobantes`, `impuestos/libros-iva` y en las pantallas de IIBB, posición de IVA y factura de venta. Una migración (`PosicionIibb.avisos`).

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-entrega-42-pulido-design.md`

## Global Constraints
- Mensajes exactos: `Las ventas del ejercicio son negativas: el coeficiente se acota a <0|1>`, `Solo se cambia el destino de una compra confirmada`, `Las percepciones se recalculan al guardar`, `Ya existe el despacho <número>`, `El despacho admite alícuotas de 21 % y 10,5 %`.
- Locks: `posicion-iva:<empresa>`, `posicion-iibb:<empresa>`, `regimen-percepcion-iva:<empresa>`, `aduana:<empresa>` (`pg_advisory_xact_lock(hashtext(...))`).
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Cambio del inicio de IVA en paralelo con un cierre: nunca queda un mes cerrado anterior al inicio nuevo (Task 1).
2. Dos altas simultáneas de régimen de percepción de IVA activo: queda uno solo activo (Task 2).
3. Dos primeros despachos simultáneos: los dos se registran y hay una sola Aduana (Task 3).
4. Factura de venta editada: total sin percepciones viejas (Task 4).
5. Mes de IIBB cerrado que tenía avisos: los muestra (Task 1).

---

### Task 1: Impuestos (ítems 1–7)
**Files:** `impuestos/config/config-impuestos.service.ts` (transacción + locks); `prisma/schema.prisma` + migración (`PosicionIibb.avisos Json @default("[]")`); `posicion-iibb/posicion-iibb.service.ts` (guardar y mostrar avisos; meses con aPagar y saldoAFavor); `posicion-iibb.service.ts` `ingresosPorProvincia` (porcentaje del total) y su controlador; `posicion-iva/prorrateo.ts` (`coeficienteProrrateo` devuelve `acotado: 0|1|null`) y `posicion-iva.service.ts` (aviso); `compras/comprobantes/comprobantes.service.ts` `cambiarDestinoIva` (estado); `posicion-iva/posicion-iva.controller.ts` (`filasPosicion`). **Tests:** `test/pulido42-impuestos.e2e-spec.ts`, `posicion-iva/prorrateo.spec.ts`.
- [ ] Pruebas que fallan: cierre y cambio de inicio en paralelo; IIBB cerrado con el aviso de jurisdicción que sale del Convenio lo muestra; meses con a pagar y a favor a la vez; informe por provincia con total 0 → porcentaje '0.00'; `coeficienteProrrateo('-300','100')` → acotado 1 y el aviso en la posición; cambiar destino de una compra anulada → 400; `filasPosicion` con prorrateo: la fila *Coeficiente de prorrateo* sigue a *Total crédito fiscal*.
- [ ] Implementar; migración desplegada en `gestion`, `gestion_test`, `gestion_mig`. `npx jest --runInBand test/pulido42-impuestos test/posicion-iibb test/posicion-iva test/prorrateo-iva && npx jest src/impuestos` → PASS. Commit `fix(impuestos): pulido de IIBB, prorrateo y configuración`.

### Task 2: Percepciones (ítems 9–10)
**Files:** `pagos/config/config-pagos.service.ts` (lock en `guardarRegimenPercepcionIva`); `ventas/comprobantes/comprobantes.service.ts` (`INCLUIR_VENTA.percepcionesDetalle` con `orderBy`). **Test:** `test/pulido42-percepciones.e2e-spec.ts`.
- [ ] Pruebas que fallan: dos altas activas simultáneas → una 201 y otra 400, y un solo régimen activo; las percepciones del comprobante vienen ordenadas IIBB 901, IIBB 902, IVA GENERAL, IVA REDUCIDA.
- [ ] `npx jest --runInBand test/pulido42-percepciones test/ventas-percepciones test/percepciones-config` → PASS. Commit `fix(percepciones): régimen activo único con lock y orden fijo`.

### Task 3: Despachos (ítems 12–16)
**Files:** `compras/comprobantes/comprobantes.service.ts` (`crearDespacho`: traducción del P2002 del índice de despacho; anular sin cambios), `compras/comprobantes/aduana.ts` (lock), `compras/comprobantes/dto.ts` (alícuotas), `impuestos/libros-iva/libros.controller.ts` (etiqueta del comprobante). **Test:** `test/despachos-importacion.e2e-spec.ts`.
- [ ] Pruebas que fallan: dos despachos iguales en paralelo → uno 201 y otro 400 `Ya existe el despacho …`; dos primeros despachos distintos en paralelo → ambos 201 y una sola Aduana; alícuota 27 → 400 con el mensaje; el Excel del Libro IVA Compras de impuestos tiene `Despacho 26001IC04012345K`; anular un despacho de un mes abierto deja contraasiento y cuenta corriente en cero.
- [ ] `npx jest --runInBand test/despachos-importacion test/compras` → PASS. Commit `fix(despachos): duplicados y Aduana con lock, alícuotas y etiqueta en el libro`.

### Task 4: Pantallas (ítems 3, 8, 11 y web de 14)
**Files:** `apps/web/src/impuestos/PosicionIibbPage.tsx` (`TablaMesesIibb`), `apps/web/src/ventas/GrillaVenta.tsx` y `ComprobanteVentaPage.tsx` (percepciones solo si los renglones no cambiaron; clave con tramo), `apps/web/src/compras/DespachoImportacionPage.tsx` (alícuotas 21 y 10,5). **Tests:** `apps/web/src/ventas/percepciones.test.tsx`, `apps/web/src/impuestos/posicion-iibb.test.tsx`.
- [ ] Pruebas que fallan: la grilla con `percepcionesDesactualizadas` no suma y muestra el aviso; la tabla de meses de IIBB muestra `A pagar` y `A favor` en el mismo mes; dos percepciones IVA con igual alícuota y distinto tramo no generan advertencia de clave.
- [ ] `cd apps/web && npx vitest run && pnpm build` → PASS. Commit `fix(web): pulido de percepciones, IIBB y despachos`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final; `docs/pendientes.md` con lo que queda (spec §3).
