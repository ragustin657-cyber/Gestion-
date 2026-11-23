# Entrega 50 — Factura de crédito electrónica MiPyME (FCE): emisión y recepción

## 1. Intención
La ley 27.440 obliga a las MiPyMEs a emitir **factura de crédito electrónica (FCE)** en lugar de la factura común cuando le venden a una empresa grande inscripta como obligada a recibirlas y el importe llega al monto mínimo vigente. La empresa grande tiene que **aceptarla o rechazarla** en el Registro de Facturas de Crédito Electrónica de ARCA dentro del plazo; si no hace nada, queda aceptada sola. Hoy el sistema solo emite factura, nota de débito y nota de crédito comunes, y no sabe nada del registro.

Las empresas que usan el sistema pueden estar de los dos lados (decisión del usuario: **las dos cosas**).

**Éxito:**
- Al facturar a un cliente obligado por un importe desde el mínimo, el sistema emite la FCE (código 201, 206 o 211) con sus datos obligatorios, y no deja emitir la factura común por error.
- El vendedor ve el estado de sus FCE emitidas en el registro (pendiente, aceptada, rechazada, aceptada sola) y, si se rechaza, emite la nota de crédito de anulación.
- Quien recibe FCE las ve en el sistema con el plazo que le queda, ve si ya cargó la compra, y las acepta o rechaza desde el sistema sin entrar al sitio de ARCA.
- Las FCE van al Libro IVA Digital con sus códigos propios (ventas y compras).

**No objetivos:** negociar o transferir la FCE (circulación en el mercado de capitales, agentes de depósito, cesión); informar la cancelación (pago) de la FCE en el registro; pedir el certificado MiPyME; presentar nada que no sea por web service.

## 2. Enfoques (elegido por el usuario: el 1)
1. **Elegido: integrado con ARCA en las dos puntas.** Emisión por el web service de factura electrónica (WSFEv1) que ya se usa; consulta del obligado y del monto mínimo, consulta de comprobantes y aceptación/rechazo por el web service del registro de FCE (`wsfecred`), con un cliente real y uno simulado como el de facturación. Si ARCA no responde, se usa el último dato guardado o la marca manual del cliente.
2. Emisión por ARCA y el resto a mano (marca de obligado en el cliente, mínimo en la configuración, aceptación registrada a mano): más chica, pero doble trabajo para quien recibe y la marca puede quedar vieja.
3. Mixta (consulta del obligado por web service, aceptación a mano).

## 3. Configuración (Factura electrónica ARCA)
- **La empresa es MiPyME** (sí/no). Sin la marca no se emite FCE (`La empresa no está marcada como MiPyME: no puede emitir factura de crédito`).
- **Cuenta bancaria para la FCE**: una de las cuentas de la empresa con CBU (se informa el CBU en la FCE). Sin ella: `Configure la cuenta bancaria (CBU) para la factura de crédito`.
- **Opción de transferencia** por defecto: `SCA` (sistema de circulación abierta) o `ADC` (agente de depósito colectivo); por defecto SCA. Se puede cambiar en cada FCE.
- Permiso: `arca.configurar` (el mismo de hoy).

## 4. Emisión
### 4.1 Tipos y numeración
- Los comprobantes de venta tienen una marca **FCE** (`ComprobanteVenta.fce Boolean @default(false)`). Con la marca, el código ARCA es el de FCE: factura 201/206/211, nota de débito 202/207/212, nota de crédito 203/208/213 (A/B/C).
- La numeración de ARCA es propia de cada código: la FCE A no comparte números con la factura A. La unicidad del número y la búsqueda del último autorizado incluyen la marca.
- Todo lo demás (cuenta corriente, asiento, stock, percepciones, comisiones, aplicaciones) funciona igual que con la factura común.

### 4.2 Datos obligatorios que se mandan a ARCA
- **Fecha de vencimiento del pago** (`FchVtoPago`): en la factura FCE es obligatoria para cualquier concepto, y es la fecha de vencimiento del comprobante. *(Decisión mía: se usa el vencimiento que ya tiene el comprobante, así la cuenta corriente y la FCE dicen lo mismo.)* Debe ser igual o posterior a la fecha de emisión.
- **CBU** del emisor (opcional 2101) — solo en la factura.
- **Transferencia** (opcional 27: `SCA` o `ADC`) — solo en la factura.
- **Notas de débito y crédito FCE:** siempre asociadas a una FCE del mismo cliente (`CbtesAsoc` con su CUIT), y con el opcional 22 **anulación**: `S` si anulan la FCE por un rechazo, `N` en los demás casos. Una nota común no puede asociarse a una FCE ni una nota FCE a una factura común (`La nota tiene que ser de la misma clase que la factura: factura de crédito MiPyME o común`).
- Los códigos exactos de los opcionales y los valores van a «Datos a verificar».

### 4.3 ¿Corresponde FCE?
- Al elegir el cliente (y al emitir) el sistema consulta en `wsfecred` si el CUIT del cliente está **obligado a recibir FCE** y el **monto mínimo** a la fecha (operación de consulta de monto obligado). El resultado se guarda en el cliente (`fceObligado`, `fceMontoMinimo`, `fceConsultadoEn`) y vale para el día *(decisión mía: una consulta por cliente y día, para no consultar en cada renglón)*.
- **Corresponde FCE** si: la empresa es MiPyME, el cliente es responsable inscripto o exento con CUIT *(a verificar)*, está obligado, y el total del comprobante en pesos llega al mínimo.
- Si corresponde y se intenta emitir una factura común: error `El cliente está obligado a recibir factura de crédito MiPyME desde $ <mínimo>: emita una factura de crédito`. Si no corresponde y se marca FCE: se permite *(decisión mía: la ley permite emitir FCE voluntariamente a un obligado por debajo del mínimo)*, salvo que el cliente no esté obligado (`El cliente no está obligado a recibir factura de crédito MiPyME`).
- **Sin respuesta de ARCA:** se usa el último dato guardado del cliente, con el aviso `No se pudo consultar ARCA: se usa la consulta del <fecha>`; si nunca se consultó, la **marca manual** del cliente (`fceObligadoManual`, editable en la ficha). La emisión del comprobante sigue el circuito de hoy (queda pendiente de CAE si ARCA no responde).
- En la pantalla de factura, la marca FCE se propone sola cuando corresponde, con el aviso del mínimo.

### 4.4 PDF y libros
- El PDF dice «FACTURA DE CRÉDITO ELECTRÓNICA MiPyMEs (FCE)» (o nota de débito/crédito), con el código ARCA, el CBU, la opción de transferencia y la fecha de vencimiento del pago.
- Libro IVA Digital de ventas: los códigos 201…213.

## 5. Estado de las FCE emitidas
- `FceRegistro` (de empresa): una fila por FCE (emitida o recibida) con: rol (`EMISOR`/`RECEPTOR`), CUIT de la contraparte, tipo ARCA, punto de venta, número, fecha, importe, moneda, fecha de vencimiento del pago, **estado** (`PENDIENTE`, `ACEPTADA`, `RECHAZADA`, `ACEPTADA_TACITA`, a verificar contra los estados del registro), fecha de recepción, fecha límite para aceptar o rechazar, motivos del rechazo, fecha de la última consulta, y el comprobante del sistema (venta o compra) si se emparejó.
- **Actualizar desde ARCA** (botón, y al abrir la pantalla si la última consulta tiene más de una hora): trae los comprobantes del registro como emisor de los últimos 90 días *(decisión mía)* y actualiza los estados.
- Pantalla *Ventas › Facturas de crédito MiPyME*: lista con cliente, comprobante, importe, vencimiento del pago, estado y fecha límite; filtro por estado.
- **Rechazada:** aviso en la lista y botón *Emitir nota de crédito de anulación*, que abre la nota de crédito FCE asociada, por el total, con anulación `S`. Mientras no esté anulada, la FCE rechazada queda marcada.
- Permiso: ver con `venta.ver`; emitir la nota con `venta.emitir`.

## 6. Recepción
- Pantalla *Compras › Facturas de crédito MiPyME recibidas*: *Actualizar desde ARCA* trae las FCE recibidas (rol receptor) de los últimos 90 días con su estado.
- Por cada una: proveedor (por CUIT, con nombre si es un proveedor cargado), comprobante, importe, vencimiento del pago, estado, **días que quedan** para aceptar o rechazar, y si la **compra ya está cargada** (mismo CUIT, tipo base, punto de venta y número; la compra emparejada queda marcada como FCE).
- **Aceptar** y **Rechazar** (con uno o más motivos de la lista del registro y un texto) llaman a `wsfecred`. Solo en estado pendiente y dentro del plazo (`El plazo para aceptar o rechazar venció el <fecha>`). Con la compra no cargada se permite aceptar, con aviso `La compra no está cargada` *(decisión mía: la aceptación tiene plazo legal; la carga puede venir después)*.
- Avisos: las pendientes con 5 días o menos de plazo se muestran resaltadas *(decisión mía)*.
- Cada aceptación o rechazo queda en la auditoría.
- Permiso: ver con `fc.ver`; aceptar o rechazar con `fc.crear` *(decisión mía: es quien carga las facturas de proveedores)*.

## 7. Compras
- El comprobante de compra tiene la marca **FCE** (`ComprobanteCompra.fce`), que se carga a mano o se pone sola al emparejar con una FCE recibida.
- Libro IVA Digital de compras: con la marca, los códigos 201…213.
- El control con «Mis Comprobantes» ya empareja los códigos 201…213 con la factura, nota de débito o crédito equivalente (entrega 8); además, si la fila es FCE y la compra no tiene la marca, avisa `La compra es una factura de crédito MiPyME`.

## 8. Cliente de ARCA para el registro de FCE
- Servicio `wsfecred` con su propio ticket de WSAA (la tabla de tickets ya distingue el servicio), homologación y producción, y un cliente simulado para pruebas y el ambiente SIMULADO.
- Operaciones: consultar monto obligado (CUIT, fecha) → obligado y mínimo; consultar comprobantes (rol, rango de fechas) → lista con estado y plazo; aceptar; rechazar (motivos); consultar motivos de rechazo.
- Errores de conexión como los de hoy (`ErrorConexionArca`): el usuario ve `No se pudo consultar ARCA: <detalle>` y puede reintentar.

## 9. Pantallas
- *Configuración › Factura electrónica ARCA*: MiPyME, cuenta bancaria de la FCE, transferencia por defecto.
- *Ficha del cliente*: obligado a recibir FCE (resultado de la última consulta con su fecha, y la marca manual).
- *Comprobante de venta*: marca FCE (propuesta sola), transferencia, anulación en las notas FCE.
- *Ventas › Facturas de crédito MiPyME* y *Compras › Facturas de crédito MiPyME recibidas*.
- *Comprobante de compra*: marca FCE.

## 10. Fuera de alcance
- Negociación, cesión y circulación de la FCE; agente de depósito colectivo más allá de informar la opción; informar la cancelación (pago) al registro; FCE de exportación; aceptación parcial o con diferencias (si el registro la admite, a verificar).

## 11. Datos a verificar (van a `docs/pendientes.md` §2)
- Diseño del web service `wsfecred` (operaciones, campos, estados, motivos de rechazo) y su URL de homologación y producción.
- Códigos de los opcionales de WSFEv1 para la FCE (CBU 2101, transferencia 27, anulación 22) y si la FCE C y la FCE a exentos llevan los mismos datos.
- Plazo para aceptar o rechazar (30 días corridos desde la recepción) y quiénes pueden recibir FCE (responsables inscriptos; exentos).
- Monto mínimo vigente (lo informa el web service; no se guarda un valor fijo).
