# Entrega 22: pulido de sueldos. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los pendientes de las Entregas 18 a 21 que dan importes incorrectos, pierden datos o traban al usuario.

**Architecture:** Arreglos puntuales en `apps/api/src/sueldos/`, en `packages/shared/src/letras.ts` y en `apps/web/src/sueldos/`. Lleva una migración con dos columnas de copia y un cambio de datos (convenio de los conceptos de Comercio).

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-entrega-22-pulido-sueldos-design.md` (los números de arreglo del plan son los del spec).

## Global Constraints

- **Mensajes:** los mensajes exactos del spec.
- **Pruebas:**
  - cada arreglo con una prueba que falla antes;
  - reloj de pruebas 2026-11-06;
  - `prepararSueldos` da Vendedor B, ingreso 2021-03-01.
- **Migración:** `apps/api/prisma/migrations/20261121090000_pulido_sueldos/migration.sql`. No debe borrar `Liquidacion_mensual_sac_unica`.

## Review Focus

1. **Neto negativo en una final** (renuncia con muchos descuentos fijos) → no aparece como pendiente de pago y el PDF dice "menos pesos". Prueba en Task 2.
2. **Dos GET simultáneos de un borrador con un empleado nuevo** → ambos 200 y un solo recibo. Prueba en Task 3.
3. **Segundo convenio con un empleado** → sin presentismo, FAECYS ni sindicato de Comercio. Prueba en Task 4.
4. **F.931 de un mes cerrado después de editar los parámetros** → mismos imponibles que antes de editar. Prueba en Task 4.
5. **Período de vacaciones en el mes de una final en borrador con la mensual cerrada** → aceptado y pagado en la final. Prueba en Task 3.

---

### Task 1: Letras y fechas (arreglos 1 en letras, 3 y 14)

**Files:**
- Modify `packages/shared/src/letras.ts`, `packages/shared/src/letras.test.ts`, `apps/api/src/sueldos/calculo.ts` y `apps/api/src/sueldos/calculo.spec.ts`.

- [ ] **Step 1: Tests que fallan:**
  - `montoEnLetras('-5.30')` → `menos pesos cinco con 30/100`;
  - `montoEnLetras('21000000')` → `pesos veintiún millones con 00/100`;
  - `montoEnLetras('121000000')` → `pesos ciento veintiún millones con 00/100`;
  - `antiguedadDetalle(f('2024-02-29'), f('2025-03-01'))` → `{ anios: 1, meses: 0, dias: 0 }`;
  - `aniosIndemnizables(f('2024-02-29'), f('2025-06-01'))` → 1 (el último aniversario es el 01/03/2025 y la fracción no supera 3 meses).
- [ ] **Step 2:** FAIL (`npx vitest run src/letras` en shared; `npx jest src/sueldos/calculo` en api).
- [ ] **Step 3:** Implementar.
  - `sumarMeses` pasa el 29/02 de un año no bisiesto al 1/3, igual que `antiguedadAnios`.
  - Recompilar shared.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `fix(sueldos): letras con negativos y veintiún, y ingreso un 29/02`.

### Task 2: Importes y validaciones (arreglos 1, 2, 9, 10, 11, 16 y 20)

**Files:**
- Modify `apps/api/src/sueldos/{liquidaciones.service.ts,pagos.service.ts,recibo-pdf.ts,maestros.service.ts,maestros.controller.ts,vacaciones.service.ts}`.
- Test `apps/api/test/pulido22-importes.e2e-spec.ts`.

**Interfaces:**
- **Produces** `GET /api/sueldos/conceptos/avisos` → `string[]`.
- **Pendientes de pago:** `pendientePago` y "pagar todos" excluyen los recibos con neto ≤ 0. En la consulta, cada recibo trae `sinNeto: boolean`.

- [ ] **Step 1: Tests que fallan:**
  - `it('neto negativo no queda pendiente')` (Review Focus 1):
    - concepto FIJO de descuento de 2.000.000 cargado como novedad `IMPORTE` en la mensual;
    - cerrar → `pendientePago '0.00'`, recibo con `sinNeto: true`;
    - `POST pagos` sin `reciboIds` → 400 `No hay recibos pendientes de pago`;
    - el texto del PDF contiene `menos pesos`.
  - `it('ausencias topeadas')`: empleado con ingreso 2026-11-20 (11 días); novedad de 15 días de ausencia → 400 `Las ausencias (15 días) superan los días trabajados del mes (11)`.
  - `it('cuenta del concepto')`: POST concepto con `cuentaContableId` de una cuenta no imputable (`2.1.03`) → 400 `Cuenta contable inválida: debe ser imputable y activa`.
  - `it('novedades de una final')`: final de un empleado; PUT novedades con otro empleado → 400 `La liquidación final es de otro empleado`.
  - `it('saldo inicial')`: año 2020 con ingreso 2021 → 400 `El año es anterior al ingreso del empleado`; dos PUT simultáneos del mismo año → ambos responden 200 o 400 (nunca 500).
  - `it('ficha con años de saldo inicial')` (arreglo 20): saldo inicial 2024 = 5 → `GET empleados/:id/vacaciones` incluye `anio: 2024`.
  - `it('aviso de conceptos de vacaciones')`: con el 151 inactivo → `GET conceptos/avisos` = `['Faltan los conceptos de vacaciones (pago y descuento): las vacaciones no se liquidan']`; con ambos activos → `[]`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS; `test/sueldos*` y `test/pulido22*` en verde.
- [ ] **Step 5:** Commit `fix(sueldos): neto negativo, ausencias topeadas y validaciones`.

### Task 3: Concurrencia, vacaciones y liquidación final (arreglos 4, 5, 12 y 13)

**Files:**
- Modify `apps/api/src/sueldos/{egresos.service.ts,liquidaciones.service.ts,vacaciones.service.ts,pagos.service.ts}`.
- Test `apps/api/test/pulido22-concurrencia.e2e-spec.ts`.

- [ ] **Step 1: Tests que fallan:**
  - `it('dos consultas simultáneas de un borrador')` (Review Focus 2):
    - mensual en borrador; alta de un empleado nuevo por prisma (sin recalcular);
    - `Promise.all` de dos GET → ambos 200, y un recibo de ese empleado.
  - `it('modificar y eliminar una final cerrada')`: con la final cerrada, PUT egreso → 400 `La liquidación está cerrada`; DELETE → 400.
  - `it('eliminar una final con la mensual cerrada')`:
    - final en borrador con egreso en 11/2026 y la mensual de 11/2026 cerrada (sin el empleado);
    - DELETE de la final → 400 `La liquidación mensual de 11/2026 ya está cerrada: el empleado quedaría sin recibo de ese mes. Reábrala antes de eliminar la final`.
  - `it('vacaciones con la final')` (Review Focus 5):
    - mensual de 11/2026 cerrada con otro empleado; baja del empleado en 11/2026 (final en borrador); período del 02/11 al 05/11 → 201 y la final tiene 150/151;
    - cerrar la final; otro período del 07/11 al 08/11 → 400 `La liquidación final de 11/2026 ya está cerrada: marque el período como liquidado fuera del sistema o reábrala`.
  - `it('período y cierre simultáneos')`: `Promise.all` de alta de período y cierre de la mensual → si el período quedó sin pagar, el alta tuvo que dar 400 (la mensual ya estaba cerrada); nunca un período "Pendiente de pago" en un mes cerrado.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Los bloqueos son `SELECT … FOR UPDATE` acotados por `empresaId` y la relectura del estado después de bloquear.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `fix(sueldos): bloqueos, vacaciones con la final y eliminar finales`.

### Task 4: Copias, convenio y textos (arreglos 6, 7, 8 y 22)

**Files:**
- Modify `apps/api/prisma/schema.prisma` y la migración.
- Modify `apps/api/src/sueldos/{liquidaciones.service.ts,contabilizacion.service.ts,f931.service.ts,salidas.controller.ts,modelo.ts,pagos.service.ts}`.
- Test `apps/api/test/pulido22-copias.e2e-spec.ts`.

**Interfaces:**
- **Schema:** `ReciboSueldo.formaPago FormaPagoSueldo?`, `Liquidacion.baseMaximaAportes Decimal?` y `Liquidacion.detraccion Decimal?`.
- **Migración (datos):**
  - completa `formaPago` desde el empleado;
  - asigna el convenio de Comercio a los conceptos 120, 530 y 540 sin convenio de las empresas con Comercio.

- [ ] **Step 1: Tests que fallan:**
  - `it('forma de pago copiada')`: cerrar con el empleado en transferencia; cambiar el empleado a efectivo → el PDF dice `Transferencia bancaria`.
  - `it('parámetros copiados')` (Review Focus 4):
    - cerrar noviembre; el F.931 da imponible 1 `X`;
    - PUT parámetros de 11/2026 con base máxima 500.000 → el F.931 sigue dando `X`.
  - `it('segundo convenio')` (Review Focus 3):
    - convenio nuevo `Otro` con categoría y escala, y un empleado en él;
    - mensual → su recibo sin 120, 530 ni 540; el de Comercio, con los tres.
  - `it('asiento del pago de una final')`: pago de una final → descripción `Pago de sueldos N° 1 - Final 11/2026 - Pérez, Juan 1`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Migrate diff (sin borrar el índice parcial), deploy y generate. Verificar la migración sobre la demo.
- [ ] **Step 4:** PASS. Correr la suite API completa (dos mitades con `--shard`, sin otras pruebas en paralelo).
- [ ] **Step 5:** Commit `fix(sueldos): copias al cerrar, conceptos por convenio y textos`.

### Task 5: Web y documentación (arreglos 17, 18, 19, 21 y 23)

**Files:**
- Modify `apps/web/src/sueldos/{LiquidacionPage.tsx,PanelPagos.tsx,VacacionesPage.tsx,EmpleadosPage.tsx,ConceptosPage.tsx,comun.ts}` y `README.md`.
- Test `apps/web/src/sueldos/pulido22.test.tsx`.

**Interfaces:**
- `PanelNovedades` recibe `conceptosFijos?: { id; codigo; nombre }[]` y emite novedades `{ tipo: 'IMPORTE', conceptoId, importe }`.
- `PanelPagos` limpia la selección solo con `onPagado()`, que llama la página al confirmar.

- [ ] **Step 1: Tests que fallan:**
  - `PanelNovedades` con un concepto fijo `200 Premio`: cargar 50000 → `onCambiar` con `[{ tipo: 'IMPORTE', conceptoId: 'c200', importe: 50000 }]`.
  - `PanelPagos`: tildar y "Pagar seleccionados" → `onPagar(['r2'])`, y el checkbox sigue tildado hasta que se llama `onPagado`.
  - `DialogoPeriodo` con observaciones → `onGuardar` las incluye.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar:
  - confirmación al eliminar un período;
  - invalidar `/sueldos/cargas-sociales` después de un pago;
  - avisos de conceptos en la pantalla de conceptos;
  - en el README, la nota del índice parcial y de las migraciones de datos (verificar la cuenta padre).
- [ ] **Step 4:** PASS; suite web y build en verde; e2e completas con base nueva (19/19).
- [ ] **Step 5:** Commit `fix(web): novedades de importe, pagos, vacaciones y avisos; docs`.
