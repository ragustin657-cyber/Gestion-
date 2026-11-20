# Entrega 37 — Posición mensual de IVA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Posición mensual de IVA con cierre, arrastre de saldos, asiento de liquidación, bloqueo de los libros del mes cerrado, pantalla y descargas.

**Architecture:** Módulo `apps/api/src/impuestos/posicion-iva/` (servicio de cálculo puro + servicio con cierre/reapertura + controlador), apoyado en los libros existentes (`LibroVentasService.libro`, el libro de compras de `ConsultasService`) y en `AsientosService.generar/contraasiento`. Un guardia `verificarMesIvaAbierto(tx, fecha)` en `apps/api/src/impuestos/posicion-iva/bloqueo.ts` que usan compras y ventas.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-entrega-37-posicion-iva-design.md`

## Global Constraints
- Mensajes exactos de la spec (§4, §6, §8), entre ellos `La posición de IVA de MM/AAAA está cerrada: use una fecha de un mes abierto o reabra la posición`, `Cierre primero la posición de IVA de MM/AAAA`, `Reabra primero la posición de IVA de MM/AAAA`, `Configure el primer mes y los saldos iniciales de IVA`, `El mes es anterior al inicio de la liquidación de IVA en el sistema`, `Solo se cierra un mes terminado`, `Hay posiciones de IVA cerradas: reábralas para cambiar el inicio`, `El mes anterior no está cerrado: los saldos anteriores pueden cambiar`.
- Cuentas `1.1.03.009`, `1.1.03.010`, `2.1.02.006`; conceptos `IVA_SALDO_TECNICO`, `IVA_LIBRE_DISPONIBILIDAD`, `IVA_A_PAGAR`.
- Asiento de liquidación con `origenTipo: 'POSICION_IVA'`, fecha último día del mes; contraasiento con la misma fecha.
- Reloj de pruebas 2026-11-06: los meses cerrables en pruebas son ≤ 10/2026 (crear ejercicio contable si el mes lo necesita).
- No correr jest y la e2e en paralelo; un solo jest a la vez (el global-setup recrea la base).

## Review Focus
1. Nota de crédito de compra que deja el crédito del mes negativo: el cálculo y el asiento (crédito negativo va al Debe) cuadran (Task 1).
2. Mes sin movimientos: se cierra con ceros y arrastra los saldos iniciales (Task 2).
3. Factura de compra con fecha contable en un mes cerrado → 400; con fecha en un mes abierto → ok (Task 3).
4. Reabrir con el mes siguiente cerrado → 400; reabrir con el período contable cerrado → error del período (Task 2).
5. El Libro IVA del mes cerrado no muestra el aviso de diferencia con el mayor por el asiento de liquidación (Task 2).

---

### Task 1: Cálculo puro
**Files:** Create `apps/api/src/impuestos/posicion-iva/calculo.ts`. **Test:** `apps/api/src/impuestos/posicion-iva/calculo.spec.ts`.
**Produces:** `calcularPosicionIva(e: { debito: Record<string,string>; credito: Record<string,string>; retenciones: string; percepciones: string; saldoTecnicoAnterior: string; libreAnterior: string }) → { totalDebito, totalCredito, saldoTecnicoAFavor, impuestoDeterminado, impuestoAPagar, libreDisponibilidad }` (strings 2 decimales) y `renglonesAsiento(p) → { concepto, debe, haber }[]` (sin ceros; crédito negativo al Debe).
- [ ] Pruebas que fallan: a pagar (DF 21.000, CF 10.000, ret 1.000, perc 500 → pagar 9.500); saldo técnico a favor (DF 5.000, CF 8.000 → técnico 3.000; ret 1.000 y libre ant 200 → libre 1.200); libre disponibilidad (determinado 1.000, ret 1.500 → libre 500); con saldos anteriores; crédito negativo; asiento cuadra (Σdebe = Σhaber) en los tres casos.
- [ ] `npx jest src/impuestos/posicion-iva` → FAIL → implementar → PASS. Commit `feat(iva): cálculo de la posición mensual`.

### Task 2: Datos, servicio, cierre, reapertura y cuadre
**Files:** `prisma/schema.prisma` (PosicionIva, campos de ConfigImpuestos) + migraciones (esquema; datos: cuentas y ConfigCuenta para empresas existentes); `apps/api/src/seed/plan-cuentas-modelo.ts`; `apps/api/src/compras/config/conceptos.ts`; `apps/api/src/impuestos/posicion-iva/{posicion-iva.service,posicion-iva.controller}.ts`; `apps/api/src/impuestos/config/*` (campos de inicio); `apps/api/src/impuestos/libros-iva/libro-ventas.service.ts` (`cuadreIva` excluye `origenTipo: 'POSICION_IVA'` y sus contraasientos); `modelos-empresa.ts`; módulo. **Test:** `apps/api/test/posicion-iva.e2e-spec.ts`.
- [ ] Pruebas que fallan: borrador del mes con DF/CF por alícuota, retenciones (ReciboRetencion IVA) y percepciones (percepcionIva) — usando las ayudas de ventas, compras y recibos de las pruebas existentes; sin inicio configurado → cerrar 400; inicio + saldos iniciales → cerrar el mes de inicio crea la fila y el asiento (cuentas y montos de §6); el mes siguiente usa los saldos del cerrado; cerrar sin el anterior cerrado → 400; mes no terminado → 400; reabrir con el siguiente cerrado → 400; reabrir borra la fila y el asiento queda anulado con contraasiento del último día del mes; mes sin movimientos se cierra y arrastra; aviso con el anterior sin cerrar; cambiar el inicio con meses cerrados → 400; el Libro IVA Ventas del mes cerrado no trae el aviso de diferencia con el mayor; `GET /meses` con estados; `?formato=xlsx|pdf` responde archivo.
- [ ] Implementar; advisory lock `posicion-iva:<empresa>` en cerrar y reabrir; migraciones con `prisma migrate diff`, desplegadas en `gestion`, `gestion_test`, `gestion_mig`.
- [ ] `npx jest --runInBand test/posicion-iva test/impuestos test/compras-config test/ventas-maestros test/pagos-config` → PASS (ajustar los conteos de conceptos a 43). Commit `feat(iva): posición mensual con cierre y asiento`.

### Task 3: Bloqueo de los libros del mes cerrado
**Files:** `apps/api/src/impuestos/posicion-iva/bloqueo.ts`; `apps/api/src/compras/comprobantes/comprobantes.service.ts` (confirmar y anular); `apps/api/src/ventas/emision/emision.service.ts` (emitir) y la creación de comprobantes de venta. **Test:** `apps/api/test/posicion-iva.e2e-spec.ts`.
**Produces:** `verificarMesIvaAbierto(tx: TxEmpresa, fecha: Date): Promise<void>`.
- [ ] Pruebas que fallan: con 09/2026 cerrado, confirmar una compra con fecha contable 15/09 → 400 con el mensaje; con fecha contable 01/10 → 201; anular una compra de 09 → 400; emitir una venta con fecha 20/09 → 400.
- [ ] Implementar. `npx jest --runInBand test/posicion-iva test/compras test/ventas` → PASS. Commit `feat(iva): el mes cerrado bloquea sus libros`.

### Task 4: Pantallas y e2e
**Files:** `apps/web/src/impuestos/PosicionIvaPage.tsx` (año con 12 meses, detalle, avisos, Cerrar/Reabrir/Excel/PDF, enlace al asiento), configuración de impuestos (primer mes y saldos), menú y rutas; `e2e/posicion-iva.spec.ts` (proyecto propio después de `retenciones-iva-suss`). **Test:** `apps/web/src/impuestos/posicion-iva.test.tsx`.
- [ ] Pruebas que fallan: el detalle muestra débito por alícuota, *Impuesto a pagar* o *Saldo de libre disponibilidad* según el caso, y los avisos; la tabla de meses marca cerrados. e2e: el contador configura el inicio en el mes anterior al actual con saldos en cero, abre la posición de ese mes, la cierra, ve el asiento y la reabre.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): posición de IVA`.

Al final: suite completa de la API, web y e2e sola; revisión final.
