# Entrega 25: Seguimiento de deudores vencidos. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agenda de cobranzas, ficha por cliente y registro de gestiones con promesas de pago cuyo estado se calcula solo.

**Architecture:**
- **Módulo nuevo:** `apps/api/src/ventas/cobranzas/`.
- **Qué se graba:** solo las gestiones (`GestionCobranza`).
- **Qué se calcula en cada consulta:** la deuda, desde `MovimientoCuentaCorriente`, y el estado de las promesas, desde los cobros y los cheques rechazados.
- **Web:** dos pantallas nuevas en `apps/web/src/ventas/`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-entrega-25-cobranzas-design.md`. Las decisiones del §10 son vinculantes.

## Global Constraints

- **Orígenes de cliente:** `ORIGENES_CLIENTE` de `src/compras/comun.ts` (`VENTA`, `RECIBO`, `COBRO`, `CHEQUE_RECHAZADO_CLIENTE`). Solo movimientos no anulados.
- **Montos:** en pesos (`saldoPesos`, `importePesos`), como strings con dos decimales.
- **Hoy:** reloj de pruebas 2026-11-06 (`hoy()` de `tesoreria-comun`).
- **Mensajes nuevos:**
  - `Indique una nota`;
  - `La próxima acción no puede ser anterior a la gestión`;
  - `La promesa necesita fecha e importe mayor a cero`;
  - `La fecha de la promesa no puede ser anterior a la gestión`;
  - `La fecha de la gestión no puede ser futura`;
  - `Solo se eliminan gestiones del día`;
  - `El tercero no es cliente`.
- **Migraciones:**
  - `20261124090000_cobranzas`;
  - no debe borrar `Liquidacion_mensual_sac_unica` ni los índices parciales de comisiones;
  - agrega `cobranzas.gestionar` a los roles `Administrador` que no lo tengan.
- **Pruebas:** la suite API en dos mitades con `--shard` y las e2e con base nueva.

## Review Focus

1. **Cliente con NC parcial aplicada.** El vencido usa el saldo que queda de la factura, no su total. Prueba en Task 2.
2. **Cliente solo con saldo a favor, o con todo por vencer.** No aparece en la agenda. Prueba en Task 2.
3. **Cobro con cheque rechazado después.** La promesa vuelve a incumplida o pendiente. Prueba en Task 2.
4. **Promesa reemplazada por otra.** La vieja muestra su estado con los cobros hasta la gestión nueva, y la agenda usa la nueva. Prueba en Task 2.
5. **Factura en dólares.** Suma al vencido en pesos. Prueba en Task 2.

---

### Task 1: Gestiones (modelo, permiso y API)

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma` y la migración;
  - `apps/api/src/prisma/modelos-empresa.ts`;
  - `packages/shared/src/permisos.ts`;
  - `apps/api/src/seed/demo.ts` (permiso al Tesorero);
  - `apps/api/src/ventas/ventas.module.ts`.
- Create: `apps/api/src/ventas/cobranzas/{gestiones.service.ts,cobranzas.controller.ts,dto.ts}`.
- Test: `apps/api/test/cobranzas-gestiones.e2e-spec.ts`.

**Interfaces:**
- **Produces, esquema:**
  - enum `MedioGestion { LLAMADO MAIL WHATSAPP VISITA OTRO }`;
  - `GestionCobranza { id, empresaId, terceroId, fecha Date, medio, nota, proximaAccion Date?, promesaFecha Date?, promesaImporte Decimal(18,2)?, creadoPor, creadoEn }`, con `@@index([empresaId, terceroId, fecha])`.
- **Produces, permiso:** `'cobranzas.gestionar': 'Registrar gestiones de cobranza'`.
- **Produces, API:**
  - `POST /api/ventas/cobranzas/:terceroId/gestiones` (`cobranzas.gestionar`) con body `{ fecha?, medio, nota, proximaAccion?, promesaFecha?, promesaImporte? }`. Responde 201 con la gestión: fechas `AAAA-MM-DD` e importe como string.
  - `DELETE /api/ventas/cobranzas/gestiones/:id` (`cobranzas.gestionar`) → 200 `{ ok: true }`.
  - `GestionesService.deCliente(tx, terceroId)`: las gestiones del cliente, de la más nueva a la más vieja (por `fecha` y después `creadoEn`).

- [ ] **Step 1: Tests que fallan:**
  - `it('registrar gestión')`:
    - factura de `prepararVentas`;
    - `POST` con `{ medio: 'LLAMADO', nota: 'Dice que paga el viernes', proximaAccion: '2026-11-10', promesaFecha: '2026-11-13', promesaImporte: 1000 }` → 201, con `fecha: '2026-11-06'` y `promesaImporte: '1000.00'`.
  - `it('validaciones')`, todos 400 con su mensaje:
    - nota vacía → `Indique una nota`;
    - próxima acción anterior a la gestión;
    - promesa con fecha y sin importe;
    - promesa anterior a la gestión;
    - fecha futura;
    - tercero que solo es proveedor → `El tercero no es cliente`.
  - `it('eliminar solo el mismo día')`:
    - la gestión de hoy → 200;
    - una creada por prisma con `creadoEn` de ayer → 400 `Solo se eliminan gestiones del día`.
  - `it('permisos')`: un usuario con `venta.ver` → `POST` 403; con `cobranzas.gestionar` → 201.
  - `it('el Administrador de una empresa existente recibe el permiso')`: se verifica la migración sobre la demo, no en la suite. Ver Step 3.
- [ ] **Step 2:** `npx jest test/cobranzas-gestiones` → FAIL.
- [ ] **Step 3: Implementar.**
  - Migrate diff, sin borrar los índices parciales existentes.
  - La migración incluye: `UPDATE "Rol" SET permisos = array_append(permisos, 'cobranzas.gestionar') WHERE nombre = 'Administrador' AND NOT ('cobranzas.gestionar' = ANY(permisos))`.
  - Desplegar en `gestion` y `gestion_test`, y verificar sobre `gestion_mig` (demo previa).
  - Recompilar shared.
- [ ] **Step 4:** PASS. Actualizar las pruebas viejas que cuentan permisos, si fallan.
- [ ] **Step 5:** Commit `feat(cobranzas): gestiones de cobranza`.

### Task 2: Agenda, ficha y promesas

**Files:**
- Create:
  - `apps/api/src/ventas/cobranzas/promesas.ts` (función pura);
  - `apps/api/src/ventas/cobranzas/agenda.service.ts`.
- Modify: `cobranzas.controller.ts`.
- Test:
  - `apps/api/src/ventas/cobranzas/promesas.spec.ts`;
  - `apps/api/test/cobranzas-agenda.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** `GestionesService.deCliente` (Task 1).
- **Produces:**
  - `estadoPromesa(p: { fecha: Date; importe: Dec; desde: Date; hasta: Date | null }, movimientos: { origenTipo: string; fecha: Date; importePesos: Dec }[], hoy: Date): 'CUMPLIDA' | 'INCUMPLIDA' | 'PENDIENTE'`.
    - **Lo cobrado** es la suma de `−importePesos` de los movimientos `RECIBO` y `COBRO` con `desde ≤ fecha` y, si hay `hasta`, `fecha < hasta`, **menos** la suma de `importePesos` de los `CHEQUE_RECHAZADO_CLIENTE` en ese mismo rango.
    - Si lo cobrado alcanza `importe` → `CUMPLIDA`; si no, y `fecha < hoy` → `INCUMPLIDA`; si no → `PENDIENTE`.
  - `GET /api/ventas/cobranzas?soloHoy&incumplidas&minDias&q`, con `@RequiereAlguno('venta.ver', 'cobranzas.gestionar')` → `{ hoy, clientes: FilaAgenda[] }`.
    - `FilaAgenda = { terceroId, cliente, vencido, porVencer, aFavor, dias, ultimaGestion: { fecha, medio, nota } | null, proximaAccion: string | null, accionAtrasada: boolean, promesa: { fecha, importe, estado } | null }`.
    - Orden del spec §7. `accionAtrasada = proximaAccion ≤ hoy`.
  - `GET /api/ventas/cobranzas/:terceroId` (mismo guard) → `{ cliente: { id, razonSocial, cuit, telefono, email }, vencido, porVencer, aFavor, dias, comprobantes: { movimientoId, origenTipo, descripcion, fecha, fechaVencimiento, dias, importe, saldo, vencido: boolean }[], gestiones: (gestión + promesaEstado | null)[] }`.
    - Los comprobantes son los movimientos con saldo positivo, primero los vencidos y por vencimiento.
    - `descripcion` usa el mismo formato que la cuenta corriente de clientes.
- **Promesa de cada gestión:** `desde` = la fecha de la gestión; `hasta` = la fecha de la siguiente gestión con promesa (null si es la vigente).

- [ ] **Step 1: Tests que fallan.**
  - **Unit** (`promesas.spec.ts`), con promesa de 1000 el 2026-11-10, desde el 2026-11-01 y hoy 2026-11-06:
    - sin cobros → `PENDIENTE`;
    - con hoy 2026-11-11 → `INCUMPLIDA`;
    - un RECIBO de −1000 el 2026-11-03 → `CUMPLIDA`;
    - RECIBO de −1000 y CHEQUE_RECHAZADO de +600 → `PENDIENTE`;
    - un RECIBO del 2026-10-30, anterior a `desde`, no cuenta;
    - con `hasta` 2026-11-03, un RECIBO del 2026-11-04 no cuenta.
  - **E2E** (`cobranzas-agenda.e2e-spec.ts`; factura de 1.210 con `fecha: '2026-10-01'` y `fechaVencimiento: '2026-10-31'`):
    - `it('agenda: vencido, por vencer y días')`: más otra factura que vence el 2026-12-01 → el cliente aparece con `vencido '1210.00'`, `porVencer '1210.00'` y `dias 6`.
    - `it('NC parcial')` (Review Focus 1): una NC de 605 aplicada a la vencida → `vencido '605.00'`.
    - `it('a favor o por vencer no aparece')` (Review Focus 2): un cliente con solo un cobro sin aplicar y otro con una factura por vencer → no están en `clientes`. Y otro cliente vencido con un cobro sin aplicar de 100 → `aFavor '-100.00'`.
    - `it('factura en dólares')` (Review Focus 5): factura USD 100 exenta a cotización 1.000, vencida → `vencido '100000.00'`.
    - `it('orden y filtros')`: tres clientes vencidos.
      - A: gestión con próxima acción el 2026-11-05.
      - B: promesa incumplida (promesa el 2026-11-05 sin cobro).
      - C: sin gestión y más días de atraso.
      - El orden es `[A, B, C]`.
      - `soloHoy=true` → `[A]`; `incumplidas=true` → `[B]`; `minDias=30` → solo los de 30 días o más; `q` filtra por nombre.
    - `it('promesa cumplida con un recibo')`: promesa de 1.210 el 2026-11-10 y recibo de 1.210 el 2026-11-06 → `CUMPLIDA`.
    - `it('cheque rechazado')` (Review Focus 3):
      - promesa de 1.210; recibo con un cheque de 1.210 → `CUMPLIDA`;
      - depositar y rechazar el cheque el 2026-11-06 → `PENDIENTE`.
    - `it('promesa reemplazada')` (Review Focus 4):
      - gestión 1 con promesa de 500 (el 2026-11-04); recibo de 500 el 2026-11-05; gestión 2 con promesa de 700;
      - en la ficha, la gestión 1 está `CUMPLIDA` y la 2 `PENDIENTE`;
      - en la agenda, la promesa tiene importe `'700.00'`.
      - Las fechas de las gestiones van por body.
    - `it('ficha')`: los comprobantes están ordenados con la vencida primero, con `vencido: true`; las gestiones van de la más nueva a la más vieja; la ficha trae el teléfono.
    - `it('permisos de consulta')`: un usuario solo con `cobranzas.gestionar` → GET 200; uno sin ninguno de los dos → 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Una consulta de movimientos por empresa y otra de gestiones; se agrupa en memoria por cliente.
- [ ] **Step 4:** PASS. Suite API completa en dos mitades.
- [ ] **Step 5:** Commit `feat(cobranzas): agenda, ficha y promesas de pago`.

### Task 3: Web

**Files:**
- Create:
  - `apps/web/src/ventas/CobranzasPages.tsx` (`AgendaCobranzasPage`, `FichaCobranzaPage`, `TablaAgenda`, `FormGestion`);
  - `apps/web/src/ventas/cobranzas.test.tsx`.
- Modify:
  - `apps/web/src/layout/menu.ts`: un nodo puede tener `permisoAlguno?: Permiso[]` y `filtrarMenu` lo respeta;
  - `apps/web/src/paginas/rutas.tsx`;
  - `apps/web/src/layout/menu.test.ts`.

**Interfaces:**
- **Consumes:** los endpoints de las Tasks 1 y 2.
- **Produces:**
  - `TablaAgenda({ clientes, onElegir })`;
  - `FormGestion({ onGuardar, enviando })`, que emite `{ medio, fecha, nota, proximaAccion: string | null, promesaFecha: string | null, promesaImporte: number | null }`;
  - rutas `/ventas/cobranzas` y `/ventas/cobranzas/:terceroId`;
  - menú *Ventas → Cobranzas*, con `permisoAlguno: ['venta.ver', 'cobranzas.gestionar']`, en el bloque de operaciones de Ventas.

- [ ] **Step 1: Tests que fallan** (`cobranzas.test.tsx`):
  - `TablaAgenda` con una fila con `accionAtrasada` y una promesa `INCUMPLIDA` → muestra `$ 302.500,00`, el texto `Incumplida` y el de la acción con la marca `Atrasada`. Al hacer clic en la fila se llama `onElegir('t1')`.
  - `FormGestion`:
    - con nota "Llamé" y promesa 1000 el 2026-11-13 → `onGuardar` con `promesaImporte: 1000`;
    - sin nota, el botón `Registrar gestión` está deshabilitado;
    - con fecha de promesa y sin importe, también.
  - Menú: con solo `cobranzas.gestionar` aparece `Cobranzas`; con solo `venta.ver`, también.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
  - **Agenda:** filtros con chips (`Acciones para hoy`, `Promesas incumplidas`), mínimo de días y búsqueda.
  - **Ficha:** encabezado con los saldos, tabla de comprobantes, historial con `Eliminar` solo para las del día (con `cobranzas.gestionar`) y el formulario, solo con `cobranzas.gestionar`.
- [ ] **Step 4:** PASS. Suite web y build en verde.
- [ ] **Step 5:** Commit `feat(web): agenda y ficha de cobranzas`.

### Task 4: E2E y README

**Files:**
- Create: `e2e/cobranzas.spec.ts`.
- Modify: `README.md` y, si hace falta, `e2e/playwright.config.ts`.

- [ ] **Step 1: Test** `test('cobranzas: el tesorero ve la agenda, registra un llamado con promesa y la agenda la muestra pendiente')`:
  - **Datos:** el admin emite una factura a *María Gómez* con vencimiento de ayer. El e2e corre con el reloj real.
  - **Tesorero:** `tesorero@demo.com` con su contraseña de la demo. Entra a *Ventas → Cobranzas*, ve a María Gómez, abre la ficha y registra un llamado con promesa para mañana. En la agenda, la promesa figura `Pendiente`.
  - Si la factura con vencimiento pasado no se puede cargar desde la web, se usa una con vencimiento hoy y se verifica en la ficha (ledger).
- [ ] **Step 2:** recrear `gestion_e2e` y correr `pnpm e2e -- --trace off` → 22/22.
- [ ] **Step 3:** README, sección "Seguimiento de deudores (Entrega 25)".
- [ ] **Step 4:** Suites en verde.
- [ ] **Step 5:** Commit `test(e2e): cobranzas; docs: README entrega 25`.
