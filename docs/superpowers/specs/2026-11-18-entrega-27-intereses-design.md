# Entrega 27: Intereses por mora

## 1. Objetivo

Cobrar intereses a los clientes que pagan tarde, facturándolos una vez por mes con una tasa fija.

**Por qué:** hoy el interés se calcula afuera y la nota de débito se carga a mano. Además completa el circuito de cobranzas de la Entrega 25.

**Éxito:** al cerrar el mes se abre *Ventas → Intereses por mora*. Se ve, por cliente, cada factura vencida con sus días de atraso y su interés. Se puede destildar lo que no se quiere cobrar. Al confirmar, se emite una nota de débito por cliente (y por moneda). Un mes no se puede facturar dos veces.

## 2. Objetivos, no objetivos y antiobjetivos

**Objetivos:**
- tasa mensual por empresa;
- clientes exceptuados;
- cálculo al cierre de un mes;
- liquidación con selección;
- emisión de las notas de débito;
- historial.

**No objetivos:**
- tasas distintas por cliente o por tramo;
- interés compuesto;
- intereses en tiempo real, en la agenda o en el recibo;
- intereses sobre cheques rechazados.

**Antiobjetivos:**
- facturar dos veces el mismo mes de la misma factura;
- cobrar interés de días en los que la factura ya estaba pagada a fin de mes;
- mezclar monedas en una nota de débito;
- que el interés genere comisión.

## 3. Configuración

*Ventas → Intereses por mora → Configuración* (permiso `intereses.liquidar`).

- **Modelo `ConfigIntereses`** (uno por empresa):
  - `tasaMensual`: porcentaje con 2 decimales, mayor que 0 y hasta 100;
  - `descripcion` del renglón, por defecto `Intereses por mora`.
- **Cliente exceptuado:** `Tercero.sinIntereses` (boolean, por defecto `false`), editable en la ficha del cliente. Un cliente con `true` no aparece en el cálculo.

Sin configuración, la pantalla pide cargar la tasa y el cálculo responde 400 `Configure la tasa de interés por mora`.

## 4. Cálculo de un mes

Solo se pueden liquidar meses ya terminados (anteriores al mes actual). Si no: 400 `Solo se liquidan meses terminados`.

**Qué facturas entran:** comprobantes de venta `FACTURA` o `NOTA_DEBITO` autorizados, de clientes sin `sinIntereses`, que cumplan las tres condiciones:
- vencimiento anterior o igual al último día del mes;
- saldo positivo al último día del mes;
- sin un renglón de interés vigente para ese mes (§6).

Las notas de débito de intereses no generan intereses.

**Saldo al cierre:** el saldo actual de la factura (en su moneda) **más** lo que se le aplicó después del fin de mes. Lo aplicado después es la suma de `importe` de las `AplicacionCobro` no anuladas cuyo débito es la factura y cuyo **movimiento crédito** (el pago o la nota de crédito) tiene fecha posterior al fin de mes. Cuenta la fecha del crédito y no la de la aplicación: un anticipo recibido antes del cierre y aplicado después se toma como pagado a tiempo. Así, liquidar noviembre el 3 de diciembre no pierde la deuda pagada el 1° de diciembre.

**Días:** del día siguiente al vencimiento, o del 1° del mes si venció antes, hasta el último día del mes inclusive.
- Ejemplo: vence el 10/11 → 20 días en noviembre.
- Ejemplo: vencida en octubre → 30 días en noviembre.

**Interés:** `saldo al cierre × tasa / 100 × días / 30`, redondeado al centavo, en la moneda de la factura. Es el **neto** del renglón, y el IVA va encima (decisión del usuario). Es interés simple: cada mes cobra solo sus días.

**Ejemplo:** factura de $ 1.210 (1.000 + 21 %), 5 % y 30 días → interés de 60,50 + IVA 12,71 = nota de 73,21.

**IVA del interés:** el de la factura que lo origina, es decir la alícuota con mayor base gravada de esa factura. Si la factura es toda exenta o no gravada, el interés también lo es.

## 5. Liquidación (*Ventas → Intereses por mora*)

**Consulta (`GET ?anio&mes`):** el cálculo del §4 agrupado por cliente y moneda. Para cada factura: comprobante, vencimiento, saldo al cierre, días, tasa e interés. Por grupo: el total.

**Confirmar (`POST`):**
- **Body:** `{ anio, mes, excluir: string[] }`, donde `excluir` lleva los ids de las facturas destildadas. Para destildar un cliente entero se envían todas sus facturas.
- **Modelo `LiquidacionIntereses`:** número, mes, año, tasa usada, fecha y usuario.
- **Renglones (`LiquidacionInteresesRenglon`):** factura, cliente, moneda, saldo, días, interés, alícuota y la nota de débito que lo factura.
- **Notas de débito:** una por cliente y moneda.
  - **Asociado:** la factura vencida más vieja de ese grupo.
  - **Renglones:** uno por factura, con descripción `Intereses por mora FC A 0002-00000123 (20 días)`.
  - **Fecha:** el día de la confirmación; vencimiento a la misma fecha.
  - **Punto de venta:** el de la factura asociada.
  - **Vendedor:** ninguno, ni se hereda (§2).
  - No se aplican solas al asociado (`aplicarAAsociado: false`), así quedan como deuda nueva.
- **Emisión:** las notas se crean en la misma transacción y se emiten después, una por una, con el circuito existente. Si ARCA falla en una, la nota queda pendiente de CAE (como cualquier comprobante) y se informa. La liquidación queda igual, y la nota se reintenta desde *Comprobantes de venta*.
- **Sin renglones:** 400 `No hay intereses para liquidar en MM/AAAA`.

**Historial:** las liquidaciones con número, mes, tasa, total por moneda y sus notas de débito, con el estado de cada una.

## 6. Doble facturación

Un renglón de interés está **vigente** salvo que su nota de débito:
- se haya eliminado sin autorizar (borrador eliminado), o
- esté cancelada por completo por notas de crédito asociadas a ella.

Un renglón vigente impide volver a liquidar esa factura en ese mes. Así, si se anula la nota con una nota de crédito, el mes queda libre para volver a liquidarse.

Dos confirmaciones simultáneas del mismo mes se serializan con un bloqueo por empresa: la segunda ya no encuentra las facturas.

## 7. Permisos

**Permiso nuevo:** `intereses.liquidar`, para configurar, consultar, confirmar y ver el historial.
- La migración lo agrega al rol Administrador de las empresas existentes.
- En la demo, también lo tiene el rol Facturación.

**Emisión:**
- al confirmar, las notas de débito se emiten con este permiso; no hace falta además `venta.emitir`;
- reintentar, corregir o eliminar una nota pendiente se hace desde *Comprobantes de venta*, con `venta.emitir`, como cualquier comprobante.

## 8. Enfoques considerados

- **Calcular al cierre desde la cuenta corriente y guardar la liquidación** (elegido). Hay revisión antes de facturar, y el registro impide la doble facturación.
- **Devengar el interés todos los días en forma automática.** Factura sin revisión y no permite destildar. Descartado.

## 9. Decisiones

**Del usuario:**
- intereses por mora;
- una vez por mes y con tasa fija;
- una nota de débito por cliente, asociada a su factura vencida más vieja, con un renglón por factura.

**Del builder (pueden revisarse):**
- interés simple sobre el saldo al cierre: días del mes sobre 30;
- una nota por moneda;
- el IVA, el de la alícuota con mayor base de la factura de origen;
- las notas de intereses no llevan vendedor y no generan intereses;
- un renglón queda libre si su nota se anula con notas de crédito;
- solo meses terminados;
- permiso nuevo `intereses.liquidar`;
- en la demo, una tasa del 5 %.

**Del usuario, según la revisión:**
- el interés es el neto y el IVA va encima.

**Del builder, según la revisión:**
- **Cuenta contable:** los renglones de interés van a la cuenta del concepto nuevo `INTERESES_GANADOS` (por defecto *4.2.02 Intereses ganados*), no a Ventas. La migración lo crea en las empresas con esa cuenta, y en las nuevas lo trae la precarga.
- **Nota rechazada por ARCA:** queda `RECHAZADO`, como cualquier comprobante. Su renglón sigue vigente hasta que se elimine el borrador.
- **Edición:** una nota de intereses no se puede modificar: 400 `Las notas de débito de intereses no se modifican: elimínela y vuelva a liquidar`. Sí se puede eliminar mientras no esté autorizada. El renglón guarda el id de la nota sin clave foránea, y el historial la muestra como "eliminada".
- **Pagos posteriores al cierre:** cuenta la fecha del movimiento crédito (§4).

## 10. Pruebas

**API:**
- **Cálculo:**
  - días con vencimiento dentro del mes y antes del mes;
  - saldo al cierre con un pago posterior al fin de mes;
  - IVA (21 %, 10,5 % y exento) sobre el interés neto;
  - anticipo anterior al cierre aplicado después: no suma;
  - factura en dólares;
  - cliente exceptuado;
  - mes no terminado.
- **Confirmación:**
  - una nota por cliente y moneda, asociada a la más vieja, con un renglón por factura y sin vendedor;
  - no se liquida dos veces;
  - liberación por nota de crédito;
  - dos confirmaciones simultáneas;
  - nota rechazada por ARCA: queda rechazada y bloquea el mes hasta eliminarla;
  - una nota de intereses no se modifica;
  - la cuenta contable es la de `INTERESES_GANADOS`.
- Permisos.

**Web:**
- tabla con selección y total;
- configuración.

**E2E:** el administrador configura la tasa, liquida un mes con una factura vencida y ve la nota de débito emitida.
