# Entrega 39 — Percepciones en ventas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Percepciones de IIBB (ARBA, AGIP) e IVA calculadas en facturas y notas de débito, revertidas en notas de crédito, informadas con el CAE, contabilizadas como deuda a depositar, en libros, PDF y archivos.

**Architecture:** Cálculo puro en `packages/shared/src/ventas/percepciones.ts`. En la API, `apps/api/src/ventas/percepciones/percepciones.service.ts` arma las entradas (padrón, ficha, vínculo con la jurisdicción, régimen IVA, asociada) y lo usan `ComprobantesVentaService.preparar` (borrador) y `EmisionService.reservar` (recálculo al emitir). ARCA, asiento, libros y archivos leen `ComprobanteVentaPercepcion`.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-entrega-39-percepciones-ventas-design.md`

## Global Constraints
- Mensajes exactos: `Active solo un régimen de percepción de IVA`, `Complete la situación de Ingresos Brutos de: <clientes>`, `Hay notas de crédito con percepciones de CABA: cárguelas en e-ARCIBA`.
- Cuentas `2.1.02.008 Percepciones IIBB a depositar`, `2.1.02.009 Percepciones IVA a depositar`; conceptos `PERCEPCION_IIBB_PRACTICADA`, `PERCEPCION_IVA_PRACTICADA` (total 48).
- Tributos ARCA: `Id` 7 IIBB, 6 IVA; `ImpTrib` = suma; `ImpTotal` la incluye.
- Solo letras A y B; nunca a `CONSUMIDOR_FINAL`; la NC sin asociada no lleva percepciones.
- Correlativo `ARBA-LOTE-PERCEPCION`; lote `AR-<cuit>-<período><quincena>-<actividad>-LOTE<n>`.
- Un solo jest a la vez; nunca en paralelo con la e2e. Reloj de pruebas 2026-11-06.

## Review Focus
1. Factura en USD: base e importe en dólares, mínimo comparado en pesos, asiento en pesos cuadra (Task 3).
2. Dos NC parciales sobre la misma factura: lo revertido no supera lo percibido (Task 3).
3. Borrador guardado sin padrón y emitido después de cargarlo: el CAE y el asiento llevan la percepción del padrón (Task 3).
4. Cliente proveedor con ficha IIBB sin alícuota de percepción: no se percibe al 0 % (Task 3).
5. Cliente sin ficha ni provincia de la jurisdicción con `ALICUOTA_DEFECTO`: no se percibe (Task 3).

---

### Task 1: Cálculo puro
**Files:** Create `packages/shared/src/ventas/percepciones.ts` (exportado desde `ventas/index.ts`). **Test:** `packages/shared/src/ventas/percepciones.test.ts`.
**Produces:**
- `percepcionIibb(e: { base: string; alicuota: string | null; minimoPesos: string; cotizacion: string }) → string` (importe en moneda del comprobante; `'0.00'` si alícuota null, base ≤ 0 o importe × cotización < mínimo).
- `percepcionesIva(e: { netoPorAlicuota: Record<string,string>; alicuotaGeneral: string; alicuotaReducida: string; minimoNetoPesos: string; cotizacion: string; exclusionPct: number | null }) → { tramo: 'GENERAL'|'REDUCIDA'; base: string; alicuota: string; importe: string }[]` (general = 21 y 27; reducida = 10.5, 5, 2.5; vacío si neto gravado × cotización ≤ mínimo; exclusión reduce el importe; sin renglones en cero).
- `revertirPercepcion(e: { baseNc: string; alicuota: string; exclusionPct: number | null; percibido: string; yaRevertido: string }) → string` (min(base × alícuota × (1 − excl), percibido − yaRevertido), nunca negativo).
- [ ] Pruebas que fallan: IIBB 10.000 al 3 % → 300; bajo el mínimo → 0; USD base 100 al 3 % cotización 1.000 mínimo 2.000 → 3.00 (3.000 pesos ≥ 2.000); alícuota null → 0. IVA: neto {21: 10.000, 10.5: 2.000} general 3 reducida 1.5 → [GENERAL 10.000 3 300, REDUCIDA 2.000 1.5 30]; neto bajo mínimo → []; exclusión 50 % → 150 y 15; solo exento/no gravado → []. Reversión: NC 5.000 al 3 % de 300 percibidos → 150; segunda NC 6.000 con 150 ya revertidos → 150 (tope).
- [ ] `cd packages/shared && npx vitest run src/ventas/percepciones` → FAIL → implementar → PASS; `pnpm build`. Commit `feat(ventas): cálculo de percepciones`.

### Task 2: Datos y configuración
**Files:** `apps/api/prisma/schema.prisma` + migraciones (esquema; datos: `TerceroIibb.alicuotaPercepcion` 0 → null, cuentas y `ConfigCuenta`); `modelos-empresa.ts` (`ComprobanteVentaPercepcion`, `RegimenPercepcionIva`); `conceptos.ts`; `plan-cuentas-modelo.ts`; `apps/api/src/pagos/config/*` (jurisdicciones con campos de percepción, régimen de percepción IVA CRUD, `agentePercepcionIva`); `apps/api/src/pagos/padron/padron.service.ts` (`alicuotaPercepcion(jurisdiccion, cuit, fecha)`); `apps/api/src/terceros/dto.ts` (alícuota de percepción opcional); `ConfigImpuestos.arbaActividadPercepcion`; enum `TipoPresentacion.ARBA_PERCEPCIONES` (migración propia). **Test:** `apps/api/test/percepciones-config.e2e-spec.ts`.
- [ ] Pruebas que fallan: `PUT` de jurisdicción IIBB con `percibe`, `alicuotaPercepcionDefecto`, `minimoPercepcion`, `sinPadronPercepcion` se guarda y se lee; dos regímenes de percepción IVA activos → 400 `Active solo un régimen de percepción de IVA`; ficha IIBB de tercero sin `alicuotaPercepcion` → se guarda null; `alicuotaPercepcion` del padrón vigente a la fecha.
- [ ] Implementar; migraciones con `prisma migrate diff` y desplegadas en `gestion`, `gestion_test`, `gestion_mig`.
- [ ] `npx jest --runInBand test/percepciones-config test/pagos-config test/compras-config test/ventas-maestros test/terceros test/padron` → PASS (conteos de conceptos a 48). Commit `feat(percepciones): configuración, padrón y modelo`.

### Task 3: Percepciones en el comprobante (borrador, emisión y NC)
**Files:** Create `apps/api/src/ventas/percepciones/percepciones.service.ts`; Modify `ventas/comprobantes/comprobantes.service.ts` (`preparar` agrega `percepciones` y los renglones; `total`/`totalPesos` las incluyen; `obtener` las devuelve), `ventas/emision/emision.service.ts` (`reservar` recalcula y actualiza antes de `datosCae`), módulo. **Test:** `apps/api/test/ventas-percepciones.e2e-spec.ts`.
**Produces:** `PercepcionesVentaService.calcular(tx, c: { tipo; letra; fecha; terceroId; cotizacion; netoGravado; noGravado; exento; ivas: {alicuota, base}[]; comprobanteAsociadoId; excluirId? }) → { renglones: DatosPercepcion[]; total: string }` con `DatosPercepcion = { tipo: 'IIBB'|'IVA'; jurisdiccion: string|null; regimenCodigo: string|null; base: string; alicuota: string; importe: string; origenAlicuota: string; exclusionPct: number|null }`.
- [ ] Pruebas que fallan:
  - Cliente RI en el padrón 902 al 3 %: factura 1.000 + IVA → percepción 30, total 1.240, origen PADRON.
  - Consumidor final (factura B) → sin percepciones; letra C → sin percepciones.
  - Ficha 901 con alícuota 2 y sin padrón → percepción por FICHA; ficha sin alícuota y `sinPadronPercepcion` NO_RETENER → nada.
  - `ALICUOTA_DEFECTO` 1 %: cliente con provincia «Capital Federal» → percibe 901; cliente sin ficha ni provincia → no.
  - IVA (agente, régimen 3 / 1.5, mínimo 0): renglones 21 % y 10,5 % → dos percepciones; cliente monotributo → sin IVA; exclusión 100 % vigente → sin IVA.
  - USD (Review Focus 1); bajo el mínimo en pesos → nada.
  - NC parcial de la mitad → revierte la mitad; segunda NC por el resto → no supera lo percibido (Review Focus 2); NC sin asociada → sin percepciones.
  - Borrador sin padrón, carga del padrón, emitir → la percepción aparece en el comprobante autorizado (Review Focus 3).
- [ ] Implementar. `npx jest --runInBand test/ventas-percepciones test/ventas` → PASS. Commit `feat(ventas): percepciones en factura, nota de débito y nota de crédito`.

### Task 4: ARCA, asiento y PDF
**Files:** `apps/api/src/arca/wsfe.ts` (`DatosCae.tributos: { id: number; desc: string; baseImp: string; alic: string; importe: string }[]`, `ImpTrib`, `<ar:Tributos>`), `arca/arca-simulado.ts` (acepta tributos y valida la suma), `ventas/emision/emision.service.ts` (`datosCae` arma tributos), `ventas/emision/asiento-venta.ts` (`percepciones: { concepto: 'PERCEPCION_IIBB_PRACTICADA'|'PERCEPCION_IVA_PRACTICADA'; importe }[]` al haber, al debe en la NC), PDF de la venta. **Test:** `apps/api/src/arca/wsfe.spec.ts`, `apps/api/test/ventas-percepciones.e2e-spec.ts`.
- [ ] Pruebas que fallan: el XML lleva `<ar:ImpTrib>30.00</ar:ImpTrib>` y un `<ar:Tributo>` con `Id` 7, `BaseImp`, `Alic`, `Importe`; el simulador rechaza `ImpTotal` que no suma; asiento de la factura con percepción: 1.1.02.001 debe 1.240, ventas 1.000, IVA 210, 2.1.02.008 haber 30; NC al revés; USD cuadra en pesos; el PDF incluye «Percepción IIBB Buenos Aires 3,00 %».
- [ ] Implementar. `npx jest src/arca && npx jest --runInBand test/ventas-percepciones test/ventas test/arca` → PASS. Commit `feat(ventas): percepciones en el CAE, el asiento y el PDF`.

### Task 5: Libros de IVA y archivos
**Files:** `impuestos/libros-iva/libro-ventas.service.ts` (columnas `percepcionesIva`, `percepcionesIibb` por fila y totales; Excel/PDF), `libro-iva-digital.ts` (`percepcionesNacionales`, `percepcionesIibb` de ventas); Create `impuestos/retenciones/arba-percepciones.ts` y formato `ARBA_PERCEPCION` en `formato/formatos.ts`; `agip.ts` (percepciones 901 de facturas y ND; NC al detalle con el aviso); `sire.ts` (detalle de percepciones de IVA en el SIRE de IVA); `presentaciones.service.ts` (generador `ARBA_PERCEPCIONES`, quincena como ARBA, correlativo propio). **Test:** `apps/api/test/percepciones-archivos.e2e-spec.ts`.
- [ ] Pruebas que fallan: Libro IVA Ventas del mes con percepción IIBB 30 en su columna y en el total; Libro IVA Digital con `percepcionesIibb` 30; ARBA percepciones: un renglón con CUIT con guiones, F, A, base e importe, y NC con importes negativos, nombre `AR-…-7-LOTE00001`; correlativo independiente del de retenciones; AGIP con renglón `tipoOperacion` 2 de la factura y el aviso de NC; cliente sin situación de IIBB → 400 `Complete la situación de Ingresos Brutos de: …`; SIRE de IVA con el detalle de percepciones.
- [ ] Implementar. `npx jest --runInBand test/percepciones-archivos test/impuestos` → PASS. Commit `feat(impuestos): percepciones en libros y archivos de ARBA, AGIP y SIRE`.

### Task 6: Pantallas y e2e
**Files:** `apps/web/src/pagos/ConfigRetencionesPage.tsx` (título *Retenciones y percepciones*; campos de percepción por jurisdicción; régimen de percepción IVA; agente de percepción IVA), ficha de IIBB del tercero (alícuota de percepción opcional), formulario de comprobante de venta (renglones de percepción de solo lectura con origen), Libro IVA Ventas (columnas), Presentaciones (tipo ARBA percepciones); `e2e/percepciones-ventas.spec.ts` (proyecto propio después de `posicion-iibb`). **Test:** `apps/web/src/ventas/percepciones.test.tsx`.
- [ ] Pruebas que fallan: el resumen de la factura muestra «Percepción IIBB 902 Buenos Aires» con su origen y el total con la percepción; la configuración muestra los campos de percepción. e2e: el administrador activa la percepción de 902 con alícuota por defecto 3 % para clientes vinculados, carga la provincia «Buenos Aires» al cliente, emite una factura y ve la percepción en el comprobante y en el PDF.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): percepciones en ventas`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final; actualizar `docs/pendientes.md` §2 con los datos a verificar (diseño ARBA percepciones, códigos de tributo, archivo de NC de AGIP, lote SIRE de percepciones).
