# Entrega 49 — Pulido de Impuestos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Arreglar los menores de las entregas 43 a 48 que dan 500, pierden datos o dan números o archivos equivocados.

**Architecture:** Arreglos puntuales en los módulos de cada entrega, cada uno con su prueba (en el e2e de la API de esa entrega, en un archivo `test/pulido49-*.e2e-spec.ts` por tarea, o en la prueba web).

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-entrega-49-pulido-impuestos-design.md`

## Global Constraints
- Mensajes exactos de la spec.
- Cada arreglo con una prueba que falla primero.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Liquidaciones de Bienes Personales con años válidos que ya existen (no deben dar 400 por el rango).
2. Subcuentas del plan modelo: cambiar el ajuste impositivo de 1.2.01 cambia 1.2.01.001–003.
3. F.2003 con fecha de OP anterior al pago: no cambia.
4. Reabrir un ejercicio sin DJ o con la DJ en borrador: sigue funcionando.
5. Padrones de 901/902: sin cambios.

---

### Task 1: SIRE y Ganancias exterior (E43)
**Files:** `pagos/config/config-pagos.controller.ts` (alícuotas < 100); `impuestos/retenciones/sire-exterior.ts` (fecha del comprobante = mín(fecha OP, fecha de pago)); `pagos/consultas/consultas-pagos.service.ts` (`certificadoSire`: impuesto ∈ {IVA, SUSS, GANANCIAS_EXTERIOR} o 400 `La retención no se informa en el SIRE`; auditoría `MODIFICAR`); web `pagos/TablaRetenciones.tsx` (`codigoSire`, `codigoAlicuota` en `OCULTOS` o como texto; `aplicaCdi`/`acrecentamiento` → `Sí`/`No`; descripción con `(asumida por la empresa)` si `acrecentamiento === 'true'`). **Test:** `apps/api/test/pulido49-sire.e2e-spec.ts`; `apps/web/src/pagos/sire.test.tsx` (agregar).
- [ ] Pruebas que fallan: régimen exterior con `alicuotaSinCdi: 100` → 400 `La alícuota debe ser menor que 100`; F.2003 de una OP con fecha 10/11 pagada (fechaPago corrida en la base) el 05/11 → posiciones 59–68 = `05/11/2026`; `PATCH certificado-sire` en una retención de Ganancias local → 400 con el mensaje; en una de IVA → registro de auditoría `OrdenPagoRetencion`; web: la tabla de retenciones muestra `Ganancias exterior (régimen 160) (asumida por la empresa)` y el tooltip no tiene `$ 160`.
- [ ] `npx jest --runInBand test/pulido49-sire test/ganancias-exterior test/sire-anulaciones` y vitest de `pagos` → PASS. Commit `fix(pagos): pulido de SIRE y Ganancias exterior`.

### Task 2: Amortización impositiva y ajuste por inflación (E44, E45)
**Files:** `bienes-uso/bienes.service.ts` (`modificar`: si el nuevo valor de origen < terreno → 400 `El terreno no puede superar el valor de origen`); `bienes-uso/planilla-impositiva.service.ts` (aviso de tope por defecto si hay `AUTOMOVIL` y `topeAutomovilesCosto` = 20000) y `.controller.ts` (Excel con *Deducible* y *Costo computable de la baja*, total deducible); web `bienes-uso/BienesPage.tsx` (vida útil impositiva con `NumberInput`); `contabilidad/plan-cuentas/plan-cuentas.service.ts` (`ajusteImpositivo` solo si la cuenta es ACTIVO/PASIVO, si no 400 `Solo las cuentas de activo y pasivo tienen ajuste impositivo`; al cambiarlo en una cuenta con hijos se aplica a todos sus descendientes); planillas de E44/E45/E46 (`ejercicioId` no UUID → 404 `Ejercicio no encontrado`); web `impuestos/AjusteImpositivoPage.tsx` (la alerta solo en el modal mientras está abierto). **Test:** `apps/api/test/pulido49-impositiva.e2e-spec.ts`; vitest de `bienes-uso` e `impuestos`.
- [ ] Pruebas que fallan: bien con terreno 500 → `PUT` con valor de origen 400 → 400; planilla con automóvil y tope por defecto → aviso exacto; Excel con `Deducible` en la primera fila de títulos (leer con ExcelJS); `PATCH` `ajusteImpositivo` en 3.1.01 → 400; en 1.2.01 (padre) → 1.2.01.001 también `EXCLUIDO`; `GET /api/bienes-uso/planilla-impositiva?ejercicioId=abc`, `/api/impuestos/ajuste-inflacion?ejercicioId=abc` y `/api/impuestos/dj-ganancias?ejercicioId=abc` → 404; web: la vida útil impositiva es un campo numérico.
- [ ] `npx jest --runInBand test/pulido49-impositiva test/bienes-impositiva test/ajuste-impositivo test/plan-cuentas` y vitest → PASS. Commit `fix(impuestos): pulido de amortización y ajuste impositivos`.

### Task 3: DJ de Ganancias y Bienes Personales (E46, E47)
**Files:** `impuestos/dj-ganancias/dj-ganancias.service.ts` (`dj()` con `upsert` sin actualizar); `contabilidad/cierre/*` (`reabrir`: si `DjGananciasSociedades.estado = PRESENTADA` → 400 `La DJ de Ganancias del ejercicio está presentada: anule la presentación antes de reabrir`); web `impuestos/ConfigImpuestosPage.tsx` (botón *Quitar* por tramo); `impuestos/bienes-personales/*` (año 2000–2100 en la consulta → 400 `Año inválido`; ajuste/participaciones/copiar validan el ejercicio del año antes de crear la fila; socio repetido → 400 `El socio está repetido`; ajuste `importe` con `abs < 1e16` y 2 decimales). **Test:** `apps/api/test/pulido49-dj-bp.e2e-spec.ts`; vitest de `impuestos`.
- [ ] Pruebas que fallan: dos `GET` simultáneos de la DJ de un ejercicio nuevo → ambos 200; reabrir el ejercicio con la DJ presentada → 400 con el mensaje (y sin DJ → como antes); `GET bienes-personales?anio=100000000000000000000` → 400 `Año inválido`; `PUT ajuste` en 2099 → 400 `No hay un ejercicio que cierre en 2099` y sin filas creadas; participaciones con el mismo socio dos veces → 400 `El socio está repetido`; ajuste 1e20 → 400; web: quitar un tramo de la escala.
- [ ] `npx jest --runInBand test/pulido49-dj-bp test/dj-ganancias test/bienes-personales test/contabilidad-cierre-ejercicio` y vitest → PASS. Commit `fix(impuestos): pulido de la DJ de Ganancias y Bienes Personales`.

### Task 4: Otras jurisdicciones de IIBB (E48)
**Files:** `pagos/padron/padron.controller.ts` (esquema: `vigenciaDesde` y `vigenciaHasta` juntas o ninguna → `Indique las dos vigencias o ninguna`; con `FIJO` cada campo «desde-hasta», si no número ≥ 1 → `Columna o posición inválida`; `periodo` validado `AAAAMM` con mes 01–12 antes de cargar → 400 `Período inválido (AAAAMM)`); `impuestos/sircreb/sircreb.service.ts` (quitar BOM; el encabezado es la primera línea no vacía). **Test:** `apps/api/test/pulido49-iibb.e2e-spec.ts`.
- [ ] Pruebas que fallan: formato con solo `vigenciaDesde` → 400; delimitado con `cuit: '1-11'` → 400; ancho fijo con `cuit: '5'` → 400; columna `0` → 400; carga con `periodo: '202613'` → 400 `Período inválido (AAAAMM)`; importación SIRCREB `'﻿\n\nperiodo;jurisdiccion;importe\n202610;902;100\n'` → 1 importada.
- [ ] `npx jest --runInBand test/pulido49-iibb test/padron-formato test/padron test/sircreb` → PASS. Commit `fix(impuestos): pulido de padrones y SIRCREB`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final.
