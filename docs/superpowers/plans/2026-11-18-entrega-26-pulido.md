# Entrega 26: Pulido de tarjetas, comisiones y cobranzas. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** corregir los pendientes menores de las Entregas 23 a 25 que nota el usuario.

**Architecture:** son arreglos puntuales sobre `apps/api/src/{tesoreria/operaciones,ventas/comisiones,ventas/cobranzas,sueldos}` y `apps/web/src/{tesoreria,ventas,compras/formato.ts}`, más una migración con un índice y permisos.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-entrega-26-pulido-design.md` (los números de arreglo son los del spec).

## Global Constraints

- **Mensajes:** los exactos del spec.
- **Pruebas:** cada arreglo con una prueba que falla antes; reloj de pruebas de la API 2026-11-06.
- **Migración:** `20261125090000_pulido_26`. No debe borrar `Liquidacion_mensual_sac_unica` ni los índices parciales de comisiones.

## Review Focus

1. **Promesa del mismo día seguida de una de fecha posterior.** La ventana de la primera termina en la de fecha posterior. Prueba en Task 2.
2. **Concepto de comisiones desactivado desde la pantalla de conceptos (PUT con `activo: false`).** Responde 400 con el mensaje del spec; si es otro concepto, 200. Prueba en Task 1.
3. **Liquidación de tarjeta con cupones de distintas fechas.** Se compara contra el más nuevo. Prueba en Task 1.
4. **`hoy()` de la web a las 23:30 de Argentina con el navegador en UTC.** Devuelve la fecha argentina. Prueba en Task 3.
5. **Historial de liquidaciones de comisiones con una liquidación anulada.** `externos` sigue listando a los que tenían renglones. Prueba en Task 1.

---

### Task 1: Tarjetas y comisiones en la API (arreglos 3, 4, 5, 6, 7, 8 y 9)

**Files:**
- Modify:
  - `apps/api/src/tesoreria/operaciones/tarjetas.service.ts`;
  - `apps/api/src/sueldos/maestros.service.ts` (modificar concepto);
  - `apps/api/src/ventas/pedidos/pedidos.service.ts`;
  - `apps/api/src/ventas/comisiones/liquidaciones.service.ts` (`listar`);
  - `apps/api/prisma/schema.prisma` y la migración.
- Test: `apps/api/test/pulido26-tarjetas-comisiones.e2e-spec.ts`.

**Interfaces:**
- **Produces:** `GET /api/ventas/comisiones/liquidaciones` agrega a cada liquidación `externos: { vendedorId: string; nombre: string }[]`: los vendedores externos con renglones en esa liquidación, anulados incluidos, ordenados por nombre.

- [ ] **Step 1: Tests que fallan:**
  - `it('fecha de la liquidación de tarjeta')`:
    - cupones del 2026-11-03 y del 2026-11-05 (número 1002);
    - liquidar con fecha 2026-11-04 → 400 `La liquidación no puede ser anterior al cupón 1002 (05/11/2026)`.
  - `it('tarjetas simultáneas')`: `Promise.all` de dos POST con el mismo nombre → `[201, 400]`, y el 400 dice `Ya existe la tarjeta Visa`.
  - `it('concepto de comisiones activo')`:
    - PUT del 210 con `activo: false` → 400 con el mensaje del spec;
    - el mismo PUT sobre el 130 → 200.
  - `it('pedido con vendedor inactivo del cliente')`: el cliente tiene un vendedor que se desactiva después; un pedido sin `vendedorId` queda con `vendedorId: null`.
  - `it('externos del historial')`:
    - liquidación con Ruiz (externo) y Pérez (empleado) → `externos` = `[{ nombre: 'Ruiz' }]`;
    - al anularla, sigue igual.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - **Tarjetas:** mapear P2002 al alta y a la modificación.
  - **Migración:**
    - índice `Novedad(liquidacionComisionesId)` (`@@index` en el esquema);
    - `UPDATE "Rol"` para `venta.maestros` y `comisiones.liquidar` en los Administrador, igual que en la Entrega 25;
    - verificarla sobre la demo previa (`gestion_mig`).
- [ ] **Step 4:** PASS. `test/tarjetas*`, `test/comisiones*` y `test/sueldos-maestros*` en verde.
- [ ] **Step 5:** Commit `fix(pulido): tarjetas y comisiones`.

### Task 2: Cobranzas en la API (arreglos 10, 11, 12 en la API y 14)

**Files:**
- Modify:
  - `apps/api/src/ventas/cobranzas/{dto.ts,agenda.service.ts}`;
  - `apps/api/src/ventas/cobranzas/promesas.ts`, si hace falta.
- Test:
  - `apps/api/test/cobranzas-agenda.e2e-spec.ts` y `cobranzas-gestiones.e2e-spec.ts` (casos nuevos);
  - `promesas.spec.ts`.

**Interfaces:**
- **Produces:** cada gestión de la ficha agrega `usuario: string`, el nombre del usuario que la creó (`Usuario.nombre`).
- **Ventana de la promesa (arreglo 11):** `hasta` es la fecha de la siguiente gestión con promesa **de fecha posterior**. Las del mismo día no cierran la ventana.

- [ ] **Step 1: Tests que fallan:**
  - `it('fechas y importes inválidos')`, en gestiones:
    - `fecha: '2026-02-30'` → 400 `Fecha inválida`;
    - `promesaImporte: 1000.555` → 400 `Importe inválido`;
    - `promesaImporte: 1e15` → 400 `Importe inválido`.
  - `it('dos promesas el mismo día')` (Review Focus 1), en la agenda:
    - gestión A (promesa de 500) y gestión B (promesa de 700), las dos del 2026-11-04;
    - recibo de 500 el 2026-11-04;
    - en la ficha, A está `CUMPLIDA`.
    - Después, una gestión C del 2026-11-05 con promesa de 100 y un recibo de 100 el 2026-11-05: B no cuenta ese recibo, porque su ventana termina el 2026-11-05.
  - `it('cobro anulado no cumple')` (arreglo 14):
    - promesa de 1.210;
    - un cobro de Tesorería de 1.210, que después se anula;
    - la promesa queda `PENDIENTE`.
  - `it('usuario de la gestión')`: la ficha trae `usuario` con el nombre del admin de la sesión de prueba.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. `zFecha` valida que la fecha exista: tiene que coincidir al volver a formatearla.
- [ ] **Step 4:** PASS. `test/cobranzas*` y la unitaria en verde. Suite API completa en dos mitades.
- [ ] **Step 5:** Commit `fix(pulido): cobranzas`.

### Task 3: Web (arreglos 1, 2, 9, 12, 13 y 15)

**Files:**
- Modify:
  - `apps/web/src/compras/formato.ts`;
  - `apps/web/src/tesoreria/{IngresoValoresPage.tsx,TarjetasPages.tsx}`;
  - `apps/web/src/ventas/{ComisionesPages.tsx,CobranzasPages.tsx}`.
- Test: `apps/web/src/pulido26.test.tsx`.

**Interfaces:**
- **Produces:**
  - `hoy()` devuelve `hoyEn(ZONA_ARGENTINA)` de `@gestion/shared`;
  - `TablaComisiones` muestra la columna `%`;
  - `TablaAgenda` muestra la columna `Por vencer`.

- [ ] **Step 1: Tests que fallan:**
  - `hoy()` con `vi.setSystemTime(new Date('2026-11-18T02:30:00Z'))` (23:30 en Argentina) → `'2026-11-17'` (Review Focus 4).
  - `FormLiquidacion`:
    - con los cupones c1 y c2, tildar ambos;
    - volver a renderizar solo con c1;
    - completar los importes y confirmar;
    - → `onConfirmar` con `cuponIds: ['c1']`.
  - `TablaComisiones`:
    - un vendedor con detalle de porcentaje 3 → muestra `3,00`;
    - con porcentajes 3 y 5 → `varios`.
  - `TablaAgenda`: muestra la columna `Por vencer` con `$ 1.210,00`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - Cupones vaciados al cambiar a una caja no ARS (arreglo 1).
  - El PDF ofrece solo `externos` de la liquidación (arreglo 9).
  - Usuario en el historial (arreglo 12).
  - Aviso en la ficha con el error de la consulta (arreglo 13).
- [ ] **Step 4:** PASS. Suite web y build en verde.
- [ ] **Step 5:** Commit `fix(web): pulido de tarjetas, comisiones y cobranzas`.

### Task 4: Suites y README

- [ ] **Step 1:** Recrear `gestion_e2e` y correr `pnpm e2e -- --trace off` → 22/22.
- [ ] **Step 2:** README, una línea en "Notas para migraciones": la Entrega 26 agrega permisos a los Administrador existentes.
- [ ] **Step 3:** Commit `docs: README entrega 26`.
