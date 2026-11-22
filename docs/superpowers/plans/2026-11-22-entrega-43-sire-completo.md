# Entrega 43 — SIRE completo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Anulaciones de retenciones de IVA y SUSS ya presentadas en el SIRE, y retención de Ganancias a beneficiarios del exterior con su F.2003.

**Architecture:** `OrdenPagoRetencion` gana `anuladaEn` y `certificadoSire`; la anulación de la OP fija `anuladaEn`. `impuestos/retenciones/sire.ts` filtra por mes con la regla nueva, agrega las NC al F.2004 y un generador `sireIvaAnulaciones` (F.2005 de anulación). La retención al exterior vive en `pagos/retenciones/retenciones.service.ts` (`impuesto 'GANANCIAS_EXTERIOR'`), con `RegimenExterior` en la configuración de pagos y los datos del exterior en `Tercero`; el pago y su asiento tratan el acrecentamiento; `impuestos/retenciones/sire-exterior.ts` arma el F.2003.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-entrega-43-sire-completo-design.md`

## Global Constraints
- Mensajes exactos de la spec §6 y `El proveedor del exterior <x> no tiene régimen de Ganancias exterior`.
- Diseños: F.2005 anulación (305 posiciones, solo versión, trazabilidad, impuesto 216, certificado original y motivo); F.2004 NC tipo 3 con `00001-NNNNNNNN`; F.2003 según el 3.1 de `docs/referencias/arca-SIRE-emision-por-lote.txt` (tipo 6, número de la OP en 8 dígitos).
- Cuenta `5.2.15 Impuesto a las ganancias asumido (exterior)`, concepto `GANANCIAS_ASUMIDO` (total 52); talonario `RET-GAN-EXT`; presentaciones `SIRE_IVA_ANULACIONES` y `SIRE_GANANCIAS_EXTERIOR` (valores de enum en su propia migración).
- Retenciones anuladas antes de esta entrega (`anuladaEn` nulo): nunca se informan como anulación.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Regenerar el SIRE de un mes ya presentado después de anular la OP en un mes posterior: archivo idéntico (Task 1).
2. OP anulada el mismo mes de su pago: no aparece en ningún archivo (Task 1).
3. Acrecentamiento: el proveedor cobra todo, el asiento cuadra y el gasto es el impuesto asumido (Task 2).
4. Proveedor del exterior pagado en dólares: base en pesos a la cotización del pago (Task 2).
5. Proveedor del exterior: no lleva retención de Ganancias local, IVA, SUSS ni IIBB, y SICORE no la incluye (Task 2).

---

### Task 1: Anulaciones en el SIRE (IVA y SUSS)
**Files:** `prisma/schema.prisma` + migraciones (`OrdenPagoRetencion.anuladaEn`, `certificadoSire`; `ConfigImpuestos.sireMotivoAnulacion`; enum `TipoPresentacion.SIRE_IVA_ANULACIONES` aparte); `pagos/ordenes/anulacion.service.ts` (fija `anuladaEn`); `pagos/consultas/*` o el módulo de retenciones practicadas (`PATCH /api/pagos/retenciones/:id/certificado-sire`, permiso `op.pagar`); `impuestos/retenciones/comun.ts` (`retencionesDelPeriodo` con la regla nueva y `anulacionesDelPeriodo`); `impuestos/retenciones/sire.ts` (NC en F.2004; `sireIvaAnulaciones`); `formato/formatos.ts` (`SIRE_F2005_ANULACION`); `presentaciones.service.ts`; `impuestos/config/*` (motivo). **Test:** `apps/api/test/sire-anulaciones.e2e-spec.ts`.
- [ ] Pruebas que fallan:
  - OP de octubre con retención de IVA y SUSS, SIRE de octubre generado; se carga el certificado SIRE; la OP se anula en noviembre → el SIRE IVA de octubre regenerado es igual; `SIRE_IVA_ANULACIONES` de noviembre: un registro de 305 posiciones con versión `0100`, trazabilidad, `216`, certificado original y motivo `1`; el SIRE SUSS de noviembre trae una NC (tipo `03`, fechas = anulación, número `00001-NNNNNNNN`, certificado original, importes).
  - Sin certificado SIRE → 400 con el mensaje.
  - OP pagada y anulada el mismo mes → ni en el mes ni como anulación.
  - Retención anulada sin `anuladaEn` (antes de la entrega) → no se informa.
  - `PATCH certificado-sire` guarda y valida largo (≤ 25).
- [ ] Implementar; migraciones desplegadas en `gestion`, `gestion_test`, `gestion_mig`. `npx jest --runInBand test/sire-anulaciones test/retenciones-iva-suss test/impuestos-retenciones test/pagos` → PASS. Commit `feat(sire): anulaciones de retenciones de IVA y SUSS`.

### Task 2: Retención de Ganancias a beneficiarios del exterior
**Files:** `prisma/schema.prisma` + migraciones (campos del exterior en `Tercero`; `RegimenExterior` en `MODELOS_DE_EMPRESA`; cuenta y `ConfigCuenta`); `plan-cuentas-modelo.ts`; `conceptos.ts`; `terceros/{dto,terceros.service}.ts`; `pagos/config/*` (CRUD `regimenes-exterior`); `pagos/retenciones/retenciones.service.ts` (cálculo; sin locales para el exterior; aviso sin régimen); `pagos/ordenes/pago.service.ts` (talonario `RET-GAN-EXT`, acrecentamiento: no se descuenta, asiento con `GANANCIAS_ASUMIDO`); PDF del certificado. **Test:** `apps/api/test/ganancias-exterior.e2e-spec.ts`.
**Produces:** retención `{ impuesto: 'GANANCIAS_EXTERIOR', regimen: <id>, base, alicuota, importe, detalle: { codigoAlicuota, aplicaCdi, acrecentamiento } }`.
- [ ] Pruebas que fallan: régimen 31,5 % (código 100) y CDI 15 % (código 200); OP de 100.000 → retención 31.500, neto a pagar 68.500, asiento con 2.1.02.002 31.500; con CDI → 15.000; con CDI sin alícuota en el régimen → 400 con el mensaje; con acrecentamiento → retención 45.985,40, neto 100.000, asiento con 5.2.15 al debe 45.985,40; factura en dólares a 1.000 → base en pesos; proveedor del exterior sin régimen → sin retención y aviso; no lleva Ganancias local, IVA, SUSS ni IIBB; SICORE del mes no la incluye; certificado `RET-GAN-EXT` y PDF.
- [ ] Implementar; `npx jest --runInBand test/ganancias-exterior test/pagos test/retenciones test/compras-config test/ventas-maestros test/pagos-config test/terceros` → PASS (conteos a 52). Commit `feat(pagos): retención de Ganancias a beneficiarios del exterior`.

### Task 3: F.2003
**Files:** Create `apps/api/src/impuestos/retenciones/sire-exterior.ts`; `formato/formatos.ts` (`SIRE_F2003`); `presentaciones.service.ts` (`SIRE_GANANCIAS_EXTERIOR`, valor de enum en su migración). **Test:** `apps/api/test/ganancias-exterior.e2e-spec.ts`.
- [ ] Pruebas que fallan: el F.2003 del mes tiene un registro de 415 posiciones con `2003`, `0100`, CUIT agente, `218`, régimen, CUIT ordenante, fecha, tipo `06`, número de la OP, importe del comprobante (base), no retención `0`, CDI, código de alícuota, acrecentamiento, NIF, denominación, domicilio, país, tipo de persona y nacimiento (persona física); proveedor sin datos del exterior → 400 `Complete los datos del exterior de: …`; OP anulada el mes siguiente → NC en el F.2003 de ese mes (tipo 3, certificado original, motivo `Anulación de la orden de pago`).
- [ ] `npx jest --runInBand test/ganancias-exterior test/impuestos-retenciones` → PASS. Commit `feat(sire): F.2003 de Ganancias a beneficiarios del exterior`.

### Task 4: Pantallas y e2e
**Files:** `apps/web/src/pagos/` (retenciones practicadas: certificado SIRE editable; configuración: pestaña *Ganancias exterior*), ficha del tercero (datos del exterior), configuración de impuestos (motivo de anulación), `impuestos/comun.ts` (presentaciones nuevas); `e2e/sire-completo.spec.ts` (proyecto propio después de `despachos-importacion`). **Test:** `apps/web/src/pagos/sire.test.tsx`.
- [ ] Pruebas que fallan: la tabla de retenciones practicadas muestra el campo *Certificado SIRE* en IVA y no en Ganancias local; las presentaciones listan las dos nuevas. e2e: el administrador carga un régimen exterior, marca un proveedor del exterior con sus datos, paga una factura y ve la retención; genera el F.2003 del mes.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): SIRE completo`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final; `docs/pendientes.md` §2 con los datos a verificar (tabla de motivos de anulación, códigos de régimen y alícuota del exterior, tabla de países, respuesta del SIRE con los certificados).
