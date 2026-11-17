# Entrega 24: Vendedores y comisiones. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** liquidar mensualmente las comisiones de los vendedores sobre lo cobrado. La de los empleados se carga en su recibo de sueldo; la de los externos sale en un PDF.

**Architecture:**
- **Módulo nuevo:** `apps/api/src/ventas/comisiones/`, con el maestro de vendedores, el cálculo y la liquidación.
- **Cálculo:** se hace al liquidar, leyendo `AplicacionCobro`. No toca recibos ni aplicaciones.
- **Factura:** copia el vendedor y el porcentaje al emitir.
- **Sueldos:** recibe una novedad `IMPORTE` marcada con `liquidacionComisionesId`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-entrega-24-comisiones-design.md`. Las decisiones del §10 son vinculantes y reemplazan lo que digan otras secciones.

## Global Constraints

- **Mensajes:** los exactos del spec. Los no fijados quedan a criterio del builder, en el mismo estilo.
- **Importes:**
  - en pesos, redondeados al centavo con `Prisma.Decimal` y `ROUND_HALF_UP`;
  - `neto = cobradoPesos × (netoGravado + noGravado + exento) / total`;
  - `comision = neto × pct / 100`.
- **Multiempresa:** los modelos nuevos van en `MODELOS_DE_EMPRESA`. Los `SELECT … FOR UPDATE` crudos se acotan por `empresaId` y se ordenan por id.
- **Migraciones:**
  - `20261123090000_comisiones` para el esquema y `20261123090001_comisiones_datos` para el concepto 210 y la configuración;
  - los índices únicos parciales se escriben a mano en el SQL;
  - `migrate diff` no debe borrar `Liquidacion_mensual_sac_unica` ni los índices parciales nuevos;
  - se despliega en `gestion` y `gestion_test`, y la migración de datos se verifica sobre la demo.
- **Pruebas:**
  - reloj 2026-11-06;
  - suite API en dos mitades con `--shard`, sin otras pruebas de API en paralelo;
  - e2e con base nueva.
- **Commits:** sin identificadores de modelo y con las líneas de atribución de la sesión.

## Review Focus

1. **Factura en dólares cobrada en pesos.** La comisión usa `importePesosDebito` de la aplicación, no el importe en dólares. Prueba en Task 3.
2. **Factura con percepciones u otros tributos.** El neto excluye IVA y tributos, y la proporción usa el `total` del comprobante. Prueba en Task 3.
3. **Recibo anulado antes de liquidar.** Su aplicación queda anulada: no comisiona ni genera ajuste. Prueba en Task 3.
4. **Dos confirmaciones simultáneas del mismo mes.** Una da 201 y la otra 400, con una sola novedad en sueldos. Prueba en Task 4.
5. **Guardar novedades manuales del empleado después de confirmar.** La novedad de comisiones sigue y el recibo suma las dos. Prueba en Task 4.

---

### Task 1: Esquema, maestro de vendedores y configuración

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma` y las dos migraciones;
  - `apps/api/src/prisma/modelos-empresa.ts`;
  - `packages/shared/src/permisos.ts`;
  - `apps/api/src/sueldos/modelo.ts` (concepto 210 en la precarga);
  - `apps/api/src/sueldos/contribuciones.service.ts` (configuración);
  - `apps/api/src/seed/demo.ts`;
  - `apps/api/src/ventas/ventas.module.ts`.
- Create: `apps/api/src/ventas/comisiones/{vendedores.service.ts,comisiones.controller.ts,dto.ts}`.
- Test: `apps/api/test/comisiones-maestro.e2e-spec.ts`.

**Interfaces:**
- **Produces, esquema:**
  - enums `TipoVendedor { EMPLEADO EXTERNO }`, `EstadoLiquidacionComisiones { CONFIRMADA ANULADA }` y `TipoRenglonComision { COBRO ANULACION RECHAZO }`;
  - `Vendedor { id, empresaId, nombre, tipo, porcentaje Decimal(5,2), empleadoId?, proveedorId?, activo default true }`, con únicos `(empresaId, nombre)`, `(empresaId, empleadoId)` y `(empresaId, proveedorId)`;
  - `Tercero.vendedorId?`, `PedidoVenta.vendedorId?`, `ComprobanteVenta.vendedorId?` y `ComprobanteVenta.comisionPct Decimal(5,2)?`;
  - `LiquidacionComisiones { id, empresaId, numero, anio, mes, fecha, estado default CONFIRMADA, motivoAnulacion?, creadoPor, creadoEn }`, con único parcial `(empresaId, anio, mes) WHERE estado = 'CONFIRMADA'`;
  - `LiquidacionComisionesRenglon { id, empresaId, liquidacionId (cascade), vendedorId, tipo, aplicacionId, comprobanteId, chequeId?, cobrado, neto, porcentaje, comision, anulado default false }`, con únicos parciales:
    - `(aplicacionId) WHERE tipo='COBRO' AND NOT anulado`;
    - `(aplicacionId) WHERE tipo='ANULACION' AND NOT anulado`;
    - `(chequeId, aplicacionId) WHERE tipo='RECHAZO' AND NOT anulado`;
  - `Novedad.liquidacionComisionesId?` y `ConfiguracionSueldos.conceptoComisionesId?`.
- **Produces, permisos:** `'venta.maestros': 'Editar vendedores'` y `'comisiones.liquidar': 'Liquidar comisiones de vendedores'`.
- **Produces, API:**
  - `GET /api/ventas/vendedores` (`@RequierePermiso()`) → `{ id, nombre, tipo, porcentaje, empleadoId, proveedorId, activo, empleado?: string, proveedor?: string }[]`;
  - `POST /api/ventas/vendedores` y `PUT /api/ventas/vendedores/:id` (`venta.maestros`);
  - `PUT /api/sueldos/configuracion` acepta `conceptoComisionesId`, que debe ser `FIJO`, activo y de clase `REMUNERATIVO` o `NO_REMUNERATIVO`; si no, 400 `Concepto de comisiones inválido: debe ser fijo, activo y no de descuento`;
  - `GET /api/sueldos/configuracion` lo devuelve.

- [ ] **Step 1: Tests que fallan** (`comisiones-maestro.e2e-spec.ts`):
  - `it('alta de vendedores')`:
    - empleado de `prepararSueldos` → `POST {nombre:'Pérez', tipo:'EMPLEADO', porcentaje:3, empleadoId}` → 201;
    - proveedor con `esProveedor` → `{nombre:'Ruiz SRL', tipo:'EXTERNO', porcentaje:5, proveedorId}` → 201;
    - `GET` → dos, con `porcentaje: '3.00'` y `'5.00'`.
  - `it('validaciones')`:
    - EMPLEADO sin `empleadoId` → 400;
    - EXTERNO con un tercero que no es proveedor → 400 `El tercero no es proveedor`;
    - segundo vendedor con el mismo empleado → 400 `El empleado ya es vendedor`;
    - nombre repetido → 400 `Ya existe el vendedor Pérez`;
    - porcentaje 120 → 400.
  - `it('empresa nueva trae el concepto de comisiones configurado')`:
    - sesión nueva → existe el concepto `210` `Comisiones` (`FIJO`, `NO_REMUNERATIVO`);
    - `GET /api/sueldos/configuracion` → `conceptoComisionesId` = su id.
  - `it('concepto de comisiones inválido')`: `PUT configuracion` con el concepto de un descuento → 400 con el mensaje de Interfaces.
  - `it('permisos')`: usuario con `venta.ver` → `GET` 200, `POST` 403.
- [ ] **Step 2:** `npx jest test/comisiones-maestro` → FAIL.
- [ ] **Step 3: Implementar.**
  - Migraciones: `migrate diff`, quitar los DROP indebidos y agregar a mano los índices parciales.
  - La migración de datos crea el 210 y lo configura en las empresas que tienen conceptos de sueldos y no tienen código 210.
  - Precarga y demo:
    - permiso de comisiones al Administrador;
    - vendedor `Pérez` (EMPLEADO, 3 %) sobre el primer empleado de la demo;
    - `Ruiz` (EXTERNO, 5 %) sobre un proveedor demo;
    - Pérez como vendedor habitual de un cliente demo.
  - Recompilar shared. Verificar la migración de datos sobre la demo (`gestion_mig`).
- [ ] **Step 4:** PASS. Actualizar las pruebas viejas que cuentan conceptos o permisos, si fallan.
- [ ] **Step 5:** Commit `feat(comisiones): vendedores, esquema y concepto de comisiones`.

### Task 2: Vendedor en el cliente, el pedido y el comprobante

**Files:**
- Modify:
  - `apps/api/src/terceros/*` (DTO y servicio: `vendedorId`);
  - `apps/api/src/ventas/pedidos/{dto.ts,pedidos.service.ts}`;
  - `apps/api/src/ventas/comprobantes/{dto.ts,comprobantes.service.ts}`;
  - el lugar donde se emite (`apps/api/src/ventas/emision/*`) para copiar el porcentaje.
- Test: `apps/api/test/comisiones-asignacion.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** `Vendedor` (Task 1).
- **Produces:**
  - DTOs de tercero, pedido y comprobante con `vendedorId?: string | null`;
  - el comprobante emitido tiene `vendedorId` y `comisionPct` (string con dos decimales);
  - una NC o ND con comprobante asociado copia los dos datos del asociado e ignora los del pedido.
- **Regla de propuesta en la API:** en el alta del comprobante, si `vendedorId` es `undefined`, se usa el del pedido de origen (vía remito o pedido); si no hay, el del cliente. `null` explícito deja el comprobante sin vendedor.
- **Validación:** vendedor inexistente o inactivo → 400 `Vendedor inválido`. No se valida en NC/ND, que heredan.

- [ ] **Step 1: Tests que fallan:**
  - `it('el cliente propone su vendedor')`: cliente con `vendedorId` de Pérez (3 %) → factura sin `vendedorId` → emitida con Pérez y `comisionPct '3.00'`.
  - `it('el porcentaje se copia al emitir')`: cambiar Pérez a 4 % después de emitir → la factura sigue en `'3.00'`, y una factura nueva queda en `'4.00'`.
  - `it('vendedor explícito o ninguno')`: `vendedorId: ruiz` → Ruiz `'5.00'`; `vendedorId: null` → sin vendedor.
  - `it('desde un pedido')`: pedido con Ruiz para un cliente de Pérez → factura desde ese pedido (helper de pedidos) → Ruiz.
  - `it('la NC hereda')`: NC asociada a la factura de Pérez → `vendedorId` Pérez y `'3.00'`.
  - `it('vendedor inactivo')`: → 400 `Vendedor inválido`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. `test/ventas*`, `test/pedidos*` y `test/comisiones*` en verde.
- [ ] **Step 5:** Commit `feat(comisiones): vendedor en clientes, pedidos y comprobantes`.

### Task 3: Cálculo de comisiones del mes

**Files:**
- Create: `apps/api/src/ventas/comisiones/calculo.service.ts`.
- Modify: `comisiones.controller.ts`.
- Test: `apps/api/test/comisiones-calculo.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** comprobantes con `vendedorId` y `comisionPct` (Task 2), `AplicacionCobro`, `MovimientoCuentaCorriente`, `ChequeTercero` y `Recibo`.
- **Produces:**
  - `ComisionesCalculoService.pendientes(tx, anio: number, mes: number): Promise<RenglonComision[]>`;
  - `RenglonComision = { vendedorId; tipo: 'COBRO'|'ANULACION'|'RECHAZO'; aplicacionId; comprobanteId; chequeId: string|null; fecha: string; cliente: string; comprobante: string; cobro: string; cobrado: Dec; neto: Dec; porcentaje: Dec; comision: Dec }`. `comision` es negativa en los ajustes;
  - `GET /api/ventas/comisiones?anio&mes` (`venta.ver`) → `{ anio, mes, vendedores: [{ vendedorId, nombre, tipo, renglones: number, neto: string, comision: string, liquidable: boolean, detalle: RenglonComision serializado }] }`. `liquidable = comision > 0`; ordenado por nombre.
- **Reglas (spec §5):**
  - **COBRO:** aplicación no anulada con `fecha ≤ fin de mes`, débito con origen `VENTA` cuyo comprobante tiene vendedor, crédito con origen `RECIBO` o `COBRO`, y sin renglón COBRO no anulado.
  - **ANULACION:** aplicación anulada con un renglón COBRO no anulado en una liquidación confirmada, y sin renglón ANULACION no anulado. Lleva la misma comisión, en negativo.
  - **RECHAZO:** cheque con `fechaRechazo ≤ fin de mes` cuyo ingreso es el del cobro de la aplicación (recibo vía `Recibo.ingresoId`, o el ingreso mismo si el origen es `COBRO`).
    - Importe: −comisión de la aplicación × chequePesos / totalValoresPesos del ingreso (efectivo + cheques + transferencias + cupones, en pesos).
    - Sin renglón RECHAZO no anulado para ese (cheque, aplicación).
    - La aplicación no tiene que estar anulada.

- [ ] **Step 1: Tests que fallan** (factura A de 1.000 + 21 % = 1.210, Pérez 3 %):
  - `it('recibo total')`: recibo de 1.210 aplicado → Pérez `neto '1000.00'`, `comision '30.00'`, un renglón COBRO.
  - `it('recibo parcial')`: 605 → `neto '500.00'`, `comision '15.00'`.
  - `it('una NC no comisiona')`: NC de 605 aplicada y recibo de 605 → `comision '15.00'`.
  - `it('factura en dólares')` (Review Focus 1): factura USD 100 + 21 % con cotización 1.000 y recibo en pesos al tipo del día 1.100 → la comisión usa `importePesosDebito`: `neto '100000.00'`, `comision '3000.00'`.
  - `it('percepciones')` (Review Focus 2): factura con 1.000 + IVA 210 + percepción IIBB 30 (total 1.240), recibo total → `neto '1000.00'`.
  - `it('recibo anulado antes de liquidar')` (Review Focus 3): recibo anulado → sin renglones.
  - `it('cheque rechazado')`:
    - recibo de 1.210 con 610 en efectivo y un cheque de 600 → comisión 30;
    - rechazar el cheque el 2026-11-05 → otro renglón RECHAZO de `'-14.88'` (30 × 600 / 1.210);
    - total `'15.12'`.
  - `it('meses')`: un recibo de octubre sin liquidar aparece en noviembre; un recibo de diciembre no.
  - `it('vendedor con total negativo')`: solo un ajuste → `liquidable: false`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar con consultas Prisma acotadas por empresa. Los valores del ingreso se leen como hoy en `ingresos.service` (`conCupones` para los cupones).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(comisiones): cálculo de comisiones sobre lo cobrado`.

### Task 4: Confirmar, anular, sueldos y PDF

**Files:**
- Create:
  - `apps/api/src/ventas/comisiones/liquidaciones.service.ts`;
  - `apps/api/src/ventas/comisiones/pdf-comisiones.ts`.
- Modify:
  - `comisiones.controller.ts`;
  - `apps/api/src/sueldos/liquidaciones.service.ts` (`guardarNovedades` conserva las de comisiones; el detalle las marca);
  - `apps/api/src/sueldos/calculo.ts` (suma todas las `IMPORTE` del concepto).
- Test: `apps/api/test/comisiones-liquidacion.e2e-spec.ts`; agregar un caso en `apps/api/src/sueldos/calculo.spec.ts`.

**Interfaces:**
- **Consumes:** `ComisionesCalculoService.pendientes` (Task 3) y `ConfiguracionSueldos.conceptoComisionesId` (Task 1).
- **Produces:**
  - `POST /api/ventas/comisiones {anio, mes}` (`comisiones.liquidar`) → `{ id, numero, anio, mes, vendedores: [{ vendedorId, nombre, tipo, comision }] }`;
  - `GET /api/ventas/comisiones/liquidaciones` (`venta.ver`) → `{ id, numero, anio, mes, fecha, estado, total }[]`, de la más nueva a la más vieja;
  - `POST /api/ventas/comisiones/liquidaciones/:id/anular {motivo}` (`comisiones.liquidar`);
  - `GET /api/ventas/comisiones/liquidaciones/:id/pdf?vendedorId` (`venta.ver`) → `application/pdf`;
  - el detalle de una liquidación de sueldos devuelve en cada novedad `liquidacionComisionesId`.
- **Reglas de confirmación:**
  - bloquear la fila de `ConfiguracionSueldos` de la empresa (serializa confirmaciones y anulaciones) y releer;
  - un mes ≤ al de una confirmada → 400 `Ya hay una liquidación de comisiones de un mes posterior` (con el mismo mes, el índice parcial y el chequeo dan 400 `Las comisiones de MM/AAAA ya están liquidadas`);
  - solo entran los vendedores con `liquidable`; si no hay ninguno → 400 `No hay comisiones para liquidar en MM/AAAA`;
  - **empleados:**
    - con una liquidación FINAL de su empleado en el mes en borrador, la novedad va ahí;
    - si esa final está cerrada → 400 con el mensaje de §10;
    - si no hay final, va a la MENSUAL del mes en borrador, o 400 con el mensaje de §6;
    - concepto no configurado → 400 `Configure el concepto de comisiones en sueldos`;
    - la novedad es `{tipo:'IMPORTE', conceptoId, importe, detalle:'Comisiones MM/AAAA', liquidacionComisionesId}`;
  - número con `NumeracionService.siguiente(tx, 'LIQUIDACION_COMISIONES', 0)`.
- **Reglas de anulación:**
  - solo la última confirmada; si no → 400 `Anule primero la liquidación de comisiones de MM/AAAA`;
  - cada liquidación de sueldos donde quedó una novedad tiene que estar en borrador; si no → 400 con el mensaje de §6, o el análogo para la final;
  - borra esas novedades, marca sus renglones `anulado = true` y la liquidación `ANULADA` con su motivo.
- **Sueldos:** `guardarNovedades` borra y recrea solo las novedades sin `liquidacionComisionesId`. El cálculo suma todas las `IMPORTE` del mismo concepto.

- [ ] **Step 1: Tests que fallan:**
  - `it('confirmar carga la novedad')`:
    - mensual de 11/2026 en borrador, recibo con 30 de comisión de Pérez (empleado) y 50 de Ruiz;
    - `POST` → 201;
    - la mensual tiene la novedad de 30.00 en el 210 para el empleado de Pérez, y su recibo (GET de la liquidación) muestra el concepto 210 por 30.00;
    - el `GET` del mes queda sin pendientes.
  - `it('no se liquida dos veces')`: segundo `POST` del mismo mes → 400 `Las comisiones de 11/2026 ya están liquidadas`.
  - `it('confirmaciones simultáneas')` (Review Focus 4): `Promise.all` de dos `POST` → `[201, 400]`, y una sola novedad.
  - `it('novedades manuales después')` (Review Focus 5): `PUT` de novedades del empleado con un importe manual de 100 en el 210 → la novedad de comisiones sigue y el recibo muestra 130.00.
  - `it('mensual cerrada o inexistente')` → 400 con el mensaje de §6.
  - `it('empleado con final en borrador')`: egreso del empleado en 11/2026 con final en borrador → la novedad va a la final.
  - `it('ajuste por anulación en el mes siguiente')`:
    - confirmar octubre con un recibo de octubre (mensual de 10/2026 en borrador);
    - anular el recibo y luego la aplicación;
    - `GET` de noviembre → renglón ANULACION −30 y Pérez `liquidable: false`.
  - `it('orden')`:
    - con noviembre confirmado, confirmar octubre → 400 `Ya hay una liquidación de comisiones de un mes posterior`;
    - anular octubre con noviembre confirmado → 400 `Anule primero la liquidación de comisiones de 11/2026`.
  - `it('anular')`: anular noviembre → la novedad desaparece, los renglones vuelven a estar pendientes y la liquidación queda `ANULADA`. Volver a confirmar → 201.
  - `it('PDF del externo')`: `GET …/pdf?vendedorId=ruiz` → 200 `application/pdf`.
  - `it('permisos')`: usuario con `venta.ver` → `POST` 403, `GET` 200.
  - **Unit** (`calculo.spec.ts`): dos novedades `IMPORTE` del mismo concepto `FIJO` de 30 y 100 → renglón de 130.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. `test/sueldos*`, `test/pulido22*` y `test/comisiones*` en verde. Suite API completa en dos mitades.
- [ ] **Step 5:** Commit `feat(comisiones): liquidación mensual, sueldos y PDF`.

### Task 5: Web

**Files:**
- Create:
  - `apps/web/src/ventas/ComisionesPages.tsx` (`VendedoresPage`, `ComisionesPage`, `SelectorVendedor`);
  - `apps/web/src/ventas/comisiones.test.tsx`.
- Modify:
  - la ficha del cliente (`apps/web/src/maestros/…` donde se edita el tercero);
  - el formulario de pedido y el de comprobante de venta;
  - `apps/web/src/sueldos/LiquidacionPage.tsx`: la novedad de comisiones se muestra en solo lectura y no se envía en el `PUT`;
  - `apps/web/src/sueldos/` (selector del concepto de comisiones donde se edita la configuración de sueldos);
  - `apps/web/src/layout/menu.ts` y `apps/web/src/paginas/rutas.tsx`.

**Interfaces:**
- **Consumes:** endpoints de las Tasks 1, 3 y 4.
- **Produces:**
  - `SelectorVendedor({ vendedores, value, onChange })`: lista solo los activos y permite vacío ("Sin vendedor");
  - `ComisionesPage`: selector de mes, tabla por vendedor con detalle desplegable, *Confirmar liquidación* (con `comisiones.liquidar`), historial con *Anular* y *PDF* para los externos;
  - rutas `/maestros/vendedores` (menú Maestros → *Vendedores*, `venta.maestros`) y `/ventas/comisiones` (menú Ventas → *Comisiones*, `venta.ver`).
- **Formulario de comprobante:** al elegir el cliente se precarga su vendedor, y al agregar desde un pedido, el del pedido. Si el usuario lo cambió a mano, no se pisa.

- [ ] **Step 1: Tests que fallan** (`comisiones.test.tsx`):
  - `SelectorVendedor` con un activo y un inactivo → solo muestra el activo y la opción "Sin vendedor";
  - `ComisionesPage` con la API simulada (dos vendedores) → muestra `Pérez, Juan`, `$ 37.500,00` y el botón `Confirmar liquidación` habilitado;
  - con un único vendedor `liquidable: false` → el botón está deshabilitado y se lee `Sin comisiones para liquidar`;
  - menú: con `venta.ver` aparece `Comisiones`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Actualizar las cuentas de menú en `menu.test.ts` si cambian (Maestros +1).
- [ ] **Step 4:** PASS. Suite web y build en verde.
- [ ] **Step 5:** Commit `feat(web): vendedores y comisiones`.

### Task 6: E2E y README

**Files:**
- Create: `e2e/comisiones.spec.ts`.
- Modify: `e2e/playwright.config.ts` (si hace falta) y `README.md`.

- [ ] **Step 1: Test** `test('comisiones: el administrador cobra una factura de un vendedor empleado, liquida las comisiones y la mensual de sueldos tiene la novedad')`:
  - admin de la demo, cliente demo con Pérez;
  - factura y recibo total;
  - *Ventas → Comisiones* del mes → Pérez con comisión → confirmar;
  - la mensual de sueldos del mes muestra la novedad `Comisiones` del empleado.
  - **Proyecto:** si la mensual del mes se cierra en otras pruebas, va en un proyecto propio después de `general` y antes de `sueldos-final`. Si necesita crear la mensual, la crea.
- [ ] **Step 2:** recrear `gestion_e2e` y correr `pnpm e2e -- --trace off` → 21/21.
- [ ] **Step 3:** README, sección "Vendedores y comisiones (Entrega 24)".
- [ ] **Step 4:** Suites en verde.
- [ ] **Step 5:** Commit `test(e2e): comisiones; docs: README entrega 24`.
