# Entrega 38 — IIBB Convenio Multilateral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Liquidación mensual de IIBB por jurisdicción (Convenio Multilateral) con cierre, arrastre de saldos a favor, asiento y bloqueo; informe de ingresos por provincia; las tarjetas entran en IIBB y en la posición de IVA.

**Architecture:** Módulo `apps/api/src/impuestos/posicion-iibb/` calcado de `posicion-iva/`: `calculo.ts` puro, `posicion-iibb.service.ts` (ver, meses, cerrar, reabrir, jurisdicciones), `posicion-iibb.controller.ts`, `provincias.ts` (normalización) e `ingresos-provincia.service.ts`. El guardia `bloqueo.ts` de la E37 pasa a exportar también `verificarMesIibbAbierto`. Los ingresos del mes salen de un helper compartido con el criterio de `ventasDelAmbiente`.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-entrega-38-iibb-convenio-multilateral-design.md`

## Global Constraints
- Mensajes exactos de la spec: `Cargue las jurisdicciones y coeficientes de Convenio Multilateral de AAAA`, `Los coeficientes de AAAA suman X: deben sumar 1`, `Hay meses de AAAA liquidados: reábralos para cambiar las jurisdicciones`, `Hay liquidaciones de IIBB cerradas: reábralas para cambiar el inicio`, `Hay retenciones o percepciones de la jurisdicción X, que no está en el Convenio de AAAA`, `Los saldos a favor de X (importe) no pasan a AAAA porque la jurisdicción no está en el Convenio: quedan en la cuenta IIBB Saldo a favor`, `Configure el primer mes de la liquidación de IIBB`, `Cierre primero la liquidación de IIBB de MM/AAAA`, `Reabra primero la liquidación de IIBB de MM/AAAA`, `La liquidación de IIBB de MM/AAAA está cerrada: use una fecha de un mes abierto o reabra la liquidación`. Mensajes de la E37 reutilizados para mes no terminado, mes anterior al inicio, ventas pendientes en ARCA y anterior sin cerrar (con «liquidación de IIBB» en lugar de «posición de IVA»).
- En los mensajes, X de jurisdicción es `<código> <nombre>` (p. ej. `902 Buenos Aires`); la suma de coeficientes con 4 decimales.
- Cuentas `5.2.13`, `1.1.03.011`, `2.1.02.007`; conceptos `IIBB_IMPUESTO`, `IIBB_SALDO_A_FAVOR`, `IIBB_A_PAGAR` (total de conceptos 46).
- Asiento `origenTipo: 'POSICION_IIBB'`, fecha último día del mes; contraasiento con la misma fecha; advisory lock `posicion-iibb:<empresa>` (exclusivo en cerrar/reabrir, compartido en el guardia).
- Reloj de pruebas 2026-11-06: meses cerrables ≤ 10/2026. Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Nota de crédito que deja los ingresos del mes negativos: impuesto negativo → saldo a favor; el asiento cuadra (Task 1).
2. Jurisdicción con coeficiente 0 y retenciones: todo a saldo a favor (Task 1).
3. Saldo a favor de una jurisdicción que no está en el año siguiente: aviso en enero y no se arrastra; el asiento de enero no lo toca (Task 2).
4. Liquidación de tarjeta con IIBB de un mes cerrado → 400; con sólo IVA en un mes de IIBB cerrado → ok (Task 3).
5. `PUT` de jurisdicciones con `saldoInicial` en un año distinto del de inicio → se guarda 0 (Task 2).

---

### Task 1: Cálculo puro
**Files:** Create `apps/api/src/impuestos/posicion-iibb/calculo.ts`. **Test:** `apps/api/src/impuestos/posicion-iibb/calculo.spec.ts`.
**Produces:**
- `calcularPosicionIibb(e: { ingresos: string; jurisdicciones: { jurisdiccion: string; coeficiente: string; alicuota: string; retenciones: string; percepciones: string; saldoAnterior: string }[] }) → { ingresos, detalle: { jurisdiccion, coeficiente, alicuota, base, impuesto, retenciones, percepciones, saldoAnterior, aPagar, saldoAFavor }[], totales: {…mismos campos numéricos} }` (strings 2 decimales; base e impuesto redondeados por jurisdicción).
- `renglonesAsientoIibb(p) → { concepto, debe, haber }[]`: neto por cuenta, sin ceros; impuesto negativo al Haber de `IIBB_IMPUESTO`; `RETENCION_SUFRIDA_IIBB` y `PERCEPCION_IIBB` al Haber; `IIBB_SALDO_A_FAVOR` neto (nuevo − anterior); `IIBB_A_PAGAR` al Haber.
- [ ] Pruebas que fallan: ingresos 1.000.000, 902 coef 0,6 alíc 3,5 / 901 coef 0,4 alíc 2 → bases 600.000 / 400.000, impuestos 21.000 / 8.000; retención 5.000 en 902 → a pagar 16.000; percepciones y saldo anterior mayores al impuesto → saldo a favor; no compensa (una a pagar y otra a favor a la vez); ingresos negativos → saldo a favor = −impuesto + créditos; coeficiente 0 con retención 1.000 → saldo a favor 1.000; el asiento cuadra en todos los casos y omite ceros.
- [ ] `npx jest src/impuestos/posicion-iibb` → FAIL → implementar → PASS. Commit `feat(iibb): cálculo de la liquidación por jurisdicción`.

### Task 2: Datos, jurisdicciones, servicio, cierre y reapertura
**Files:** `prisma/schema.prisma` (`JurisdiccionCm`, `PosicionIibb`, `ConfigImpuestos.iibbInicioAnio/Mes`) + migraciones (esquema; datos: cuentas y `ConfigCuenta` para empresas existentes); `apps/api/src/seed/plan-cuentas-modelo.ts`; `apps/api/src/compras/config/conceptos.ts`; `modelos-empresa.ts`; `apps/api/src/impuestos/posicion-iibb/{posicion-iibb.service,posicion-iibb.controller,jurisdicciones}.ts`; `apps/api/src/impuestos/config/*` (inicio y guardia); módulo de impuestos. Helper compartido `ingresosGravados(tx, empresaId, desde, hasta)` en `apps/api/src/impuestos/posicion-iibb/ingresos.ts`. **Test:** `apps/api/test/posicion-iibb.e2e-spec.ts`.
**Produces:** `GET/PUT /api/impuestos/iibb/jurisdicciones?anio`; `GET /api/impuestos/iibb/posicion/:anio/:mes` (`?formato=xlsx|pdf`), `GET /api/impuestos/iibb/posicion/:anio` (meses), `POST …/:anio/:mes/cerrar`, `POST …/:anio/:mes/reabrir`; `PosicionIibbService.ver/meses/cerrar/reabrir`; tabla de jurisdicciones `JURISDICCIONES_CM: Record<string,string>` (`'901': 'Ciudad Autónoma de Buenos Aires'` … `'924': 'Tierra del Fuego'`) en `jurisdicciones.ts`.
- [ ] Pruebas que fallan:
  - `PUT` jurisdicciones reemplaza la lista; `saldoInicial` en un año ≠ inicio → 0; con un mes del año cerrado → 400.
  - Borrador del mes: ingresos de factura + NC (en dólares por cotización), retención IIBB de recibo, percepción IIBB de compra, por jurisdicción.
  - Aviso por retención de jurisdicción fuera del Convenio (ignorada).
  - Cerrar sin inicio → 400; sin jurisdicciones → 400; coeficientes que no suman 1 → 400 `Los coeficientes de 2026 suman 0.9000: deben sumar 1`; mes no terminado → 400; anterior sin cerrar → 400.
  - Cerrar el mes de inicio crea la fila y el asiento (cuentas y montos de §5 de la spec); el mes siguiente arrastra el saldo a favor.
  - Saldo a favor de diciembre de una jurisdicción ausente en enero → aviso de la spec en enero y no se arrastra (usar 12/2025 y 01/2026 con `crearEjercicio` 2025).
  - Reabrir con el siguiente cerrado → 400; reabrir borra la fila y deja contraasiento.
  - Cambiar el inicio con meses cerrados → 400. `GET` meses con estados; `?formato=xlsx|pdf` responde archivo.
- [ ] Implementar (calcado de `PosicionIvaService`); migraciones con `prisma migrate diff`, desplegadas en `gestion`, `gestion_test`, `gestion_mig`.
- [ ] `npx jest --runInBand test/posicion-iibb test/posicion-iva test/impuestos test/compras-config test/ventas-maestros test/pagos-config` → PASS (conteos de conceptos a 46). Commit `feat(iibb): liquidación mensual con cierre y asiento`.

### Task 3: Bloqueo y tarjetas (IIBB y corrección de IVA)
**Files:** `apps/api/src/impuestos/posicion-iva/bloqueo.ts` (agrega `verificarMesIibbAbierto`); `compras/comprobantes/comprobantes.service.ts`, `ventas/emision/emision.service.ts`, `ventas/recibos/recibos.service.ts` (retenciones `IIBB`), `tesoreria/operaciones/tarjetas.service.ts` (crear y anular liquidación); `posicion-iva.service.ts` y `posicion-iibb.service.ts` (fuentes de tarjetas). **Test:** `apps/api/test/posicion-iibb.e2e-spec.ts`, `apps/api/test/posicion-iva.e2e-spec.ts`.
**Produces:** `verificarMesIibbAbierto(tx: TxEmpresa, empresaId: string, fecha: Date): Promise<void>`.
- [ ] Pruebas que fallan:
  - Con 09/2026 de IIBB cerrado: confirmar compra con fecha contable 15/09 → 400 con el mensaje de IIBB; anular compra de 09 → 400; emitir venta 20/09 → 400; recibo con retención IIBB fechada en 09 → 400; anular ese recibo → 400.
  - Liquidación de tarjeta con retención IIBB fechada en el mes: suma a `retenciones` de su jurisdicción en el borrador de IIBB; percepción IIBB suma a `percepciones`.
  - Liquidación de tarjeta con IIBB en un mes de IIBB cerrado → 400 al crear y al anular; con sólo IVA → 201 si el de IVA está abierto.
  - Posición de IVA: retención y percepción de IVA de una liquidación de tarjeta suman a `retenciones`/`percepciones`; con el mes de IVA cerrado, crear la liquidación con IVA → 400.
- [ ] Implementar. `npx jest --runInBand test/posicion-iibb test/posicion-iva test/compras test/ventas test/tarjetas test/recibos` → PASS. Commit `feat(iibb): el mes cerrado bloquea sus libros; las tarjetas entran en IIBB e IVA`.

### Task 4: Informe de ingresos por provincia
**Files:** `apps/api/src/impuestos/posicion-iibb/provincias.ts` (`jurisdiccionDeProvincia(texto: string | null): string | null`), `ingresos-provincia.service.ts`, ruta en el controlador. **Test:** `apps/api/src/impuestos/posicion-iibb/provincias.spec.ts`, `apps/api/test/posicion-iibb.e2e-spec.ts`.
**Produces:** `GET /api/impuestos/iibb/ingresos-por-provincia?anio` (`?formato=xlsx|pdf`) → `{ filas: { jurisdiccion: string | null, nombre, ingresos, porcentaje }[], total }`.
- [ ] Pruebas que fallan: `jurisdiccionDeProvincia('CABA'|'Capital Federal'|'Ciudad de Buenos Aires') === '901'`, `('Córdoba'|'cordoba') === '904'`, `('Buenos Aires') === '902'`, `('xx') === null`; e2e: dos clientes (Córdoba y sin provincia) con facturas del año → dos filas, «Sin provincia», porcentajes que suman 100; xlsx responde archivo.
- [ ] Implementar. `npx jest src/impuestos/posicion-iibb && npx jest --runInBand test/posicion-iibb` → PASS. Commit `feat(iibb): informe de ingresos por provincia`.

### Task 5: Pantallas y e2e
**Files:** `apps/web/src/impuestos/PosicionIibbPage.tsx` (año con 12 meses, detalle por jurisdicción con totales, avisos, Cerrar/Reabrir/Excel/PDF, enlace al asiento), `apps/web/src/impuestos/IngresosProvinciaPage.tsx`, `ConfigImpuestosPage.tsx` (primer mes de IIBB; tabla de jurisdicciones del año con suma de coeficientes; saldo inicial sólo en el año de inicio), menú y rutas; `e2e/posicion-iibb.spec.ts` (proyecto propio después de `posicion-iva`). **Test:** `apps/web/src/impuestos/posicion-iibb.test.tsx`.
- [ ] Pruebas que fallan: el detalle muestra cada jurisdicción con *A pagar* o *Saldo a favor* y los totales; la configuración muestra la suma de coeficientes y oculta *Saldo inicial* fuera del año de inicio; el informe muestra «Sin provincia». e2e: el contador configura el inicio dos meses atrás y una jurisdicción 901 con coeficiente 1, abre la liquidación de ese mes, la cierra y la reabre.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): liquidación de IIBB e ingresos por provincia`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final.
