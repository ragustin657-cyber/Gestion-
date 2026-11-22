# Entrega 41 — Despachos de importación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Despacho de importación como comprobante de compra contra la Aduana: IVA y percepciones como crédito y pagos a cuenta, derechos y tasa al costo, deuda = lo liquidado; en los libros y el Libro IVA Digital (066).

**Architecture:** `TipoComprobanteCompra.DESPACHO_IMPORTACION` dentro del flujo existente de `ComprobantesService.crear` (rama propia en la validación y en los totales: sin letra/número, total = tributos), `asientoCompra` con las líneas nuevas, `aduana.ts` (tercero de la Aduana), y las columnas nuevas en el Libro IVA Compras y en el Libro IVA Digital.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-entrega-41-despachos-importacion-design.md`

## Global Constraints
- Mensajes exactos: `El número de despacho tiene 16 caracteres (por ejemplo 26001IC04012345K)`, `Ya existe el despacho <número>`, `El despacho no lleva letra ni número de comprobante`, `El tercero con el CUIT de la Aduana (<razón social>) no es un proveedor activo: actívelo o márquelo como proveedor`, nota del libro `En los despachos de importación el total es lo liquidado por la Aduana; la base imponible no lo integra`.
- CUIT de la Aduana `33693450239`; regex `^\d{5}[A-Z]{2}\d{2}\d{6}[A-Z]$`.
- Cuentas `1.1.03.012 Percepciones Ganancias sufridas` (`PERCEPCION_GANANCIAS`), `5.1.02 Derechos y tasas de importación` (`COSTO_IMPORTACION`); total de conceptos 51.
- El valor del enum va en su propia migración.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Dos alícuotas (21 % y 10,5 %) en un despacho: IVA por alícuota, total y asiento cuadran (Task 1).
2. Despacho sin percepciones (solo IVA) (Task 1).
3. Anular un despacho de un mes con la posición de IVA cerrada → bloqueado (Task 1).
4. Orden de pago a la Aduana: sin retenciones (Task 1).
5. Libro IVA Compras: el total del despacho no incluye la base y los totales del libro siguen alimentando la posición de IVA (Task 2).

---

### Task 1: Despacho en compras (datos, carga, asiento, Aduana, retenciones)
**Files:** `prisma/schema.prisma` + migraciones (enum; columnas; datos: cuentas y `ConfigCuenta`); `plan-cuentas-modelo.ts`; `conceptos.ts`; Create `apps/api/src/compras/comprobantes/aduana.ts` (`CUIT_ADUANA`, `terceroAduana(tx, empresaId): Promise<Tercero>`); `compras/comprobantes/{dto,comprobantes.service}.ts` (variante despacho: `tipo: 'DESPACHO_IMPORTACION'`, `numeroDespacho`, `percepcionGanancias`, `derechosImportacion`, `tasaEstadistica`; sin letra/punto de venta/número; terceroId lo pone el servicio; total = IVA + percepciones + derechos + tasa; unicidad del número; asiento con las líneas nuevas); `pagos/retenciones/retenciones.service.ts` (sin retenciones al CUIT de la Aduana); `impuestos/codigos.ts` (`codigoCompra('DESPACHO_IMPORTACION') = 66`). **Test:** `apps/api/test/despachos-importacion.e2e-spec.ts`.
- [ ] Pruebas que fallan:
  - Despacho con base 100.000 al 21 % y 50.000 al 10,5 %, percepción IVA 3.000, Ganancias 6.000, IIBB 902 2.500, derechos 8.000, tasa 2.000 → IVA 21.000 + 5.250, total 47.750; cuenta corriente de la Aduana 47.750; asiento: 1.1.03.001 D 26.250, 1.1.03.002 D 3.000, 1.1.03.012 D 6.000, 1.1.03.003 D 2.500, 5.1.02 D 10.000, 2.1.01.001 H 47.750.
  - Crea el tercero de la Aduana la primera vez y lo reusa la segunda; con uno inactivo → 400 con el mensaje.
  - Número inválido → 400; repetido → 400 `Ya existe el despacho 26001IC04012345K`; con letra → 400.
  - `totalDeclarado` que difiere en más de 0,05 → 400 (el mensaje existente).
  - Solo IVA (sin percepciones ni derechos).
  - Con la posición de IVA del mes cerrada: cargar y anular → 400 (mensaje de la E37).
  - Orden de pago del despacho a la Aduana con régimen de Ganancias activo → sin retenciones.
- [ ] Implementar; migraciones con `prisma migrate diff`, desplegadas en `gestion`, `gestion_test`, `gestion_mig`.
- [ ] `npx jest --runInBand test/despachos-importacion test/compras test/pagos test/compras-config test/ventas-maestros test/pagos-config` → PASS (conteos a 51). Commit `feat(compras): despachos de importación`.

### Task 2: Libro IVA Compras y Libro IVA Digital
**Files:** `compras/consultas/consultas.service.ts` (`percepcionGanancias`, `otrosTributos` por fila y totales; comprobante `Despacho <número>`; nota), `libro-iva-xlsx.ts` y `impuestos/libros-iva/libros.controller.ts` (columnas), `impuestos/libros-iva/libro-iva-digital.ts` (066, despacho, documento, percepciones nacionales, otros tributos, total), `impuestos/control-arca/*` si usa `codigoCompra`. **Test:** `apps/api/test/despachos-importacion.e2e-spec.ts`.
- [ ] Pruebas que fallan: el libro muestra la fila del despacho con base 150.000 en neto, IVA 26.250, Perc. Ganancias 6.000, Otros tributos 10.000 y total 47.750, y la nota; la posición de IVA del mes toma 26.250 de crédito y 3.000 de percepciones; Libro IVA Digital: renglón de compras con tipo `066`, despacho `26001IC04012345K`, documento 80 y CUIT de la Aduana, `percepcionesNacionales` 6.000, `otrosTributos` 10.000, importe total 47.750, dos renglones de alícuotas con las bases.
- [ ] Implementar. `npx jest --runInBand test/despachos-importacion test/impuestos test/posicion-iva test/compras` → PASS. Commit `feat(impuestos): despachos en el Libro IVA Compras y el Libro IVA Digital`.

### Task 3: Pantallas y e2e
**Files:** Create `apps/web/src/compras/DespachoImportacionPage.tsx` (número, fecha, renglones base/alícuota con IVA calculado, percepciones IVA/Ganancias/IIBB por jurisdicción, derechos, tasa, total liquidado; destino del crédito si hay prorrateo), menú y rutas; consulta de compras (etiqueta *Despacho*), Libro IVA Compras (columnas y nota); `e2e/despachos-importacion.spec.ts` (proyecto propio después de `prorrateo-iva`). **Test:** `apps/web/src/compras/despacho.test.tsx`.
- [ ] Pruebas que fallan: la pantalla calcula IVA por alícuota y el total liquidado (base no suma); valida el formato del número. e2e: el administrador carga un despacho y lo ve en el Libro IVA Compras.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): despachos de importación`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final; `docs/pendientes.md` §2 con el diseño del despacho en el Libro IVA Digital a verificar.
