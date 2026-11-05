# Entrega 4A: Tesorería operativa. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la tesorería operativa:
- sucursales con usuarios propios;
- recepción de valores (efectivo, cheques de terceros, transferencias);
- cartera con historial, traslados entre cajas, depósitos y acreditaciones;
- rechazos y devoluciones de cheques, y endoso en órdenes de pago;
- débito de cheques propios, movimientos bancarios, transferencias internas y movimientos y arqueos de caja;
- consultas y pantallas.

**Architecture:**
- Un módulo Nest `tesoreria/operaciones` con un servicio por documento (ingresos, traslados, depósitos, acreditaciones, rechazos, cheques propios, bancos, cajas) y un servicio de consultas.
- Dos piezas transversales:
  - `AlcanceSucursalService` limita qué cajas puede operar o ver el usuario según `UsuarioEmpresa.sucursalId` (que viaja en el contexto);
  - `CarteraService` es el único que cambia el estado de un cheque de terceros, siempre con un registro en el historial.
- Los saldos se calculan siempre desde `MovimientoTesoreria`, que ya existe.

**Tech Stack:** la de las entregas anteriores; sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-05-entrega-4a-tesoreria-design.md`

## Global Constraints

- Todo modelo nuevo lleva `empresaId` y va en `MODELOS_DE_EMPRESA`. Acceso solo vía `TenantPrisma`.
- Importes `Decimal(18,2)`; aritmética con Decimal; redondeo a 2 decimales con ROUND_HALF_UP; "hoy" con `hoyEn(ZONA_ARGENTINA)`.
- Auditoría en cada escritura; mensajes en castellano; validación zod (400 `{ message, campos }`).
- **Alcance por sucursal:** un usuario con `sucursalId` que pide un recurso de otra sucursal recibe **404**.
- **Orden global de bloqueo:** OP → tercero → movimientos de cuenta corriente → chequeras → cajas → cheques de terceros. Siempre ordenado por id, con el helper `bloquear` (se le agregan las tablas `Caja` y `ChequeTercero`).
- **Talonarios:**
  - `ING-<codigo sucursal>`, `TRA`, `DEP`, `MBA` (movimiento bancario), `TIN` (transferencia interna), `MCA` (movimiento de caja) y `ARQ`;
  - todos con punto de venta 0.
- **Permisos nuevos:** `tesoreria.ver`, `tesoreria.operar`, `tesoreria.aceptar`, `tesoreria.anular`. Se agregan al rol Administrador de las empresas existentes por migración.
- **Rutas:** `/api/tesoreria/...`.

## Review Focus

1. **Moneda distinta entre valor y destino:** un cheque o efectivo en USD depositado en una cuenta ARS (o enviado a una caja ARS) → 400 "La moneda del valor no coincide con la de la cuenta o caja de destino". Test en Tasks 4 y 5.
2. **Rechazar un cheque que nunca salió de la cartera** (EN_CARTERA o EN_TRANSITO) → 400 "Solo se pueden rechazar cheques depositados, acreditados o endosados". Test en Task 6.
3. **Usuario de sucursal sobre recursos de otra sucursal:** recibir un traslado destinado a otra sucursal o depositar desde una caja ajena → 404. Test en Tasks 1, 4 y 5.
4. **Importes inválidos:** movimiento de caja, gasto bancario o transferencia con importe ≤ 0, o arqueo con contado negativo → 400 con campo. Test en Task 9.
5. **Endoso de un cheque en USD en una OP:** se valúa con la cotización de la OP, y si la OP no tiene cotización (≤ 1) responde 400 con el mensaje de la Entrega 3 ("Para pagar en dólares, indique la cotización del dólar en la orden de pago"). Test en Task 7.

---

## Estructura de archivos

```
apps/api/src/tesoreria/
  sucursales/            sucursales.service.ts, sucursales.controller.ts, alcance.service.ts
  operaciones/
    cartera.service.ts       cambiarEstado + historial
    tesoreria-comun.ts       registrarMovimiento, saldoCaja, cuentaDeCaja/Banco, aPesos
    ingresos.service.ts / .controller.ts
    traslados.service.ts / .controller.ts
    depositos.service.ts / acreditaciones.service.ts / .controller.ts
    rechazos.service.ts
    cheques-propios.service.ts
    bancos.service.ts        movimientos bancarios + transferencias internas
    cajas.service.ts         movimientos de caja + arqueos
    consultas.service.ts / .controller.ts
    dto.ts
  tesoreria-operaciones.module.ts
apps/web/src/tesoreria/   pantallas de registraciones y consultas
```

---

### Task 1: Sucursales, usuarios por sucursal, cuentas y permisos

**Files:**
- Modify: `schema.prisma`:
  - modelo `Sucursal`; `Caja.sucursalId`; `UsuarioEmpresa.sucursalId?`;
  - migración con datos: crea "Casa central" (código `CEN`, `esCentral = true`) por empresa, asigna las cajas existentes, agrega las cuentas 1.1.01.004, 1.1.01.005, 1.1.02.002 y 5.2.04 al plan de cada empresa, crea los conceptos nuevos de `ConfigCuenta` y agrega los permisos nuevos al rol Administrador.
- Modify:
  - `plan-cuentas-modelo.ts` (cuentas nuevas);
  - `compras/config/conceptos.ts` (`VALORES_A_DEPOSITAR: '1.1.01.003'`, `TRANSFERENCIAS_A_ACREDITAR: '1.1.01.004'`, `VALORES_EN_TRANSITO: '1.1.01.005'`, `DEUDORES_POR_VENTAS: '1.1.02.001'`, `CHEQUES_RECHAZADOS: '1.1.02.002'`, `GASTOS_BANCARIOS: '5.2.02'`, `DIFERENCIAS_DE_CAJA: '5.2.04'`);
  - `permisos.ts`, `EmpresasService.crear` (crea la casa central), `contexto.ts` + `jwt.guard.ts` (`ContextoRequest.sucursalId: string | null`);
  - `usuarios` (alta y modificación aceptan `sucursalId?`, validado contra la empresa);
  - `tesoreria/maestros` (las cajas exigen `sucursalId`; por defecto, la central).
- Create: `apps/api/src/tesoreria/sucursales/{sucursales.service.ts,sucursales.controller.ts,alcance.service.ts}`
- Test: `apps/api/test/tesoreria-sucursales.e2e-spec.ts`

**Interfaces:**
- Produces:
  - REST `GET /api/tesoreria/sucursales` (cualquier usuario con empresa) y `POST`/`PATCH /:id` (`tesoreria.maestros.editar`).
    - Código único (409).
    - No se puede desmarcar ni desactivar la única central: 400 "La empresa debe tener una casa central".
  - `AlcanceSucursalService` (en el contexto CLS):
    - `sucursalUsuario(): string | null`;
    - `filtroCajas(): Prisma.CajaWhereInput`: `{}` si es null, o `{ sucursalId }`;
    - `verificarCaja(tx, cajaId): Promise<Caja>`: 404 "Caja no encontrada" si no existe o es de otra sucursal;
    - `cajasVisibles(tx): Promise<string[] | null>`.
  - `bloquear` acepta además `'Caja' | 'ChequeTercero'`.

- [ ] **Step 1: Tests que fallan:**
  - Una empresa nueva tiene una sucursal central `CEN`. Crear la sucursal "ROS" → 201; código repetido → 409.
  - Una caja creada sin `sucursalId` queda en la central; con `sucursalId` de otra empresa → 404.
  - Asignar `sucursalId` a un usuario. Su token trae `GET /api/auth/yo` → `sucursalId` = ROS.
  - **(Review Focus 3)** `AlcanceSucursalService.verificarCaja` con una caja de CEN para un usuario de ROS → 404, probado vía `POST /api/tesoreria/movimientos-caja` en la Task 9; acá se prueba con `GET /api/tesoreria/cajas`, que lista solo las de su sucursal.
  - Desactivar la central → 400.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS y suite en verde.
- [ ] **Step 5: Commit** `feat(api): sucursales, usuarios por sucursal y cuentas de tesorería`

---

### Task 2: Recepción de valores

**Files:**
- Modify: `schema.prisma` (`IngresoValores`, `IngresoValoresEfectivo`, `ChequeTercero`, `MovimientoCheque`, `TransferenciaRecibida` y sus enums), `modelos-empresa.ts`
- Create: `tesoreria/operaciones/{tesoreria-comun.ts,cartera.service.ts,ingresos.service.ts,ingresos.controller.ts,dto.ts}`, `tesoreria-operaciones.module.ts`
- Test: `apps/api/test/tesoreria-ingresos.e2e-spec.ts`; helper `prepararTesoreria(app, prisma)` en `test/helpers-tesoreria.ts`. El helper crea:
  - una empresa con plan y la sucursal ROS;
  - una caja ARS en CEN y otra en ROS, más una caja USD en CEN;
  - una cuenta bancaria ARS y otra USD;
  - un cliente y un proveedor;
  - una cotización USD de 1000;
  - un usuario admin (todas las sucursales) y un usuario de ROS con `tesoreria.ver/operar`.

**Interfaces:**
- Produces:
  - `registrarMovimiento(tx, { fecha, tipo: 'INGRESO' | 'EGRESO', cuentaBancariaId?, cajaId?, monedaCodigo, importe, origenTipo, origenId }): Promise<void>`.
  - `saldoCaja(tx, cajaId): Promise<Dec>`: efectivo, Σ INGRESO − Σ EGRESO no anulados.
  - `aPesos(tx, moneda, importe, fecha): Promise<Dec>`, con la cotización vigente.
  - `CarteraService.cambiarEstado(tx, chequeId: string, nuevo: EstadoCheque, datos: Partial<ChequeTercero>, origen: { tipo: string; id: string }): Promise<ChequeTercero>`:
    - escribe un `MovimientoCheque` con el estado anterior y el nuevo, la caja y la cuenta;
    - lanza 409 "El cheque N ya no está disponible" si el estado actual no está en el conjunto permitido para la transición.
  - Transiciones permitidas:
    - EN_CARTERA → EN_TRANSITO | DEPOSITADO | ENDOSADO | ANULADO;
    - EN_TRANSITO → EN_CARTERA;
    - DEPOSITADO → ACREDITADO | RECHAZADO | EN_CARTERA (anulación de depósito);
    - ACREDITADO → RECHAZADO;
    - ENDOSADO → RECHAZADO | EN_CARTERA (anulación de OP);
    - RECHAZADO → DEVUELTO.
  - `enum EstadoCheque { EN_CARTERA EN_TRANSITO DEPOSITADO ACREDITADO ENDOSADO RECHAZADO DEVUELTO ANULADO }`.
  - REST (`tesoreria.operar`; `GET` con `tesoreria.ver`):
    - `POST /api/tesoreria/ingresos` con body `{ fecha, cajaId, origen, terceroId?, cuentaContableId?, concepto, efectivo?: { importe } , cheques: [{ tipo, banco, numero, libradorNombre, libradorCuit?, fechaEmision, fechaPago, importe }], transferencias: [{ cuentaBancariaId, fecha, referencia?, importe }] }`:
      - la moneda del efectivo y de los cheques es la de la caja; la de las transferencias, la de la cuenta;
      - responde 201 `{ ...ingreso, advertencias: string[] }`;
    - `GET /api/tesoreria/ingresos` y `/:id`;
    - `POST /:id/anular { motivo }` (`tesoreria.anular`).
  - Cuenta corriente del cliente: `MovimientoCuentaCorriente` con `origenTipo 'COBRO'` por moneda, importe negativo.

- [ ] **Step 1: Tests que fallan:**
  - **Ingreso de cliente en ROS** con efectivo 10.000, un cheque de 50.000 (fecha de pago futura) y una transferencia de 20.000:
    - saldo de la caja de ROS = 10.000;
    - el cheque EN_CARTERA en la caja de ROS con un `MovimientoCheque` (null → EN_CARTERA);
    - la transferencia PENDIENTE;
    - un movimiento COBRO del cliente con importe −80.000;
    - el asiento: debe Caja 10.000, Valores a depositar 50.000 y Transferencias a acreditar 20.000; haber Deudores por ventas 80.000.
  - Origen OTRO con una cuenta no imputable → 400; sin valores → 400 "Ingrese al menos un valor".
  - Cheque duplicado (mismo banco, número y CUIT) → 409 "El cheque 123 del banco Galicia ya fue registrado".
  - Cheque con fecha de pago hace 40 días → 201 con `advertencias[0]` "El cheque 123 está vencido para depositar".
  - El usuario de ROS que ingresa en la caja de CEN → 404.
  - Anular el ingreso → contraasiento, cheque ANULADO, saldo de caja de vuelta, movimiento COBRO anulado. Anular con el cheque ya trasladado → 400 "Hay valores de este ingreso que ya se movieron" (se prueba en la Task 4).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS y suite.
- [ ] **Step 5: Commit** `feat(api): recepción de valores`

---

### Task 3: Cartera de cheques e historial

**Files:**
- Create: endpoints en `tesoreria/operaciones/consultas.controller.ts` (parte cartera)
- Test: `apps/api/test/tesoreria-cartera.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `GET /api/tesoreria/cheques?estado&sucursalId&cajaId&desde&hasta&librador&pagina` (`tesoreria.ver`) → `{ items: [{ id, banco, numero, libradorNombre, fechaPago, monedaCodigo, importe, estado, caja: { nombre, sucursal } | null, cuentaBancaria?, terceroOrigen?, terceroDestino? }], total, totales: { importe } }`. Los usuarios de sucursal ven solo los cheques cuya `cajaId` es de su sucursal, o que salieron de ella (`ingreso.sucursalId`).
  - `GET /api/tesoreria/cheques/:id` → cheque + `historial` (MovimientoCheque con caja, cuenta, usuario y fecha, ordenado).
  - Fechas validadas con `fechaQuery`; un estado inválido → 400.

- [ ] **Step 1: Tests que fallan:**
  - Dos ingresos (CEN y ROS): el admin ve 2 cheques, el usuario de ROS ve 1.
  - Filtro por estado y fecha de pago.
  - Detalle con historial de 1 entrada.
  - Cheque de otra empresa → 404; `estado=XX` → 400.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): cartera de cheques de terceros`

---

### Task 4: Traslados de valores

**Files:**
- Modify: `schema.prisma` (`Traslado`, `TrasladoItem`, enums), `modelos-empresa.ts`
- Create: `tesoreria/operaciones/{traslados.service.ts,traslados.controller.ts}`
- Test: `apps/api/test/tesoreria-traslados.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `POST /api/tesoreria/traslados { fecha, cajaOrigenId, cajaDestinoId, cheques: [id], efectivo?: { importe }, observaciones? }` (`tesoreria.operar`):
    - verifica la caja de origen con `AlcanceSucursalService`;
    - la de destino puede ser de cualquier sucursal.
  - `POST /api/tesoreria/traslados/:id/recibir { items: [{ itemId, aceptado: boolean, motivo? }] }` (`tesoreria.aceptar`):
    - el usuario debe poder ver la caja de destino; si no, 404;
    - todos los items deben venir; si un item rechazado no trae motivo, 400.
  - `POST /:id/anular { motivo }` (`tesoreria.anular`, solo ENVIADO, usuario de la caja de origen).
  - `GET /api/tesoreria/traslados?estado&sucursalId` y `/:id`.
  - Bloqueo: cajas de origen y destino (ordenadas) y luego los cheques.

- [ ] **Step 1: Tests que fallan:**
  - **Envío:** ROS envía a CEN un cheque y efectivo de 4.000:
    - cheque EN_TRANSITO;
    - saldo de caja ROS 6.000;
    - asiento debe Valores en tránsito 4.000, haber Caja 4.000.
  - **Recepción total en CEN:** cheque EN_CARTERA en la caja de CEN, saldo de la caja de CEN +4.000, asiento debe Caja, haber Valores en tránsito, estado RECIBIDO.
  - **Recepción parcial** (cheque rechazado con motivo): el cheque vuelve a EN_CARTERA en ROS, estado RECIBIDO_PARCIAL. Item rechazado sin motivo → 400.
  - Efectivo mayor al saldo → 400 "Saldo insuficiente en la caja".
  - **(Review Focus 1)** Traslado desde la caja ARS a la caja USD → 400 con el mensaje de moneda.
  - **(Review Focus 3)** El usuario de ROS que intenta recibir → 403 (no tiene `tesoreria.aceptar`). Un usuario de ROS con `tesoreria.aceptar` que recibe un traslado con destino CEN → 404.
  - Anular un ENVIADO → todo vuelve a ROS. Anular un RECIBIDO → 400.
  - Después del traslado, anular el ingreso original → 400 "Hay valores de este ingreso que ya se movieron".
  - Dos traslados simultáneos del mismo cheque → 201 y 409.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): traslados de valores entre cajas`

---

### Task 5: Depósitos y acreditaciones

**Files:**
- Modify: `schema.prisma` (`Deposito`, `DepositoItem`), `modelos-empresa.ts`
- Create: `tesoreria/operaciones/{depositos.service.ts,acreditaciones.service.ts,depositos.controller.ts}`
- Test: `apps/api/test/tesoreria-depositos.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `POST /api/tesoreria/depositos { fecha, cajaId, cuentaBancariaId, boleta?, cheques: [id], efectivo?: { importe } }` (`tesoreria.operar`).
  - `POST /api/tesoreria/depositos/:id/anular { motivo }` (`tesoreria.anular`).
  - `GET /api/tesoreria/depositos` y `/:id`.
  - `POST /api/tesoreria/acreditaciones { fecha, cheques: [id], transferencias: [id] }` (`tesoreria.aceptar`) → `{ cheques: n, transferencias: n }`.
  - `GET /api/tesoreria/pendientes-acreditar` (`tesoreria.ver`) → `{ cheques: [...DEPOSITADO], transferencias: [...PENDIENTE] }`.

- [ ] **Step 1: Tests que fallan:**
  - **Depósito** desde la caja de CEN de un cheque de 50.000 y efectivo de 3.000 a la cuenta ARS:
    - cheque DEPOSITADO con `fechaDeposito`;
    - movimientos: EGRESO de caja 3.000 e INGRESO de banco 53.000;
    - asiento: debe Banco 53.000; haber Valores a depositar 50.000 y Caja 3.000.
  - **(Review Focus 1)** Un cheque ARS depositado en la cuenta USD → 400 con el mensaje de moneda.
  - **(Review Focus 3)** Un usuario de ROS que deposita desde la caja de CEN → 404.
  - **Acreditar** el cheque y la transferencia:
    - el cheque pasa a ACREDITADO sin asiento;
    - la transferencia pasa a ACREDITADA con INGRESO de banco 20.000 y asiento debe Banco, haber Transferencias a acreditar;
    - acreditar dos veces → 409.
  - **Anular el depósito** antes de acreditar → el cheque vuelve a EN_CARTERA y la caja recupera los 3.000. Después de acreditar → 400 "El depósito tiene cheques acreditados o rechazados".
  - Dos depósitos simultáneos del mismo cheque → 201 y 409.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): depósitos y acreditaciones`

---

### Task 6: Rechazos y devoluciones de cheques

**Files:**
- Create: `tesoreria/operaciones/rechazos.service.ts` + endpoints
- Test: `apps/api/test/tesoreria-rechazos.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `POST /api/tesoreria/cheques/:id/rechazar { fecha, motivo, gastos? }` (`tesoreria.aceptar`).
  - `POST /api/tesoreria/cheques/:id/devolver { fecha, observaciones? }` (`tesoreria.aceptar`, solo RECHAZADO).
  - Cuenta corriente: `MovimientoCuentaCorriente` con `origenTipo 'CHEQUE_RECHAZADO'` (`origenId` = cheque), importe positivo, en la cuenta del cliente de origen. Si el cheque estaba ENDOSADO, también en la del proveedor de destino. Fecha de vencimiento = fecha.

- [ ] **Step 1: Tests que fallan:**
  - **Rechazo de un cheque DEPOSITADO** con gastos de 500:
    - estado RECHAZADO;
    - EGRESO de banco 50.500;
    - asiento: debe Cheques rechazados 50.000 y Gastos bancarios 500; haber Banco 50.500;
    - movimiento del cliente +50.000, con lo que el saldo del cliente queda −80.000 + 50.000 = −30.000.
  - **(Review Focus 2)** Rechazar un cheque EN_CARTERA → 400 con el mensaje exacto.
  - **Rechazo de un ENDOSADO** (se prueba en la Task 7 una vez que existe el endoso): asiento debe Cheques rechazados, haber Proveedores, y el movimiento del proveedor +importe.
  - Devolver un RECHAZADO → DEVUELTO. Devolver un DEPOSITADO → 409.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): rechazo y devolución de cheques de terceros`

---

### Task 7: Endoso de cheques en órdenes de pago

**Files:**
- Modify: `pagos/ordenes/dto.ts` (tipo `CHEQUE_TERCERO`, `chequeId`), `pago.service.ts`, `anulacion.service.ts`, `schema.prisma` (`OrdenPagoMedio.chequeTerceroId?`; enum `TipoMedioPago` + `CHEQUE_TERCERO`), web `MediosPago.tsx` en la Task 11
- Test: `apps/api/test/tesoreria-endoso.e2e-spec.ts`

**Interfaces:**
- Consumes: `CarteraService.cambiarEstado`, `AlcanceSucursalService.verificarCaja`.
- Produces: en `pagar`:
  - un medio `{ tipo: 'CHEQUE_TERCERO', chequeId }` toma importe y moneda del cheque (si el body trae `importe`, se ignora);
  - exige el cheque EN_CARTERA en una caja visible para el usuario;
  - bloquea los cheques después de las cajas y las chequeras;
  - lo pasa a ENDOSADO con `terceroDestinoId` y asiento haber VALORES_A_DEPOSITAR;
  - no genera `MovimientoTesoreria`.
  - Anular la OP pagada lo devuelve a EN_CARTERA en su caja (`MovimientoCheque` ENDOSADO → EN_CARTERA).

- [ ] **Step 1: Tests que fallan:**
  - **OP de 60.500 al proveedor** pagada con un cheque de terceros de 50.000 más una transferencia de 10.500:
    - cheque ENDOSADO con `terceroDestinoId`;
    - asiento: haber Valores a depositar 50.000 y Banco 10.500.
  - **Anular la OP:** el cheque vuelve a EN_CARTERA.
  - Endosar un cheque DEPOSITADO → 409 "El cheque N ya no está disponible".
  - **(Review Focus 5)** Un cheque en USD en una OP sin cotización → 400 con el mensaje de la Entrega 3. Con la OP a cotización 1100, un cheque de USD 10 vale $11.000.
  - **Rechazo de un ENDOSADO:** asiento debe Cheques rechazados, haber Proveedores, y movimientos +importe en la cuenta del proveedor y en la del cliente.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): endoso de cheques de terceros en órdenes de pago`

---

### Task 8: Débito de cheques propios

**Files:**
- Modify: `schema.prisma` (`EstadoChequePropio` + `DEBITADO`; `ChequePropio.fechaDebito?`)
- Create: `tesoreria/operaciones/cheques-propios.service.ts` + endpoints
- Test: `apps/api/test/tesoreria-cheques-propios.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `GET /api/tesoreria/cheques-propios?estado&desde&hasta` (`tesoreria.ver`).
  - `POST /api/tesoreria/cheques-propios/debitar { fecha, cheques: [id] }` (`tesoreria.aceptar`).
  - **Diferido** (su `fechaPago` > `fechaEmision`, o sin `MovimientoTesoreria` de la OP para ese cheque): EGRESO de banco con fecha = `fecha` y asiento debe CHEQUES_DIFERIDOS, haber Banco.
  - **Al día:** solo estado y fecha.
  - Debitar uno ANULADO o ya DEBITADO → 409.

- [ ] **Step 1: Tests que fallan:**
  - Una OP pagada con un e-cheq diferido de 18.343,40 → debitar → EGRESO de banco y el asiento indicado.
  - Un cheque al día → DEBITADO sin movimiento nuevo.
  - Debitar dos veces → 409.
  - Anular la OP después de debitar → 400 "La orden tiene cheques ya debitados". Esta regla nueva se agrega a la anulación de OP.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): débito de cheques propios`

---

### Task 9: Movimientos bancarios, transferencias internas, movimientos de caja y arqueos

**Files:**
- Modify: `schema.prisma` (`MovimientoBancario`, `TransferenciaInterna`, `MovimientoCaja`, `Arqueo`), `modelos-empresa.ts`
- Create: `tesoreria/operaciones/{bancos.service.ts,cajas.service.ts}` + endpoints
- Test: `apps/api/test/tesoreria-bancos-cajas.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `POST /api/tesoreria/movimientos-bancarios { fecha, cuentaBancariaId, tipo: 'GASTO'|'INGRESO', cuentaContableId, concepto, importe > 0 }` (`tesoreria.aceptar`).
  - `POST /api/tesoreria/transferencias-internas { fecha, origen: { cuentaBancariaId? | cajaId? }, destino: { cuentaBancariaId? | cajaId? }, importeOrigen > 0, importeDestino > 0, concepto? }` (`tesoreria.aceptar`):
    - misma moneda: los dos importes deben ser iguales; si no, 400;
    - distinta moneda: pesos de origen y de destino con la cotización del día; la diferencia va a diferencia de cambio.
  - `POST /api/tesoreria/movimientos-caja { fecha, cajaId, tipo, cuentaContableId, concepto, importe > 0 }` (`tesoreria.operar`):
    - un EGRESO mayor al saldo → 400 "Saldo insuficiente en la caja";
    - se bloquea la caja.
  - `POST /api/tesoreria/arqueos { fecha, cajaId, contado >= 0, motivo? }` (`tesoreria.operar`) → `{ saldoSistema, contado, diferencia }`:
    - con diferencia ≠ 0 exige motivo y genera un `MovimientoCaja` y el asiento contra DIFERENCIAS_DE_CAJA (sobrante: debe Caja, haber Diferencias; faltante al revés).
  - Listados `GET` de cada uno (`tesoreria.ver`).

- [ ] **Step 1: Tests que fallan:**
  - Gasto bancario de 1.200 → EGRESO de banco y asiento debe la cuenta elegida, haber Banco.
  - **Transferencia de $1.050.000 de la cuenta ARS a la cuenta USD por USD 1.000** con la cotización del día en 1000:
    - EGRESO ARS 1.050.000 e INGRESO USD 1.000;
    - asiento: debe Banco USD 1.000.000 y Diferencia de cambio negativa 50.000; haber Banco ARS 1.050.000.
  - Misma moneda con importes distintos → 400.
  - Egreso de caja mayor al saldo → 400.
  - **Arqueo con faltante:** sistema 10.000, contado 9.800, motivo "Error de vuelto" → diferencia −200 y asiento debe Diferencias de caja 200, haber Caja 200; saldo de caja 9.800. Faltante sin motivo → 400. Sin diferencia → no hay asiento.
  - **(Review Focus 4)** Importe 0 → 400 con campo `importe`; contado −1 → 400.
  - **(Review Focus 3)** Un usuario de ROS que hace un movimiento en la caja de CEN → 404.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): movimientos bancarios, transferencias internas, movimientos de caja y arqueos`

---

### Task 10: Consultas de tesorería

**Files:**
- Create: `tesoreria/operaciones/consultas.service.ts` (saldos, movimientos, flujo)
- Test: `apps/api/test/tesoreria-consultas.e2e-spec.ts`

**Interfaces:**
- Produces (todas con `tesoreria.ver` y filtradas por sucursal):
  - `GET /api/tesoreria/saldos?fecha` → `{ bancos: [{ id, nombre, monedaCodigo, saldo }], cajas: [{ id, nombre, sucursal, monedaCodigo, efectivo, cheques }] }`. Los usuarios de sucursal no ven bancos (lista vacía).
  - `GET /api/tesoreria/movimientos?cuentaBancariaId|cajaId&desde&hasta` → `{ saldoInicial, movimientos: [{ fecha, tipo, origenTipo, origenId, descripcion, importe, saldo }], saldoFinal }`.
  - `GET /api/tesoreria/flujo?dias=30` → `[{ fecha, ingresos, egresos, saldo }]`, según la spec §8, con el saldo inicial = Σ saldos bancarios.
  - `GET /api/tesoreria/traslados?estado=ENVIADO` cubre los "valores en tránsito" (Task 4).
- [ ] **Step 1: Tests que fallan:**
  - **Saldos** después del circuito ingreso → traslado → depósito → acreditación: banco 73.000 (53.000 del depósito más 20.000 de la transferencia); caja CEN con su efectivo; caja ROS sin cheques. El usuario de ROS no ve bancos.
  - **Movimientos del banco** entre fechas, con saldo inicial y acumulado.
  - **Flujo a 30 días:** incluye un cheque en cartera con fecha de pago en 10 días como ingreso de ese día y un cheque propio diferido como egreso.
  - Fecha inválida → 400.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): consultas de tesorería`

---

### Task 11: Web de tesorería

**Files:**
- Create: `apps/web/src/tesoreria/`:
  - `IngresoValoresPage`, `TrasladoPage`, `RecepcionTrasladosPage`, `DepositoPage`, `AcreditacionesPage`, `RechazoChequesPage`, `DebitoChequesPropiosPage`, `MovimientosBancariosPage`, `TransferenciasInternasPage`, `MovimientosCajaPage`, `ArqueoPage`;
  - consultas: `SaldosPage`, `CarteraPage` (con historial en un modal), `PendientesAcreditarPage`, `ChequesPropiosPage`, `MovimientosCuentaPage`, `FlujoFondosPage`;
  - `SelectorCheques.tsx`.
- Modify:
  - `menu.ts` (Registraciones › Tesorería y Consultas › Tesorería reemplazan los "Próximamente");
  - `rutas.tsx`;
  - `pagos/MediosPago.tsx` (tipo "Cheque de terceros" con `SelectorCheques` de un solo cheque);
  - `paginas/UsuariosPage.tsx` (Select de sucursal; vacío = todas);
  - `paginas/TesoreriaPage.tsx` (pestaña Sucursales; caja con sucursal);
  - `layout/AppLayout.tsx` (muestra la sucursal del usuario);
  - `RolesPage` (grupo tesorería).
- Test: `apps/web/src/tesoreria/SelectorCheques.test.tsx`, `apps/web/src/pagos/MediosPago.test.tsx` (agregar el caso de cheque de terceros)

**Interfaces:**
- Produces:
  - `<SelectorCheques cheques seleccion onChange multiple? />`: tabla con checkbox (o radio si no es múltiple), con total seleccionado formateado.
  - En `MediosPago`, con el tipo `CHEQUE_TERCERO` el importe es de solo lectura y se toma del cheque.
- [ ] **Step 1: Tests que fallan:**
  - `SelectorCheques`: con dos cheques de 50.000 y 30.000, al seleccionar ambos muestra "Total seleccionado: $ 80.000,00".
  - `MediosPago`: un medio `CHEQUE_TERCERO` con `chequeId` de un cheque de 50.000 cuenta $ 50.000 como cubierto.
- [ ] **Step 2–4:** PASS; `build` sin errores; el test de rutas del menú en verde.
- [ ] **Step 5: Commit** `feat(web): tesorería operativa`

---

### Task 12: Seed demo, e2e y README

**Files:**
- Modify: `seed/demo.ts` y `seed/demo-completo.ts`. Se agregan:
  - la sucursal "Sucursal Rosario" (ROS) con "Caja Rosario";
  - la "Caja principal" en CEN;
  - el usuario `cajero.rosario@demo.com` / `cajero1234` con el rol "Cajero sucursal" (`tesoreria.ver`, `tesoreria.operar`, `tercero.ver`) asignado a ROS;
  - el permiso `tesoreria.aceptar`, `tesoreria.ver` al rol Tesorero;
  - vía servicios: un ingreso en ROS (cheque y efectivo), un traslado ROS → CEN en tránsito, un ingreso en CEN con dos cheques (uno depositado y pendiente de acreditar), una transferencia recibida pendiente y el débito pendiente del cheque propio de la OP pagada (si es diferido).
- Modify: `test/seed.e2e-spec.ts`, `README.md`
- Create: `e2e/tesoreria.spec.ts`
- [ ] **Step 1: Tests que fallan:**
  - `seed.e2e-spec`: 2 sucursales, cheques en EN_CARTERA, EN_TRANSITO y DEPOSITADO, el usuario cajero con `sucursalId` y asientos balanceados.
  - `e2e/tesoreria.spec.ts`:
    1. `cajero.rosario` ingresa un cobro a cuenta de "Supermercados Litoral S.A." con un cheque de número único.
    2. Lo envía a casa central.
    3. `tesorero` recibe el traslado, deposita el cheque en Banco Nación y lo acredita.
    4. En Cartera, el cheque figura "Acreditado" y su historial tiene 5 pasos.
    5. En Saldos, el banco aumentó.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `pnpm test` y `pnpm e2e` en verde (base e2e recreada).
- [ ] **Step 5:** README: sección "Tesorería (Entrega 4A)" y usuarios demo.
- [ ] **Step 6: Commit** `feat: datos demo y prueba de punta a punta de tesorería`

---

## Cobertura de la spec

| Spec | Task |
|---|---|
| §1 Sucursales, usuarios y permisos | 1, 11 |
| §2 Cuentas nuevas | 1 |
| §3 Recepción de valores | 2 |
| §4 Traslados | 4 |
| §5 Depósitos y acreditaciones | 5 |
| §6 Rechazos, devoluciones y endosos | 6, 7 |
| §7 Cheques propios, bancos y cajas | 8, 9 |
| §8 Consultas | 3, 5, 10 |
| §9 Web | 11 |
| §10 Concurrencia | 2, 4, 5, 7, 9 |
| §11 Pruebas y seed | todas, 12 |

**Decisiones del plan que la spec no fijaba:**
- Anular una OP con cheques propios ya debitados se bloquea.
- Los usuarios de sucursal no ven saldos bancarios.
- El historial de un cheque registra también el paso de null a EN_CARTERA en el ingreso.
