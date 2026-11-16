# Entrega 24: Vendedores y comisiones

## 1. Objetivo

Que la empresa pague a sus vendedores un porcentaje de lo que efectivamente se cobra de las facturas que vendieron.

Hay dos clases de vendedor:
- **Empleados en relación de dependencia:** la comisión sale en el recibo de sueldo, en un concepto no remunerativo.
- **Vendedores externos:** facturan su comisión y se les paga como a cualquier proveedor.

**Por qué:** hoy el sistema no conoce la figura de vendedor. Las comisiones se calculan afuera, en planillas, cruzando cobranzas y facturas a mano.

**Éxito:** a fin de mes se abre *Comisiones*, se elige el mes y se ve cuánto le corresponde a cada vendedor y por qué factura y cobro. Al confirmar:
- la comisión del empleado queda cargada en su recibo de sueldo del mes;
- la del externo queda en un comprobante de liquidación en PDF.

## 2. Objetivos, no objetivos y antiobjetivos

**Objetivos:**
- maestro de vendedores;
- vendedor en el cliente, el pedido y la factura;
- cálculo sobre lo cobrado;
- liquidación mensual confirmable;
- conexión con sueldos;
- PDF para el externo.

**No objetivos (para después):**
- escalas por monto;
- porcentajes distintos por artículo o rubro;
- comisión sobre lo facturado o sobre el margen;
- varios vendedores por factura;
- objetivos de venta;
- asiento contable propio de la comisión.

**Antiobjetivos (sería un fracaso aunque funcione):**
- pagar dos veces la misma cobranza;
- pagar comisión por una nota de crédito o por un cobro que después se anuló sin descontarlo;
- que cambiar el porcentaje del vendedor altere comisiones de facturas ya emitidas;
- tocar el circuito ya probado de recibos y aplicaciones de cobro.

## 3. Maestro de vendedores

*Maestros → Vendedores*, permiso `venta.maestros`. El permiso es nuevo; ver §10.

**Datos del vendedor:**
- nombre (único en la empresa);
- tipo: `EMPLEADO` o `EXTERNO`;
- porcentaje de comisión, entre 0 y 100, con dos decimales;
- activo.

**Tipo EMPLEADO:**
- `empleadoId` es obligatorio y apunta a un empleado de sueldos;
- cada empleado tiene a lo sumo un vendedor.

**Tipo EXTERNO:**
- `proveedorId` es obligatorio y apunta a un tercero con `esProveedor`;
- cada proveedor tiene a lo sumo un vendedor.

Un vendedor inactivo no se ofrece en clientes, pedidos ni facturas, pero se sigue liquidando lo que tenga pendiente.

## 4. Asignación del vendedor

- **Cliente:** `Tercero.vendedorId` es opcional y representa el vendedor habitual. Se edita en la ficha del cliente.
- **Pedido de venta:** `PedidoVenta.vendedorId` es opcional. Se propone el del cliente y se puede cambiar.
- **Comprobante de venta (factura, ND):**
  - se graban dos columnas de copia: `ComprobanteVenta.vendedorId` y `ComprobanteVenta.comisionPct`;
  - el vendedor se propone así: el del pedido o remito de origen, si viene de uno; si no, el del cliente. Se puede cambiar o dejar vacío;
  - `comisionPct` es el porcentaje del vendedor **al emitir**. No cambia si después se modifica el vendedor.
- **Nota de crédito:** hereda vendedor y porcentaje de su comprobante asociado. No genera comisión (§5).
- **Datos existentes:** los comprobantes previos a esta entrega quedan sin vendedor y no comisionan.

## 5. Qué genera comisión

Genera comisión una aplicación de cobro (`AplicacionCobro`) que cumple todo esto:
1. **Débito:** su movimiento débito es un comprobante de venta (origen `VENTA`) con `vendedorId`.
2. **Crédito:** su movimiento crédito es un cobro (origen `RECIBO` o `COBRO`). Las notas de crédito y los cheques rechazados no comisionan.
3. **No anulada** al momento de liquidar.
4. **Mes:** su `fecha` cae en el mes que se liquida o antes.
5. **Pendiente:** todavía no está en una liquidación confirmada.

**Cálculo por aplicación:**
- `cobradoPesos` = `importePesosDebito` de la aplicación;
- `netoPesos` = `cobradoPesos × netoComprobante / totalComprobante`, redondeado al centavo. El neto es neto gravado + no gravado + exento, es decir, el total sin IVA ni otros tributos;
- `comision` = `netoPesos × comisionPct / 100`, redondeado al centavo.

**Ajuste por anulación:** una aplicación ya liquidada que hoy figura anulada entra en la próxima liquidación del vendedor como **renglón negativo**, por la misma comisión que se pagó. Se descuenta una sola vez.

## 6. Liquidación de comisiones

*Ventas → Comisiones*. Ver requiere `venta.ver`; confirmar y anular requieren `comisiones.liquidar` (permiso nuevo).

**Consulta del mes (`GET`):**
- calcula en el momento, sin grabar, los renglones pendientes de cada vendedor hasta el último día del mes: los positivos (§5) y los ajustes negativos;
- muestra por vendedor: tipo, cantidad de renglones, neto cobrado, porcentaje y comisión total;
- el detalle de cada renglón muestra fecha del cobro, cliente, comprobante, recibo, cobrado, neto, porcentaje y comisión;
- incluye aplicaciones de meses anteriores que no se liquidaron.

**Confirmar (`POST`, con el mes):**
- **Contenido:** graba una `LiquidacionComisiones` (número, mes, año, fecha, estado) con sus `LiquidacionComisionesRenglon`. Cada renglón tiene vendedor, aplicación, comprobante, cobrado, neto, porcentaje, comisión y si es ajuste.
- **Sin duplicados:** una aplicación puede estar en a lo sumo una liquidación confirmada como positiva y en una como ajuste. Lo garantizan índices únicos parciales y el bloqueo de las aplicaciones.
- **Una por mes:** una sola liquidación confirmada por mes. Para rehacerla se anula y se confirma de nuevo.
- **Vendedores empleados:** se carga en la liquidación **mensual** de sueldos del mismo mes una novedad `IMPORTE` en el concepto de comisiones configurado (§7), por la comisión total del vendedor, con detalle `Comisiones MM/AAAA`.
  - La mensual tiene que existir y estar en borrador; si no, 400 `La liquidación mensual de sueldos de MM/AAAA no está en borrador: créela o reábrala antes de confirmar las comisiones`.
  - Si el total del empleado es ≤ 0 (por ajustes), no se carga novedad. El saldo negativo pasa al mes siguiente como ajuste pendiente.
- **Vendedores externos:** quedan disponibles en el PDF de liquidación por vendedor: empresa, vendedor, mes, detalle y total.
- **Sin renglones:** si no hay nada pendiente, 400 `No hay comisiones para liquidar en MM/AAAA`.

**Anular (`POST …/anular`, con motivo):**
- solo si la mensual de sueldos del mes sigue en borrador. Si se cerró, 400 `La liquidación mensual de sueldos de MM/AAAA está cerrada: reábrala antes de anular las comisiones`;
- borra las novedades que cargó y libera sus renglones, que vuelven a quedar pendientes.

## 7. Configuración

En la configuración de sueldos se elige el **concepto de comisiones**: un concepto de tipo `FIJO`, activo, de clase `NO_REMUNERATIVO` o `REMUNERATIVO`.

La migración y la precarga crean `Comisiones` (código 210, `FIJO`, `NO_REMUNERATIVO`, sin convenio) en las empresas que tienen conceptos de sueldos y lo dejan configurado. Se puede elegir otro, por ejemplo uno remunerativo: la ley de contrato de trabajo trata a las comisiones como remuneración y la empresa decide.

Si no hay concepto configurado y hay vendedores empleados con comisión, al confirmar: 400 `Configure el concepto de comisiones en sueldos`.

## 8. Pantallas

- **Maestros → Vendedores:** lista y formulario. Al elegir el tipo se muestra el empleado o el proveedor.
- **Ficha del cliente:** campo *Vendedor*.
- **Pedido y comprobante de venta:** selector *Vendedor*, precargado como en §4.
- **Ventas → Comisiones:**
  - selector de mes, tabla por vendedor y detalle desplegable;
  - botón *Confirmar liquidación*;
  - historial de liquidaciones con *Anular*;
  - PDF por vendedor externo.

```
Comisiones de 11/2026                              [Confirmar liquidación]
Vendedor        Tipo      Renglones  Neto cobrado    %     Comisión
Pérez, Juan     Empleado     12      1.250.000,00   3,00   37.500,00
Ruiz SRL        Externo       5        800.000,00   5,00   40.000,00   [PDF]
```

## 9. Enfoques considerados

- **A. Grabar la comisión en el momento del cobro.** Cada aplicación y anulación crea su renglón. Obliga a tocar todos los caminos que aplican cobros, y olvidar uno deja comisiones de menos sin aviso. Descartado.
- **B. Calcular al liquidar desde `AplicacionCobro`** (elegido). No toca recibos ni aplicaciones, cubre cualquier camino de cobro, y la atadura renglón ↔ aplicación evita el doble pago.
- **C. Todo dentro de sueldos.** Deja afuera a los externos. Descartado.

## 10. Decisiones del usuario y del builder

**Del usuario:**
- dos clases de vendedor;
- el empleado cobra en el recibo como no remunerativo;
- comisión sobre lo cobrado;
- un porcentaje por vendedor;
- enfoque B.

**Del builder (pueden revisarse):**
- base de la comisión: el neto sin IVA, proporcional a lo cobrado, en pesos (`importePesosDebito`);
- la liquidación es mensual; la novedad va a la mensual del mismo mes; una sola liquidación confirmada por mes;
- permisos nuevos: `venta.maestros` y `comisiones.liquidar`. A la demo se le da el de comisiones al Administrador (ya tiene todos);
- la demo agrega un vendedor empleado (vinculado a un empleado existente) y uno externo (vinculado a un proveedor existente), asignados a clientes demo.

**Del builder, según la revisión:** *(se completa con el control del builder)*

## 11. Pruebas

**API:**
- maestro con sus validaciones;
- copia del vendedor y del porcentaje en la factura;
- comisión de un recibo total y de uno parcial;
- una NC aplicada no comisiona;
- factura en dólares (pesos de la aplicación);
- confirmar carga la novedad en la mensual;
- no se liquida dos veces;
- dos confirmaciones simultáneas: una 201 y otra 400;
- anular un recibo ya liquidado da un ajuste negativo en el mes siguiente;
- anular la liquidación;
- mensual cerrada → 400;
- permisos.

**Web:** selector de vendedor precargado, tabla de comisiones y confirmación.

**E2E:** recibo de una factura con vendedor empleado → comisiones del mes → confirmar → la mensual de sueldos tiene la novedad.
