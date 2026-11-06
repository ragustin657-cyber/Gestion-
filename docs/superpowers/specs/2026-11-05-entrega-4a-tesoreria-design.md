# Entrega 4A: Tesorería operativa. Especificación de diseño

**Fecha:** 2026-11-05
**Estado:** aprobado en conversación, pendiente de revisión escrita
**Spec general:** `docs/superpowers/specs/2026-11-05-sistema-gestion-design.md` (§5)
**Construye sobre:**
- Entregas 1 a 3: maestros de tesorería (`Banco`, `CuentaBancaria`, `Chequera`, `Caja`);
- `MovimientoTesoreria`, `ChequePropio`, `MovimientoCuentaCorriente`, `AplicacionCuentaCorriente`;
- órdenes de pago y el motor de asientos.

## 0. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Origen del dinero | Casa central más sucursales que cobran y rinden. |
| Cómo informan las sucursales | Usan este sistema, con usuarios asignados a su sucursal. |
| Destino de lo cobrado en sucursales | Según el caso: se deposita directamente en el banco o se envía a casa central (traslado). |
| Alcance | Esta entrega es la 4A (operativa). La conciliación bancaria es la Entrega 4B. |
| Asiento del depósito | Se registra en el banco al depositar. La acreditación confirma la fecha y el estado, sin asiento. Excepción: las transferencias recibidas se registran en el banco al acreditarse. |

**Criterio de éxito:**
1. Un usuario de la sucursal Rosario registra un cobro a cuenta de un cliente con un cheque y efectivo, y envía ambos a casa central.
2. Casa central recibe el traslado, deposita el cheque en el banco y confirma su acreditación.
3. El cheque muestra su historial completo, los saldos de caja y banco son correctos en cada paso y todos los asientos balancean.
4. Otro cheque se rechaza y la deuda vuelve al cliente.
5. Un tercer cheque se endosa a un proveedor en una orden de pago.

**Fuera de alcance:**
- conciliación bancaria (4B);
- aplicación de cobros a facturas de venta y recibos (Entrega 6);
- e-cheq por API bancaria;
- fondos fijos con rendición formal.

## 1. Sucursales y usuarios

- `Sucursal { empresaId, codigo, nombre, domicilio?, esCentral Bool, activa }`, única por `empresaId + codigo`.
  - Exactamente una sucursal es central por empresa.
  - Se crea "Casa central" al crear la empresa (y por migración para las existentes).
- `Caja.sucursalId` (obligatorio). Las cajas existentes pasan a la casa central.
- `UsuarioEmpresa.sucursalId?`: null significa "todas las sucursales".
- **Alcance de un usuario con sucursal:**
  - Solo puede operar cajas, cheques en cartera, ingresos, traslados (enviados o recibidos por su sucursal) y depósitos de su sucursal.
  - Las consultas se filtran a su sucursal.
  - Los intentos sobre otra sucursal responden 404.
- **Permisos nuevos:**
  - `tesoreria.ver`: consultas;
  - `tesoreria.operar`: ingresos, traslados, depósitos, movimientos de caja y arqueos;
  - `tesoreria.aceptar`: recibir traslados, acreditar, rechazar cheques, debitar cheques propios y movimientos bancarios;
  - `tesoreria.anular`;
  - el existente `tesoreria.maestros.editar` se mantiene.
- **ABM de sucursales:** en Maestros › Bancos y cajas (pestaña Sucursales), con `tesoreria.maestros.editar`. La asignación de sucursal a usuarios se hace en Administración › Usuarios.

## 2. Cuentas contables nuevas

Se agregan al plan modelo (y a los planes de las empresas existentes por migración) y como conceptos de `ConfigCuenta`:

| Concepto | Cuenta |
|---|---|
| `VALORES_A_DEPOSITAR` | 1.1.01.003, ya existe |
| `TRANSFERENCIAS_A_ACREDITAR` | 1.1.01.004 Transferencias a acreditar (nueva) |
| `VALORES_EN_TRANSITO` | 1.1.01.005 Valores en tránsito (nueva) |
| `DEUDORES_POR_VENTAS` | 1.1.02.001, ya existe |
| `CHEQUES_RECHAZADOS` | 1.1.02.002 Cheques rechazados (nueva) |
| `GASTOS_BANCARIOS` | 5.2.02, ya existe |
| `DIFERENCIAS_DE_CAJA` | 5.2.04 Diferencias de caja (nueva) |

## 3. Recepción de valores

**Tablas**
- `IngresoValores { empresaId, sucursalId, numero (talonario 'ING-<código de sucursal>', numeración propia de cada sucursal), fecha, cajaId, origen CLIENTE | OTRO, terceroId?, cuentaContableId?, concepto, estado CONFIRMADO | ANULADO, asientoId, asientoAnulacionId?, motivoAnulacion?, creadoPor }`.
- `ChequeTercero { empresaId, ingresoId, tipo FISICO | ECHEQ, banco String, numero String, libradorNombre, libradorCuit?, fechaEmision, fechaPago, monedaCodigo, importe, estado, cajaId?, cuentaBancariaId?, terceroOrigenId?, terceroDestinoId?, fechaDeposito?, fechaAcreditacion?, fechaRechazo?, motivoRechazo? }`.
  - Único por `empresaId + banco + numero + libradorCuit`, aunque esté anulado.
  - `cajaId` indica la ubicación cuando está en cartera.
- `MovimientoCheque { empresaId, chequeId, fecha, estadoAnterior, estadoNuevo, cajaId?, cuentaBancariaId?, origenTipo, origenId, usuarioId }`: historial.
- `TransferenciaRecibida { empresaId, ingresoId, cuentaBancariaId, fecha, referencia?, monedaCodigo, importe, estado PENDIENTE | ACREDITADA | ANULADA, fechaAcreditacion? }`.
- `IngresoValoresEfectivo { empresaId, ingresoId, monedaCodigo, importe }`. El efectivo entra en la caja del ingreso, que debe ser de la misma moneda.

**Reglas**
- Al menos un valor.
- Origen CLIENTE: `terceroId` de un tercero con `esCliente`. Crea un `MovimientoCuentaCorriente` con `origenTipo 'COBRO'`, importe negativo (saldo a favor del cliente) y una moneda por valor. Si hay valores en dos monedas, se crea un movimiento por moneda.
- Origen OTRO: `cuentaContableId` imputable, obligatoria.
- El efectivo crea un `MovimientoTesoreria` INGRESO en la caja.
- Los cheques quedan EN_CARTERA en la caja del ingreso.
- Las transferencias quedan PENDIENTE, sin movimiento de banco hasta la acreditación.
- Cheque duplicado: 409 "El cheque N del banco X ya fue registrado".
- Fecha de pago anterior a hoy en más de 30 días: la API acepta y devuelve `advertencias: ['El cheque N está vencido para depositar']`. La web la muestra antes de confirmar.
- **Asiento (en pesos, cotización del día para USD):**

  | Debe | Haber |
  |---|---|
  | Caja (cuenta de la caja) por el efectivo | DEUDORES_POR_VENTAS (CLIENTE) o la cuenta elegida (OTRO), por el total |
  | VALORES_A_DEPOSITAR por los cheques | |
  | TRANSFERENCIAS_A_ACREDITAR por las transferencias | |

- **Anular** (`tesoreria.anular`):
  - Solo si todos los cheques siguen EN_CARTERA en la caja original, todas las transferencias PENDIENTE y, si es CLIENTE, el movimiento de cuenta corriente no tiene aplicaciones.
  - Genera el contraasiento; los cheques y transferencias pasan a ANULADO.
  - Anula el `MovimientoTesoreria` del efectivo y el movimiento de cuenta corriente.

## 4. Traslados de valores

- `Traslado { empresaId, numero (talonario 'TRA'), fecha, cajaOrigenId, cajaDestinoId, estado ENVIADO | RECIBIDO | RECIBIDO_PARCIAL | ANULADO, observaciones?, fechaRecepcion?, creadoPor, recibidoPor? }`.
- `TrasladoItem { empresaId, trasladoId, tipo CHEQUE | EFECTIVO, chequeId?, monedaCodigo, importe, aceptado Bool?, motivoRechazo? }`.
- **Enviar** (`tesoreria.operar`, sobre la caja de origen):
  - Cajas distintas.
  - Los cheques deben estar EN_CARTERA en la caja de origen y pasan a EN_TRANSITO.
  - El efectivo no puede superar el saldo de la caja: 400 "Saldo insuficiente en la caja".
  - El efectivo genera un EGRESO de la caja de origen y el asiento debe VALORES_EN_TRANSITO, haber Caja de origen.
- **Recibir** (`tesoreria.aceptar`, usuario de la sucursal de destino o de todas):
  - Por item, aceptado o rechazado con motivo.
  - Lo aceptado pasa a la caja de destino: los cheques vuelven a EN_CARTERA con `cajaId` de destino, y el efectivo genera un INGRESO en la caja de destino con asiento debe Caja de destino, haber VALORES_EN_TRANSITO.
  - Lo rechazado vuelve a la caja de origen: los cheques a EN_CARTERA en el origen, y el efectivo con un INGRESO en el origen y su asiento contra VALORES_EN_TRANSITO.
  - El estado queda RECIBIDO si todo se aceptó, o RECIBIDO_PARCIAL.
- **Anular un ENVIADO** (solo el origen, `tesoreria.anular`): todo vuelve al origen.
- Los cheques no generan asiento en el traslado.

## 5. Depósitos y acreditaciones

- `Deposito { empresaId, numero (talonario 'DEP'), fecha, cajaId, cuentaBancariaId, boleta?, estado CONFIRMADO | ANULADO, asientoId }` y `DepositoItem { empresaId, depositoId, tipo, chequeId?, monedaCodigo, importe }`.
- **Depositar** (`tesoreria.operar`):
  - Cheques EN_CARTERA en esa caja y efectivo ≤ saldo de la caja.
  - La moneda de cheques y efectivo debe ser la de la cuenta bancaria.
  - Los cheques pasan a DEPOSITADO (`cuentaBancariaId`, `fechaDeposito`).
  - Movimientos de tesorería: EGRESO de caja por el efectivo, INGRESO del banco por el total (fecha = fecha del depósito).
  - **Asiento:**

    | Debe | Haber |
    |---|---|
    | Banco por el total | VALORES_A_DEPOSITAR (cheques) |
    | | Caja (efectivo) |

- **Acreditar** (`tesoreria.aceptar`):
  - `POST /api/tesoreria/acreditaciones { fecha, cheques: [id], transferencias: [id] }`.
  - Los cheques DEPOSITADO pasan a ACREDITADO con `fechaAcreditacion`, sin asiento.
  - Las transferencias PENDIENTE pasan a ACREDITADA: INGRESO del banco y asiento debe Banco, haber TRANSFERENCIAS_A_ACREDITAR.
- **Anular un depósito:** solo si ningún cheque se acreditó ni se rechazó. Contraasiento, los cheques vuelven a EN_CARTERA en la caja y se anulan los movimientos de tesorería.

## 6. Rechazos, devoluciones y endosos

- **Rechazar** (`tesoreria.aceptar`) un cheque DEPOSITADO o ACREDITADO con `{ fecha, motivo, gastos? }`:
  - Estado RECHAZADO.
  - EGRESO del banco por importe + gastos.
  - **Asiento:**

    | Debe | Haber |
    |---|---|
    | CHEQUES_RECHAZADOS (importe) | Banco (importe + gastos) |
    | GASTOS_BANCARIOS (gastos) | |

  - **Si el cheque vino de un cliente:** `MovimientoCuentaCorriente` del cliente con `origenTipo 'CHEQUE_RECHAZADO'` e importe positivo, que vuelve a deber.
- **Rechazo de un cheque ENDOSADO** (lo informa el proveedor): con `{ fecha, motivo }`:
  - Estado RECHAZADO.
  - `MovimientoCuentaCorriente` del proveedor con `origenTipo 'CHEQUE_RECHAZADO'` e importe positivo: se le vuelve a deber.
  - Si vino de un cliente, también el movimiento positivo en la cuenta del cliente.
  - **Asiento:** debe CHEQUES_RECHAZADOS, haber PROVEEDORES.
- **Devolver** un RECHAZADO al cliente (o al proveedor que lo devolvió): estado DEVUELTO, sin asiento. El cheque físico sale de la empresa.
- **Endoso como medio de pago en la OP:**
  - Medio nuevo `CHEQUE_TERCERO` con `{ chequeId }`. El importe es el del cheque y la moneda la del cheque.
  - Exige el cheque EN_CARTERA en una caja que el usuario pueda operar.
  - Al pagar: ENDOSADO con `terceroDestinoId` = proveedor y asiento haber VALORES_A_DEPOSITAR.
  - Si se anula la OP pagada, vuelve a EN_CARTERA en su caja original.
  - El bloqueo de cheques se agrega al orden de la Entrega 3: OP → tercero → movimientos → chequeras → cheques de terceros.

## 7. Cheques propios, movimientos bancarios y cajas

**Cheques propios**
- Estado nuevo DEBITADO (`fechaDebito`).
- `POST /api/tesoreria/cheques-propios/debitar { fecha, cheques: [id] }` (`tesoreria.aceptar`).
- Un cheque **diferido** genera un EGRESO del banco y el asiento debe CHEQUES_DIFERIDOS, haber Banco.
- Un cheque **al día** (que ya generó su egreso al pagar) solo cambia de estado y fecha.
- No se puede debitar un cheque ANULADO.

**Movimientos bancarios** (`tesoreria.aceptar`)
- `MovimientoBancario { empresaId, numero, fecha, cuentaBancariaId, tipo GASTO | INGRESO, cuentaContableId, concepto, importe, estado, asientoId }`.
- Genera el `MovimientoTesoreria` y el asiento contra la cuenta del banco.

**Transferencias entre cuentas propias** (`tesoreria.aceptar`)
- `TransferenciaInterna { origen cuenta o caja, destino cuenta o caja, fecha, importeOrigen, importeDestino, cotizacion?, asientoId }`.
- **Misma moneda:** importeOrigen = importeDestino.
- **Distinta moneda:** se indican los dos importes, y la diferencia contra la cotización del día va a diferencia de cambio.
- **Asiento:**

  | Debe | Haber |
  |---|---|
  | Cuenta de destino (pesos) | Cuenta de origen (pesos) |
  | ± diferencia de cambio | |

**Cajas** (`tesoreria.operar`)
- **Saldo de caja** = Σ INGRESO − Σ EGRESO no anulados de `MovimientoTesoreria`, por caja.
- **Movimiento manual de caja:** `MovimientoCaja { cajaId, fecha, tipo INGRESO | EGRESO, cuentaContableId, concepto, importe, asientoId }`. Un egreso mayor al saldo da 400.
- **Arqueo:** `Arqueo { numero, cajaId, fecha, saldoSistema, contado, diferencia, motivo?, asientoId? }`.
  - Si la diferencia ≠ 0, el motivo es obligatorio y se genera un movimiento de caja más el asiento contra DIFERENCIAS_DE_CAJA (sobrante en el haber y faltante en el debe).

## 8. Consultas

Todas con `tesoreria.ver` y filtradas por la sucursal del usuario:

- **Saldos a una fecha:**
  - cuentas bancarias: Σ movimientos de tesorería no anulados con fecha ≤ X;
  - cajas: efectivo más cheques en cartera.
- **Cartera de cheques de terceros:** filtros de estado, sucursal, caja, rango de fecha de pago y librador; totales por semana de vencimiento.
- **Traslados en tránsito.**
- **Pendientes de acreditar:** cheques depositados y transferencias pendientes.
- **Cheques propios:** emitidos y no debitados, por fecha de pago.
- **Movimientos de una cuenta o caja** entre fechas, con saldo inicial y acumulado.
- **Historial de un cheque.**
- **Flujo de fondos proyectado**, por día durante N días desde hoy:
  - saldo bancario actual;
  - \+ cheques en cartera y depositados no acreditados por su fecha de pago;
  - \+ transferencias pendientes;
  - − cheques propios no debitados por su fecha de pago;
  - − OP aprobadas (en la fecha de hoy).

## 9. Web

- **Registraciones › Tesorería:** Ingreso de valores, Traslado de valores (enviar), Recepción de traslados, Depósito, Acreditaciones, Rechazo de cheques, Débito de cheques propios, Movimientos bancarios, Transferencias entre cuentas, Movimientos de caja y Arqueo.
- **Consultas › Tesorería:** Saldos, Cartera de cheques, Valores en tránsito, Pendientes de acreditar, Cheques propios, Movimientos de cuenta o caja y Flujo de fondos.
- **Pago de OP:** medio "Cheque de terceros" con selector de cheques en cartera.
- **Usuarios:** selector de sucursal. **Maestros › Bancos y cajas:** pestaña Sucursales y sucursal en cada caja.
- El encabezado muestra la sucursal del usuario si tiene una asignada.

## 10. Errores y concurrencia

- Mensajes en castellano y una transacción por operación.
- **Bloqueo `FOR UPDATE`:**
  - de los cheques de terceros involucrados (ordenados por id) en traslados, recepciones, depósitos, acreditaciones, rechazos, endosos y anulaciones;
  - de la caja (fila de `Caja`) en toda operación que valide su saldo de efectivo (traslado, depósito, egreso, arqueo).
- **Orden global de bloqueo:** OP → tercero → movimientos de cuenta corriente → chequeras → cajas → cheques de terceros.
- Un valor que cambió de estado entre la lectura y la operación responde 409 "El cheque N ya no está disponible".

## 11. Pruebas

- **Integración:**
  - circuito completo de un cheque desde sucursal hasta acreditación, con saldos de caja y banco en cada paso;
  - efectivo enviado y recibido con asientos;
  - recepción parcial;
  - rechazo con gastos y cuenta corriente del cliente;
  - rechazo de un cheque endosado;
  - endoso en una OP y su anulación;
  - débito de un cheque propio diferido y de uno al día;
  - movimientos bancarios;
  - transferencia ARS → USD con diferencia de cambio;
  - arqueo con faltante y sobrante;
  - un usuario de sucursal no ve ni opera otra (404);
  - cheque duplicado;
  - dos depósitos simultáneos del mismo cheque: uno entra y el otro 409;
  - egreso o traslado mayor al saldo;
  - anulaciones con sus restricciones;
  - asientos balanceados.
- **E2E:** sucursal ingresa un cheque y lo envía → central recibe y deposita → acredita → cartera y saldo del banco.
- **Seed:**
  - sucursales "Casa central" y "Sucursal Rosario" con cajas;
  - usuario `cajero.rosario@demo.com` / `cajero1234` (`tesoreria.ver`, `tesoreria.operar`) asignado a Rosario;
  - cheques en distintos estados, un traslado en tránsito, un depósito pendiente de acreditar y un cheque propio diferido a debitar.

## 12. Orden de construcción

1. Sucursales, usuarios por sucursal, cuentas y permisos.
2. Recepción de valores.
3. Cartera e historial.
4. Traslados.
5. Depósitos y acreditaciones.
6. Rechazos y devoluciones.
7. Endoso en la OP.
8. Cheques propios: débito.
9. Movimientos bancarios, transferencias internas, movimientos de caja y arqueo.
10. Consultas.
11. Web.
12. Seed, e2e y README.
