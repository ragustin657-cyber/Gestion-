# Entrega 35 — Retenciones de IVA y SUSS (SIRE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Calcular retenciones de IVA y SUSS por factura al pagar, emitir constancia, contabilizarlas y generar los archivos SIRE F.2005 y F.2004.

**Architecture:** Se extiende el motor de retenciones de pagos (`apps/api/src/pagos/retenciones`) con un cálculo por imputación (funciones puras en `packages/shared/src/pagos/retenciones-iva-suss.ts`), nuevas tablas de regímenes en la configuración de pagos, campos en la empresa y el proveedor, y dos generadores en `apps/api/src/impuestos/retenciones/sire.ts` registrados en presentaciones.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest/supertest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-entrega-35-retenciones-iva-suss-design.md`

## Global Constraints
- Diseño oficial: `docs/referencias/arca-SIRE-emision-por-lote.txt` (F.2005 §5.1 largo 305; F.2004 §4.1 largo 191).
- Mensaje exacto: `Cargue el código SIRE del régimen <descripción>`.
- Talonarios `RET-IVA`, `RET-SUSS`; cuentas `RETENCION_IVA` = `2.1.02.003`, `RETENCION_SUSS` = `2.1.02.005`.
- Archivos `SIRE-F2005_<CUIT>_<AAAAMM>.txt` / `SIRE-F2004_<CUIT>_<AAAAMM>.txt`, CRLF, latin1.
- Enum nuevo de `TipoPresentacion` en su propia migración; regímenes precargados con `codigoSire` vacío.
- Demo sin agente de IVA/SUSS. No correr jest y e2e en paralelo. Postgres puede requerir `service postgresql start`.

## Review Focus
1. Factura pagada en dos OP: cada una retiene sobre su proporción y la suma no supera la retención de pagarla entera (Task 2).
2. OP con factura y su nota de crédito: la base neta no retiene sobre lo no pagado ni bloquea el pago (Task 2).
3. Factura en dólares: proporción con pesos del pago sobre total en pesos (Task 2).
4. OP anulada después de generar el SIRE: la presentación siguiente ya no la incluye (Task 4).
5. Proveedor con exclusión del 50 % vencida a la fecha de pago: retiene completo (Task 2).

---

### Task 1: Esquema, migraciones y configuración

**Files:** `apps/api/prisma/schema.prisma`, `prisma/migrations/2026120110xxxx_retenciones_iva_suss` (+ `_tipos` para el enum, + `_datos` para la precarga), `apps/api/src/prisma/modelos-empresa.ts`, `apps/api/src/pagos/config/config-pagos.{controller,service}.ts`, `apps/api/src/pagos/config/valores-iniciales.ts`, DTO/servicio de terceros y de empresa, `apps/api/src/compras/config/conceptos.ts`.
**Test:** `apps/api/test/retenciones-iva-suss-config.e2e-spec.ts`.

**Interfaces — Produces:**
- Prisma: `Empresa.agenteRetencionIva/agenteRetencionSuss Boolean @default(false)`; `RegimenIva { codigoSire String?, descripcion, porcentaje Decimal(9,4), minimoComprobante Decimal(18,2), minimoRetencion Decimal(18,2), condicionSire Int?, activo }`; `RegimenSuss { codigoSire?, descripcion, porcentaje, minimoNoSujeto, minimoRetencion, activo }`; `Tercero.regimenIvaId? regimenSussId? exclusionIvaPorcentaje Int? exclusionIvaPublicacion Date? exclusionIvaHasta Date?`; `OrdenPagoRetencion.comprobanteCompraId String? @db.Uuid`; `TipoPresentacion` + `SIRE_IVA`, `SIRE_SUSS`.
- HTTP: `GET/POST/PATCH /api/pagos/config/regimenes-iva[/:id]` y `/regimenes-suss[/:id]` (permiso de la config de pagos, como `regimenes`); `GET` devuelve `{ regimenes, avisos: string[] }` con `Cargue el código SIRE del régimen <descripción>` por cada activo sin código.

- [ ] **Step 1: Pruebas que fallan** — `'precarga de regímenes'` (empresa nueva: 3 de IVA 50/80/100 y 4 de SUSS 1,2/6/6/2, sin código, con avisos); `'alta y edición de régimen de IVA'` (POST con `codigoSire: '499'` → 201; PATCH porcentaje); `'ficha del proveedor con régimen y exclusión'` (PUT de tercero con `regimenIvaId`, `regimenSussId`, `exclusionIvaPorcentaje: 50`, fechas → se guardan; porcentaje 30 → 400); `'empresa agente de IVA y SUSS'` (PUT empresa con los dos interruptores → se guardan).
- [ ] **Step 2:** `cd apps/api && npx jest --runInBand test/retenciones-iva-suss-config` → FAIL.
- [ ] **Step 3:** esquema + 3 migraciones (generar con `prisma migrate diff`, desplegar en `gestion`, `gestion_test`, `gestion_mig`) + servicios/endpoints + precarga en `cargarValoresIniciales` de pagos y en la migración de datos para empresas existentes.
- [ ] **Step 4:** mismo comando + `test/pagos-config test/terceros*` → PASS.
- [ ] **Step 5:** commit `feat(retenciones): configuración de IVA y SUSS`.

### Task 2: Cálculo por factura

**Files:** Create `packages/shared/src/pagos/retenciones-iva-suss.ts` (+ export en el índice y `pnpm build`); Modify `apps/api/src/pagos/retenciones/retenciones.service.ts`, `apps/api/src/pagos/ordenes/ordenes-pago.service.ts` (`bases` → también las imputaciones por comprobante).
**Tests:** `packages/shared/src/pagos/retenciones-iva-suss.spec.ts`, `apps/api/test/retenciones-iva-suss.e2e-spec.ts`.

**Interfaces — Produces:**
- `retencionIva(e: { ivaFactura: string; totalFactura: string; imputado: string; porcentaje: string; minimoComprobante: string; minimoRetencion: string; exclusion: 0 | 50 | 100 }): { base: string; importe: string }` (importe `'0.00'` si no corresponde).
- `retencionSuss(e: { base: string; porcentaje: string; minimoNoSujeto: string; minimoRetencion: string }): { importe: string }`.
- `netearNotasCredito(facturas: { id: string; imputado: string; iva: string; base: string }[], notas: { asociadaId: string | null; imputado: string; iva: string; base: string }[])` → facturas con `imputado/iva/base` reducidos (asociada si está en la OP, si no proporcional).
- `RetencionCalculada.impuesto` incluye `'IVA' | 'SUSS'` y `comprobanteCompraId?: string`; `RetencionesService.calcular` recibe además `imputaciones: { comprobanteCompraId: string; tipo; letra; ivaPesos; totalPesos; imputadoPesos; asociadaId }[]`.

- [ ] **Step 1: Pruebas que fallan**
  - shared: 50 % de IVA proporcional (`iva 21000, total 121000, imputado 60500, 50` → base `10500.00`, importe `5250.00`); exclusión 50 → `2625.00`; total < mínimo comprobante → 0; retención < mínimo → 0; SUSS 6 % sobre 100000 → `6000.00`; base < mínimo no sujeto → 0; neteo con asociada y proporcional.
  - e2e: `'retiene IVA y SUSS por factura'` (agente; proveedor RI con régimen 50 % y SUSS 6 %; OP con dos facturas → 4 filas con `comprobanteCompraId`); `'sin agente no retiene'`; `'monotributo no retiene SUSS'`; `'exentoIva no retiene IVA'`; `'exclusión vencida retiene completo'`; `'factura y nota de crédito en la misma OP'` (neto 40 de 100: base IVA proporcional a 40, el pago no se bloquea); `'pago parcial en dos OP'` (suma de retenciones = retención de pagar entera, ±0,01); `'factura en dólares'`; `'ticket no retiene'`.
- [ ] **Step 2:** `cd packages/shared && npx vitest run src/pagos` (o el runner del paquete) y `cd apps/api && npx jest --runInBand test/retenciones-iva-suss` → FAIL.
- [ ] **Step 3:** implementar; las condiciones de sujeto según spec §5; la exclusión vigente si `exclusionIvaHasta >= fechaPago` (o sin fecha).
- [ ] **Step 4:** mismos comandos + `test/pagos-retenciones test/pagos-op test/pagos-pago` → PASS.
- [ ] **Step 5:** commit `feat(retenciones): cálculo de IVA y SUSS por factura`.

### Task 3: Pago, constancia, asiento, consultas

**Files:** `apps/api/src/pagos/ordenes/pago.service.ts` (talonario y cuenta por impuesto), `apps/api/src/compras/config/conceptos.ts`, `apps/api/src/pagos/consultas/{consultas-pagos.service,pdf}.ts`.
**Test:** `apps/api/test/retenciones-iva-suss.e2e-spec.ts`.

- [ ] **Step 1: Pruebas que fallan** — `'al pagar: constancia, asiento y consulta'`: pagar la OP de Task 2 → certificados `RET-IVA` 1 y 2, `RET-SUSS` 1 y 2; asiento con haber en `2.1.02.003` y `2.1.02.005` por la suma; PDF empieza con `%PDF` y contiene `Constancia de retención de IVA` y `El certificado oficial se emite en el SIRE de ARCA` (texto del PDF sin comprimir o con la utilidad que usan las pruebas existentes de PDF); la consulta de retenciones practicadas filtra por `impuesto: 'IVA'`. `'anular la OP'` → las 4 quedan anuladas.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx jest --runInBand test/retenciones-iva-suss test/pagos-pago test/pagos-anulacion test/pagos-consultas` → PASS.
- [ ] **Step 5:** commit `feat(retenciones): constancia, asiento y consultas de IVA y SUSS`.

### Task 4: Archivos SIRE

**Files:** Create `apps/api/src/impuestos/retenciones/sire.ts`; Modify `apps/api/src/impuestos/formato/formatos.ts` (`SIRE_F2005`, `SIRE_F2004`), `apps/api/src/impuestos/presentaciones/presentaciones.service.ts` (registro, solo mensual).
**Tests:** `apps/api/src/impuestos/formato/formatos.spec.ts` (largos 305/191), `apps/api/test/retenciones-sire.e2e-spec.ts`.

**Interfaces — Produces:** `sireIva(tx, ctx): Promise<Generado>`, `sireSuss(tx, ctx): Promise<Generado>`.

- [ ] **Step 1: Pruebas que fallan**
  - formatos: cada registro mide 305 / 191.
  - e2e `'F.2005'`: OP pagada con retención de IVA (régimen con código `499`) → archivo con una línea; pos. 1–4 `0100`, 5–40 número de certificado a la izquierda, 41–43 `216`, 44–46 `499`, 47–56 fecha de pago `DD/MM/AAAA`, 59 `0`, 90–103 importe con punto y 2 decimales, 104–117 base, 118 `0`, 135–136 ` 1`/`01`, 137–146 fecha de la factura, 147–162 `PPPPP-NNNNNNNN` + 2 espacios, 201–214 total, 245–255 CUIT; nombre `SIRE-F2005_30712345671_202611.txt`.
  - e2e `'F.2004'`: pos. 1–4 `2004`, 5–8 `0100`, 19–29 CUIT agente, 30–32 `353`, 36–46 CUIT retenido, 85–98 importe del comprobante, 99–112 retención.
  - e2e `'sin código SIRE'` → 400 `Cargue el código SIRE del régimen <descripción>`; `'OP anulada no va'`; `'quincena'` → 400 (solo mensual).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar con el escritor existente (`linea`/`archivo`); enteros con ceros a la izquierda, decimales `IMPORTE` con separador `.`, textos a la izquierda.
- [ ] **Step 4:** `npx jest --runInBand test/retenciones-sire test/impuestos src/impuestos/formato` → PASS.
- [ ] **Step 5:** commit `feat(retenciones): archivos SIRE F.2005 y F.2004`.

### Task 5: Pantallas y e2e

**Files:** `apps/web` — empresa (interruptores), configuración de pagos (pestañas de regímenes de IVA y SUSS con avisos), ficha del proveedor (selects + exclusión), orden de pago (filas de IVA/SUSS con la factura), presentaciones (dos tipos); `e2e/retenciones-iva-suss.spec.ts` (proyecto propio, después de `ganancias-anual`).
**Tests:** `apps/web/src/pagos/retenciones-iva-suss.test.tsx`; e2e.

- [ ] **Step 1: Pruebas que fallan** — web: tabla de regímenes de IVA muestra el aviso de código faltante; la vista de retenciones de la OP muestra «IVA» con el número de factura; el select de régimen de IVA en la ficha del proveedor. e2e: el administrador activa agente de IVA en la empresa, carga el código SIRE `499` al régimen de 50 %, asigna el régimen a un proveedor demo RI, paga una factura y descarga el SIRE IVA del mes; primera línea de largo 305 que empieza con `0100`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS.
- [ ] **Step 5:** commit `feat(web): retenciones de IVA y SUSS`.

Al final: suite completa de la API en dos shards, web, e2e sola; revisión final.
