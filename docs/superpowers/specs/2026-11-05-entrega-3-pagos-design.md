# Entrega 3: Órdenes de pago, retenciones y pagos. Especificación de diseño

**Fecha:** 2026-11-05
**Estado:** aprobado en conversación, pendiente de revisión escrita
**Spec general:** `docs/superpowers/specs/2026-11-05-sistema-gestion-design.md` (§4)
**Construye sobre:** Entregas 1 y 2: cuenta corriente (`MovimientoCuentaCorriente`), motor de asientos, `ConfigCuenta`, maestros de tesorería, comprobantes de compra.

## 0. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Retenciones | Ganancias (RG 830) e Ingresos Brutos. IVA y SUSS quedan fuera y se agregan después sobre la misma estructura. |
| Alícuota de IIBB | Padrón mensual importado (ARBA y AGIP). Si el proveedor no figura, ficha del proveedor; si tampoco hay, configuración de la jurisdicción. |
| Pago de comprobantes en USD | Pesos o dólares a elección. La cotización del día está en la OP. La diferencia de cambio se registra automáticamente. |
| Modelo | Un solo documento, Orden de Pago, con estados: Borrador → Pendiente de aprobación → Aprobada → Pagada. Los medios de pago se cargan al pagar. |
| Endoso de cheques de terceros | Pasa a la Entrega 4 (Tesorería), junto con la cartera de cheques. |

**Criterio de éxito:** en la empresa demo, un usuario arma una OP para un proveedor con una factura en pesos y otra en dólares. Un aprobador la aprueba. Un tesorero la paga con transferencia más un cheque diferido. Después se ven:
- las retenciones de Ganancias e IIBB calculadas, con sus certificados en PDF;
- el saldo del proveedor en 0 en ambas monedas;
- el asiento balanceado con la diferencia de cambio;
- los movimientos de tesorería.

Al anular la OP, todo vuelve atrás.

**Fuera de alcance:**
- endoso de cheques de terceros, cartera, débito de cheques propios y conciliación (Entrega 4);
- retenciones de IVA y SUSS;
- presentaciones SICORE/ARBA y descarga automática de padrones (Entrega 7);
- pagos masivos.

## 1. Configuración

Campos nuevos en `Empresa`:
- `montoAprobacionOp Decimal(18,2) @default(0)`. Con 0, toda OP requiere aprobación.

Conceptos contables nuevos en `ConfigCuenta`, precargados con el plan modelo:

| Concepto | Cuenta del plan modelo |
|---|---|
| `RETENCION_GANANCIAS` | 2.1.02.002 |
| `RETENCION_IIBB` | 2.1.02.004 |
| `ANTICIPOS_PROVEEDORES` | 1.1.04.001 |
| `CHEQUES_DIFERIDOS` | 2.1.01.002 |
| `DIFERENCIA_CAMBIO_POSITIVA` | 4.2.01 |
| `DIFERENCIA_CAMBIO_NEGATIVA` | 5.2.03 |

**Regímenes de Ganancias:** `RegimenGanancias { empresaId, codigo String, descripcion, minimoNoSujeto Decimal(18,2), alicuotaInscripto Decimal(18,6), alicuotaNoInscripto Decimal(18,6), usaEscala Bool, minimoRetencion Decimal(18,2), activo }`, único por `empresaId + codigo`.
- Se precarga con los regímenes 78 (enajenación de bienes de cambio), 94 (locaciones de obra y servicios), 110 (alquileres de inmuebles urbanos) y 116 (honorarios profesionales, con escala).
- Los importes precargados quedan marcados en la pantalla como **"verificar valores vigentes"**. Son editables y el contador debe revisarlos antes de operar.

**Escala de Ganancias:** `EscalaGanancias { empresaId, desde Decimal(18,2), hasta Decimal(18,2)?, fijo Decimal(18,2), porcentaje Decimal(18,6) }`.
- Se aplica al excedente del mínimo no sujeto: retención = fijo + (base − desde) × porcentaje / 100, en el tramo que corresponda.

**Jurisdicciones de IIBB:** `JurisdiccionIibb { empresaId, jurisdiccion String ('901'..'924'), alicuotaDefecto Decimal(18,6), minimoRetencion Decimal(18,2), sinPadron: NO_RETENER | ALICUOTA_DEFECTO, usaPadron Bool }`, única por `empresaId + jurisdiccion`.
- Solo se retiene en jurisdicciones de `Empresa.jurisdiccionesIibb`.
- Valores iniciales: 901 (CABA) y 902 (Buenos Aires) con `usaPadron = true` y `sinPadron = NO_RETENER`; las demás con `usaPadron = false`.

**Campo nuevo en `Tercero`:** `inscriptoGanancias Bool @default(true)`.

**Permisos nuevos:**
- `op.ver`
- `op.anular`
- `retenciones.config`
- `padron.cargar` (además, el superadmin puede cargar padrones)
- se mantienen los existentes `op.crear`, `op.aprobar` y `pago.ejecutar`.

## 2. Padrones de IIBB

**Tabla global (sin `empresaId`):** `PadronIibb { jurisdiccion, cuit, vigenciaDesde Date, vigenciaHasta Date, alicuotaPercepcion Decimal(18,6), alicuotaRetencion Decimal(18,6) }`.
- Índice por `jurisdiccion + cuit + vigenciaDesde`.
- `PadronCarga { id, jurisdiccion, periodo 'YYYY-MM', archivo, estado PROCESANDO | COMPLETA | ERROR, filas Int, error?, creadoPor, creadoEn }`.

**Formatos de archivo** (texto separado por `;`):
- **ARBA** (padrón de retenciones y percepciones, una fila por CUIT):
  `Regimen;FechaPublicacion;FechaVigenciaDesde;FechaVigenciaHasta;CUIT;TipoContribuyente;MarcaAltaSujeto;MarcaAlicuota;Alicuota;NroGrupo`.
  - Fechas `DDMMAAAA`; alícuota con coma decimal.
  - El `Regimen` es `R` (retención) o `P` (percepción) y va a la alícuota que corresponda.
- **AGIP** (padrón de regímenes generales):
  `FechaPublicacion;FechaVigenciaDesde;FechaVigenciaHasta;CUIT;TipoContribuyente;MarcaAltaSujeto;MarcaAlicuota;AlicuotaPercepcion;AlicuotaRetencion;NroGrupoPercepcion;NroGrupoRetencion;RazonSocial`.
- Los parsers ignoran las líneas vacías y reportan la primera línea inválida con su número.
- **Riesgo:** los formatos se toman de la documentación publicada. La primera carga con un archivo real valida el parser, y si difiere se ajusta.

**Carga**
- `POST /api/padrones` (multipart, `padron.cargar` o superadmin) recibe `jurisdiccion` (`901` o `902`) y el archivo.
- Responde 202 con el id de la carga.
- El procesamiento corre en segundo plano, por lotes de 5.000 filas con inserción masiva.
- Si ya existía una carga **completa** para la misma jurisdicción y período, se reemplaza en una transacción.
- `GET /api/padrones` lista las cargas con su estado.
- **Consulta:** `alicuotaPadron(jurisdiccion, cuit, fecha)` devuelve la alícuota de retención vigente, o `null` si no figura.

## 3. Motor de retenciones

Funciones puras en `packages/shared/src/pagos/retenciones.ts`, más un servicio en la API que reúne los datos.

**Base sujeta a retención de cada imputación** (en pesos a la cotización de la OP):
- Se toma el importe imputado × (netoGravado + noGravado + exento) / total del comprobante.
- En una nota de crédito la base es negativa.
- Los anticipos se toman sin IVA: su base es el importe completo.

**Ganancias**
- Si el proveedor es monotributista, está exento con `exencionHasta` vigente (o sin fecha) o no tiene régimen asignado, no hay retención.
- Si no, con el régimen del proveedor:
  - `acumulado` = base de los pagos de **OP pagadas** al proveedor en el **mes calendario** de la fecha de pago, para ese régimen, más la base de este pago.
  - `sujeto` = max(0, acumulado − mínimo no sujeto).
  - `impuesto` = sujeto × alícuota (inscripto o no inscripto según `inscriptoGanancias`), o la escala si `usaEscala`.
  - `retencion` = max(0, impuesto − retenciones de Ganancias ya practicadas en el mes por ese régimen).
  - Si `retencion` < mínimo de retención, la retención es 0.
- Se redondea a 2 decimales.

**IIBB:** por cada jurisdicción de la empresa,
- Si el proveedor tiene `TerceroIibb.exento` en esa jurisdicción, no hay retención.
- **Alícuota:**
  1. la del padrón, si la jurisdicción `usaPadron` y el CUIT figura vigente a la fecha de pago;
  2. si no, la de `TerceroIibb.alicuotaRetencion` (cuando existe la fila);
  3. si no, `alicuotaDefecto` si `sinPadron = ALICUOTA_DEFECTO`;
  4. si no, no hay retención.
- `retencion` = base del pago × alícuota / 100. Si es menor al `minimoRetencion`, la retención es 0.

**Salida del motor:** `[{ impuesto: 'GANANCIAS' | 'IIBB', jurisdiccion?, regimen?, base, alicuota, importe, detalle }]`. El detalle incluye el acumulado, el mínimo y lo ya retenido, para mostrarlo y para el certificado.

## 4. Orden de pago

**Tablas**
- `OrdenPago { empresaId, numero Int?, terceroId, fecha, cotizacion Decimal(18,6), observaciones?, estado, totalCancelarPesos, totalRetenciones, netoPagar, fechaPago?, creadoPor, aprobadoPor?, aprobadoEn?, pagadoPor?, motivoRechazo?, motivoAnulacion?, asientoId?, asientoAnulacionId?, version }`.
- `OrdenPagoImputacion { empresaId, ordenPagoId, movimientoId (MovimientoCuentaCorriente), importe Decimal(18,2) en moneda del movimiento, importePesos (a la cotización de la OP) }`.
- `OrdenPagoAnticipo { empresaId, ordenPagoId, monedaCodigo, importe }`: cero o una fila.
- `OrdenPagoRetencion { empresaId, ordenPagoId, impuesto, jurisdiccion?, regimen?, base, alicuota, importe, detalle Json, certificadoNumero Int?, anulada Bool }`.
- `OrdenPagoMedio { empresaId, ordenPagoId, tipo TRANSFERENCIA | CHEQUE | EFECTIVO, monedaCodigo, importe, importePesos, cuentaBancariaId?, cajaId?, chequeraId?, chequeNumero?, chequeFechaPago?, referencia? }`.
- `ChequePropio { empresaId, chequeraId, numero, fechaEmision, fechaPago, monedaCodigo, importe, beneficiarioId, ordenPagoId, estado EMITIDO | ANULADO }`, único por `empresaId + chequeraId + numero`.
- `MovimientoTesoreria { empresaId, fecha, tipo EGRESO | INGRESO, cuentaBancariaId?, cajaId?, monedaCodigo, importe, origenTipo, origenId, anulado }`.
- `AplicacionCuentaCorriente { empresaId, origenTipo 'OP', origenId, movimientoId, importe, importePesosHistorico, anulada }`.
- `MovimientoCuentaCorriente` agrega `origenTipo 'ANTICIPO'` para los anticipos.

**Reglas**
- **Imputaciones:**
  - Solo de movimientos del mismo proveedor, no anulados y con saldo ≠ 0.
  - El importe tiene el mismo signo que el saldo y |importe| ≤ |saldo − comprometido|.
  - `comprometido` = Σ de las imputaciones del mismo movimiento en OP en estado BORRADOR, PENDIENTE_APROBACION o APROBADA (sin contar la propia).
  - Si se supera, 400 "El importe a cancelar supera el saldo disponible del comprobante (X)".
- **Totales:** los calcula el servidor. `importePesos` = importe × cotización de la OP (ARS: × 1).
  - `totalCancelarPesos` = Σ importePesos de imputaciones + anticipo en pesos.
  - Debe ser mayor a 0: "La orden de pago no tiene importe a pagar".
- **Confirmar:** asigna número (talonario `OP`), calcula retenciones con la fecha de la OP (vista previa) y define la aprobación igual que en la OC: automática si `0 < totalCancelarPesos ≤ montoAprobacionOp`.
- **Aprobar y rechazar:** como en la OC, con `op.aprobar`, la regla de "quien crea no aprueba" (salvo único aprobador), bloqueo optimista por `version` y motivo obligatorio para rechazar.
- **Pagar** (`pago.ejecutar`, solo desde APROBADA), con body `{ version, fechaPago, medios[] }`:
  1. Recalcula las retenciones con `fechaPago`.
  2. Valida que Σ importePesos de medios + totalRetenciones = totalCancelarPesos exacto: si no, 400 "Los medios de pago (X) más las retenciones (Y) no coinciden con el total a cancelar (Z)".
  3. Revalida que las imputaciones no superen el saldo actual (con `FOR UPDATE` sobre los movimientos).
  4. Por cada medio: transferencia y efectivo crean un `MovimientoTesoreria` EGRESO; un cheque crea un `ChequePropio`. En cheques físicos, el número debe estar dentro del rango y no usado, y avanza `proximoNumero`. Un cheque al día (chequeFechaPago ≤ fechaPago de la OP) además crea el `MovimientoTesoreria`; uno diferido no.
  5. Por cada imputación: crea la `AplicacionCuentaCorriente` y baja el `saldo` del movimiento en su moneda y el `saldoPesos` proporcional histórico (importe × saldoPesos/saldo del movimiento antes de aplicar, redondeado; si cancela el total, saldoPesos = 0).
  6. Si hay anticipo: crea un `MovimientoCuentaCorriente` ANTICIPO con importe negativo.
  7. Emite los certificados: un talonario por `RET-GAN` y por `RET-IIBB-<jurisdiccion>`.
  8. Genera el asiento (§5) y queda en estado PAGADA.
- **Anular:**
  - En PENDIENTE_APROBACION o APROBADA, con `op.anular`, pasa a ANULADA sin otros efectos.
  - En PAGADA, con `op.anular` y motivo:
    - Exige que el anticipo, si existe, no tenga aplicaciones.
    - Crea el contraasiento con fecha de hoy (hora argentina).
    - Restaura los saldos (resta las aplicaciones y las marca anuladas).
    - Marca anulados el movimiento de anticipo, los cheques, los movimientos de tesorería y los certificados.
- **Bloqueo optimista** en todas las transiciones. Las de pago bloquean la fila de la OP con `FOR UPDATE`.

## 5. Asiento del pago

Fecha = `fechaPago`, origen `PAGO`. Importes en pesos.

| Debe | Haber |
|---|---|
| PROVEEDORES: Σ importePesosHistorico de imputaciones de comprobantes (las NC restan) | RETENCION_GANANCIAS: total retenido de Ganancias |
| ANTICIPOS_PROVEEDORES: anticipo nuevo en pesos | RETENCION_IIBB: total retenido de IIBB |
| | Cuenta contable de cada cuenta bancaria o caja: transferencias, efectivo y cheques al día |
| | CHEQUES_DIFERIDOS: cheques diferidos |
| | ANTICIPOS_PROVEEDORES: anticipos anteriores que se aplican, a su importe histórico |

**Diferencia de cambio** = Σ importePesos de imputaciones (cotización OP) − Σ importePesosHistorico.
- Si es mayor a 0, va al debe de DIFERENCIA_CAMBIO_NEGATIVA.
- Si es menor a 0, va al haber de DIFERENCIA_CAMBIO_POSITIVA.

El asiento debe balancear por construcción. Si no balancea, la operación se revierte (motor de la Entrega 2).

## 6. Consultas y PDF

- **Órdenes de pago:** lista con filtros (proveedor, estado, fechas) y detalle con imputaciones, retenciones y detalle de cálculo, medios, asiento y certificados.
- **Pagos a realizar:** saldos pendientes por proveedor y vencimiento (por vencer, vencido) y OP aprobadas sin pagar.
- **Retenciones practicadas:** por período, impuesto y jurisdicción. Muestra fecha, certificado, proveedor, CUIT, régimen, base, alícuota e importe, con exportación a Excel. Excluye las anuladas, salvo con filtro.
- **PDF:**
  - de la OP: imputaciones, retenciones, medios y firma;
  - de cada certificado de retención: agente (empresa, CUIT, domicilio), sujeto retenido, impuesto/régimen o jurisdicción, base, alícuota, importe, número de certificado, fecha y número de OP.
- **Cuenta corriente** (Entrega 2): muestra también las OP pagadas y los anticipos como movimientos.

## 7. Web

- **Registraciones › Pagos:** Orden de pago (alta y edición con selección de comprobantes pendientes, importe a cancelar editable y anticipo), Aprobación de OP y Pago de OP (bandeja de aprobadas; formulario de medios con el total a cubrir en vivo y la vista de retenciones recalculadas).
- **Consultas › Pagos:** Órdenes de pago, Pagos a realizar y Retenciones practicadas.
- **Administración:** Retenciones (regímenes de Ganancias, escala y jurisdicciones de IIBB) y Padrones de IIBB (carga y estado).
- **Ficha del proveedor:** campo "Inscripto en Ganancias".

## 8. Errores y concurrencia

- Mensajes en castellano y detalle por campo.
- Transacción única por operación.
- `version` en la OP.
- `FOR UPDATE` en el orden: OP → movimientos de cuenta corriente → chequera.
- Dos pagos simultáneos de la misma OP: solo uno se registra; el otro recibe 409.
- Un padrón con un formato inválido marca la carga en ERROR con la línea fallida y no modifica el padrón vigente.

## 9. Pruebas

- **Puras:**
  - Ganancias: debajo del mínimo; acumulado que lo cruza; descuento de lo ya retenido; mínimo de retención; escala por tramos; no inscripto; exento vigente o vencido; monotributo.
  - IIBB: padrón → ficha → por defecto → no retener; exento; mínimo.
  - Base proporcional con NC y con factura con percepciones.
  - Parsers de ARBA y AGIP: válidos, línea inválida y coma decimal.
- **Integración (API):**
  - circuito completo de OP con aprobación;
  - comprometido entre dos OP;
  - pago combinado (transferencia ARS, cheque diferido, efectivo USD);
  - medios + retenciones ≠ total → error;
  - diferencia de cambio en el asiento;
  - certificados numerados por talonario;
  - anticipo y su aplicación;
  - anulación de una OP pagada;
  - cheque físico fuera de rango o repetido;
  - aislamiento entre empresas;
  - pago concurrente;
  - padrón cargado y usado en el cálculo.
- **E2E:** OP → aprobación (otro usuario) → pago (transferencia + cheque) → certificado → saldo del proveedor en 0.
- **Seed:** regímenes, jurisdicciones, padrón chico de ejemplo, usuario tesorero (`tesorero@demo.com`) y OP en distintos estados.

## 10. Orden de construcción

1. Configuración: monto de OP, conceptos, regímenes, escala, jurisdicciones, `inscriptoGanancias` y permisos.
2. Padrones: parsers y carga en segundo plano.
3. Motor de retenciones (shared) y servicio de datos.
4. OP: borrador, imputaciones, comprometido, confirmación y aprobación.
5. Pago: medios, cheques, tesorería, aplicaciones, anticipos, certificados y asiento.
6. Anulación.
7. Consultas y PDF.
8. Web: OP y aprobación.
9. Web: pago, certificados y consultas.
10. Web: configuración de retenciones y padrones.
11. Seed, e2e y README.
