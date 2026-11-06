# Entrega 6 — Ventas básicas y factura electrónica ARCA

## 1. Objetivo y alcance

La empresa emite Facturas, Notas de Crédito y Notas de Débito electrónicas con CAE de ARCA. Las cobra con recibos que reciben valores y retenciones sufridas y los aplica a sus comprobantes. Lleva la cuenta corriente de cada cliente con sus asientos automáticos.

**Criterio de éxito.** En la empresa demo, en modo Simulado, un usuario:
1. emite una factura B a un cliente y obtiene CAE y PDF con QR;
2. la cobra con un recibo con un cheque y una retención;
3. ve la cuenta corriente del cliente en cero y los asientos balanceados.

Con un certificado de homologación cargado, el mismo flujo funciona contra ARCA homologación. La validación en vivo queda para cuando el usuario tenga el certificado.

**Decisiones tomadas con el usuario:**
- **Integración ARCA real completa más un modo Simulado.** El Simulado se usa en las pruebas y en la demo.
- **Impuestos:**
  - las facturas llevan solo IVA;
  - los recibos aceptan retenciones sufridas (IVA, Ganancias, IIBB, SUSS);
  - las percepciones en la factura quedan para más adelante.
- **Moneda:** ARS y USD. El comprobante en USD se informa con su cotización y la diferencia de cambio se registra al cobrar.
- **Renglones:**
  - un renglón es un artículo del maestro o una descripción libre;
  - el concepto ARCA es Productos, Servicios o Productos y Servicios;
  - en Servicios se cargan las fechas del período y el vencimiento del pago.
- **Cobro:**
  - Recibo en un solo paso (valores, retenciones y comprobantes a cancelar);
  - pantalla de Aplicación aparte para saldos a favor existentes.
- **Arquitectura ARCA:**
  - cliente propio (WSAA + WSFEv1) detrás de una interfaz;
  - el CAE se pide al confirmar, fuera de la transacción;
  - un comprobante queda pendiente de CAE si ARCA no responde, con reintento y recuperación.

**Fuera de alcance:**
- percepciones en la factura;
- descuentos y bonificaciones;
- remitos, pedidos y listas de precios;
- control de stock;
- Libro IVA Ventas y régimen de información (Entrega 7);
- factura de crédito electrónica MiPyME;
- factura de exportación (E);
- facturación por lotes;
- validación en vivo contra ARCA en este entorno.

## 2. Configuración

### 2.1 ARCA por empresa

Se crea el modelo `ConfigArca`, uno por empresa:

| Campo | Contenido |
|---|---|
| `ambiente` | `SIMULADO`, `HOMOLOGACION` o `PRODUCCION`. Toda empresa nueva arranca en `SIMULADO`; también las existentes, por la migración. |
| `certificadoCifrado`, `claveCifrada` | El `.crt` (PEM) y la clave privada (PEM), cifrados con AES-256-GCM. La clave se deriva de la variable de entorno `ARCA_CLAVE_MAESTRA` (32 bytes en base64). Se guardan IV y tag junto al texto cifrado. |
| `certificadoSujeto`, `certificadoVence` | Se leen del certificado al cargarlo (CN o serialNumber y la fecha `notAfter`). |

**Validaciones al cargar el certificado:**
- el certificado y la clave tienen que formar un par: se firma un texto de prueba y se verifica la firma;
- el CUIT del certificado (serialNumber `CUIT nnnnnnnnnnn`) debe ser el de la empresa.

**Mensajes de error:**
- "El certificado no corresponde a la clave privada";
- "El certificado es de otro CUIT (20-…)";
- sin `ARCA_CLAVE_MAESTRA` en el servidor, cargar un certificado responde "El servidor no tiene configurada la clave para guardar certificados".

**El token de WSAA** se guarda en `TokenArca`: empresaId, ambiente, servicio `wsfe`, token, sign y vencimiento. Se reutiliza mientras le queden más de 10 minutos. Si no, se hace login de nuevo. El login es un TRA firmado en CMS (PKCS#7 con los datos adjuntos, SHA-256) con `node-forge`, enviado a `LoginCms`.

**Endpoints:**

| Ambiente | WSAA | WSFEv1 |
|---|---|---|
| Homologación | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` |
| Producción | `https://wsaa.afip.gov.ar/ws/services/LoginCms` | `https://servicios1.afip.gov.ar/wsfev1/service.asmx` |

**"Probar conexión":**
- En Homologación o Producción llama a `FEDummy` y hace login. Responde el estado de AppServer, DbServer y AuthServer, o el error.
- En Simulado responde OK sin conectarse.

**Vencimiento del certificado:**
- Con el certificado vencido, la emisión responde "El certificado de ARCA venció el dd/mm/aaaa".
- Si faltan 30 días o menos, la pantalla muestra un aviso.
- Si el ambiente no es Simulado y no hay certificado: "La empresa no tiene certificado de ARCA cargado".

### 2.2 Puntos de venta

A `PuntoVenta` se le agregan:
- `electronico` (booleano, por defecto true);
- `sucursalId`, opcional, que es la sucursal que lo usa.

Solo un punto de venta electrónico emite comprobantes. Los recibos se numeran por punto de venta, sean electrónicos o no.

### 2.3 Clientes

A `Tercero` se le agrega `tipoDocumento`, un enum `CUIT | DNI | OTRO` con valor por defecto `CUIT`.
- El campo `cuit` guarda el número: 11 dígitos con dígito verificador si es CUIT, 7 u 8 dígitos si es DNI, cualquier texto si es OTRO.
- `OTRO` representa al consumidor final sin identificar y se informa a ARCA con DocTipo 99 y DocNro 0.
- La validación de CUIT existente solo se aplica cuando el tipo es CUIT.

### 2.4 Conceptos contables y cuentas

**Cuentas nuevas en el plan modelo**, que la migración crea en las empresas existentes bajo `1.1.03`:
- `1.1.03.005` Retenciones IVA sufridas;
- `1.1.03.006` Retenciones Ganancias sufridas;
- `1.1.03.007` Retenciones IIBB sufridas;
- `1.1.03.008` Retenciones SUSS sufridas.

**Conceptos nuevos** (los tests que cuentan conceptos pasan de 20 a 26):

| Concepto | Cuenta |
|---|---|
| `VENTAS` | 4.1.01 |
| `IVA_DEBITO_FISCAL` | 2.1.02.001 |
| `RETENCION_SUFRIDA_IVA` | 1.1.03.005 |
| `RETENCION_SUFRIDA_GANANCIAS` | 1.1.03.006 |
| `RETENCION_SUFRIDA_IIBB` | 1.1.03.007 |
| `RETENCION_SUFRIDA_SUSS` | 1.1.03.008 |

Si el artículo de un renglón tiene `cuentaVentaId`, ese renglón usa esa cuenta. Si no, usa `VENTAS`.

## 3. Comprobantes de venta

### 3.1 Modelo

**`ComprobanteVenta`:**
- **Datos básicos:**
  - `numeroInterno` (correlativo por empresa);
  - `tipo` (`FACTURA | NOTA_DEBITO | NOTA_CREDITO`), `letra` (`A | B | C`);
  - `puntoVentaId`, `puntoVenta` (número), `numero` (nulo hasta tener CAE);
  - `terceroId`.
- **Fechas:**
  - `fecha` es la fecha de emisión. Es también la fecha contable y debe estar en un período abierto.
  - `fechaVencimiento` es el vencimiento del pago, para la cuenta corriente.
  - En Servicios: `fechaServicioDesde`, `fechaServicioHasta` y `fechaVencimientoPago`.
- **Concepto:** `concepto` es `PRODUCTOS | SERVICIOS | PRODUCTOS_Y_SERVICIOS` (ARCA 1, 2 y 3).
- **Importes:**
  - `monedaCodigo` y `cotizacion` (1 si es ARS);
  - `netoGravado`, `noGravado`, `exento`, `iva`, `total`, `totalPesos`.
- **Estado y ARCA:**
  - `estado`: `PENDIENTE_CAE | AUTORIZADO | RECHAZADO`;
  - `emisionEnCurso`, que es la fecha y hora de la reserva o nulo;
  - `numeroReservado`, el número pedido en el último intento;
  - `cae`, `caeVencimiento`, `ultimoError`, `intentos`.
- **Relaciones:** `comprobanteAsociadoId` (NC y ND), `asientoId`.
- **Auditoría:** `creadoPor`, `creadoEn`, `version`.
- **Índices únicos:** (`empresaId`, `numeroInterno`), y (`empresaId`, `puntoVenta`, `tipo`, `letra`, `numero`) para los que tienen número.

**`ComprobanteVentaRenglon`:**
- `articuloId` opcional, `descripcion`, `cantidad` (18,4), `precioUnitario` (18,4);
- `alicuotaIva` (0, 2.5, 5, 10.5, 21 o 27; o los valores especiales `NO_GRAVADO` y `EXENTO`);
- `neto`, `iva`, `cuentaContableId`.

**`ComprobanteVentaIva`:** alícuota, base e importe. Se agrupa por alícuota y es lo que se informa a ARCA.

**Comprobantes C:** no discriminan IVA. Los renglones llevan el precio final, y se informa ImpNeto = total con ImpIVA = 0, sin el bloque de IVA.

### 3.2 Letra y tipo ARCA

La función `letraVenta(condicionEmpresa, condicionCliente)` va en `packages/shared`:
- **Empresa RESPONSABLE_INSCRIPTO:**
  - **A** si el cliente es RESPONSABLE_INSCRIPTO o MONOTRIBUTO;
  - **B** si es EXENTO, CONSUMIDOR_FINAL o NO_RESPONSABLE.
- **Empresa MONOTRIBUTO o EXENTO:** **C** para todos.
- **Otra condición:** error "La condición de IVA de la empresa no permite emitir comprobantes".

**Restricciones:**
- **Factura A:** exige un cliente con tipo de documento CUIT. Si no lo tiene: "El cliente no tiene CUIT válido para una factura A".
- **NC y ND:** llevan la letra de su comprobante asociado.

**Códigos ARCA (CbteTipo):**

| | A | B | C |
|---|---|---|---|
| Factura | 1 | 6 | 11 |
| Nota de Débito | 2 | 7 | 12 |
| Nota de Crédito | 3 | 8 | 13 |

**Condición IVA del receptor (RG 5616):**

| Condición | Código |
|---|---|
| RESPONSABLE_INSCRIPTO | 1 |
| EXENTO | 4 |
| CONSUMIDOR_FINAL | 5 |
| MONOTRIBUTO | 6 |
| NO_RESPONSABLE | 15 |

El 15 (IVA No Alcanzado) está marcado en el código para que el contador lo verifique.

**Otros códigos:**
- Alícuotas: 0% = 3, 2,5% = 9, 5% = 8, 10,5% = 4, 21% = 5, 27% = 6.
- DocTipo: CUIT = 80, DNI = 96, OTRO = 99.
- Moneda: ARS = `PES`, USD = `DOL`.

### 3.3 Cálculo

`calcularVenta(renglones, letra)` va en `packages/shared`:
- **Neto del renglón:** cantidad × precio, redondeado a 2 decimales.
- **IVA por alícuota:** se calcula sobre la base sumada de esa alícuota, redondeado a 2. No es la suma de los IVA de cada renglón, y así se evita la diferencia de centavos con ARCA. El IVA de cada renglón es solo informativo.
- **Total:** neto gravado + no gravado + exento + IVA.
- **Letra C:** no se separa el IVA (ver 3.1).

### 3.4 Alta, edición y eliminación

**Alta** (`POST /api/ventas/comprobantes`):
- crea el comprobante en `PENDIENTE_CAE`, con número nulo, sin cuenta corriente ni asiento;
- el `numeroInterno` se toma de un `Talonario` interno;
- con `emitir: true`, a continuación ejecuta la emisión (3.5).

**Validaciones:**
- cliente activo con `esCliente`;
- punto de venta electrónico;
- al menos un renglón con cantidad > 0 y precio > 0;
- en Servicios, las tres fechas del servicio, con desde ≤ hasta;
- moneda ARS o USD; en USD, la cotización es obligatoria (se propone la del día);
- NC y ND: asociado obligatorio, AUTORIZADO, del mismo cliente, con la misma letra y la misma moneda;
- una NC no puede superar el saldo pendiente del asociado más lo que ya se le aplicó desde otras NC autorizadas. Si lo supera: "La nota de crédito supera el saldo de la factura 0001-00000012".

**Edición y eliminación:**
- se permiten mientras el estado sea `PENDIENTE_CAE` o `RECHAZADO` y no haya una emisión en curso;
- la edición lleva control optimista por `version`;
- un comprobante con número asignado alguna vez por ARCA no existe: un `AUTORIZADO` no se edita, no se elimina y no se anula. Se corrige con una NC. Mensaje: "Un comprobante autorizado no se anula: emita una nota de crédito";
- un comprobante con `numeroReservado` (que pudo autorizarse sin respuesta) no se elimina hasta un reintento que lo resuelva. Mensaje: "El comprobante tiene una emisión sin confirmar: reintente para resolverla".

### 3.5 Emisión

`POST /api/ventas/comprobantes/:id/emitir`. El servicio `EmisionService.emitir(id)` tiene tres pasos.

**Paso 1: reserva, en una transacción.**
- Bloquea el comprobante y el `Talonario` ARCA del par (punto de venta, CbteTipo), de clave `ARCA-<CbteTipo>`.
- El comprobante debe estar en `PENDIENTE_CAE` o `RECHAZADO`.
- Si otro comprobante del mismo talonario tiene `emisionEnCurso` de hace menos de 2 minutos, responde 409: "Hay otra emisión en curso para este punto de venta, reintente en unos segundos".
- Verifica que la fecha esté en un período abierto, con `periodoAbierto` de la Entrega 5.
- Marca `emisionEnCurso = ahora` y suma 1 a `intentos`.
- Sale de la transacción.
- La reserva de 2 minutos serializa las emisiones por talonario sin mantener una transacción abierta durante la llamada a ARCA.

**Paso 2: ARCA, fuera de la transacción.** Por la interfaz `ClienteArca`:
1. `ultimoAutorizado(ptoVta, cbteTipo)` devuelve N.
2. **Recuperación.** Si hay `numeroReservado` y es ≤ N (pudo haberse autorizado y después otros emitieron más números):
   - se consulta `consultar(ptoVta, cbteTipo, numeroReservado)`;
   - si coinciden documento del receptor, fecha, total y moneda, se adopta su CAE y se va al paso 3 como aprobado;
   - si no coincide, ese número lo usó otro sistema y se sigue con el punto 3. El caso queda auditado.
3. Se guarda `numeroReservado = N + 1` en una escritura corta, antes de pedir el CAE.
4. `solicitarCae(datos)` hace `FECAESolicitar` con CantReg 1 y CbteDesde = CbteHasta = N + 1. Envía:
   - DocTipo y DocNro; `CondicionIVAReceptorId`; CbteFch;
   - ImpTotal, ImpTotConc (no gravado), ImpNeto, ImpOpEx (exento), ImpIVA, ImpTrib = 0;
   - MonId, MonCotiz y `CanMisMonExt = 'N'`;
   - FchServDesde, FchServHasta y FchVtoPago si el concepto es 2 o 3;
   - `Iva[]` (excepto C), y `CbtesAsoc[]` en NC y ND, con tipo, punto de venta, número, CUIT emisor y fecha.

**Paso 3: resultado, en una transacción.**

| Resultado de ARCA | Qué se hace |
|---|---|
| Aprobado (`A`) | Bloquea el comprobante. Guarda número = N + 1, CAE, vencimiento del CAE y estado `AUTORIZADO`. Limpia `emisionEnCurso`, `numeroReservado` y `ultimoError`. Genera el movimiento de cuenta corriente (3.6) y el asiento (6.1). Audita. |
| Rechazado (`R`) | Estado `RECHAZADO`, `ultimoError` = errores y observaciones con código y texto. Limpia `emisionEnCurso` y `numeroReservado`, porque ARCA no consumió el número. Responde 400 "ARCA rechazó el comprobante: (código) texto". |
| Error de red, timeout (30 s) o respuesta ilegible | Queda `PENDIENTE_CAE` con `ultimoError` = "No se pudo conectar con ARCA: …". Limpia `emisionEnCurso` pero **conserva `numeroReservado`**, para que el reintento pase por la recuperación. Responde 502 con el mensaje "No se pudo conectar con ARCA: el comprobante quedó pendiente de CAE". |
| Errores de WSAA (login) o certificado | Igual que un error de red, con su mensaje. |

**Reintento:** es el mismo endpoint `emitir`.

**Período cerrado:** si el período se cerró entre el paso 1 y el 3 y ARCA aprobó, el comprobante se autoriza igual y el asiento se fecha el primer día del primer período abierto siguiente. Se registra una advertencia en la respuesta y en la auditoría. ARCA ya lo autorizó y no se puede deshacer.

### 3.6 Cuenta corriente

Al autorizar se crea un `MovimientoCuentaCorriente` con origenTipo `VENTA`, origenId = comprobante, fecha, fechaVencimiento y moneda:
- **Factura y ND:** importe positivo (el cliente debe).
- **NC:** importe negativo (saldo a favor).
- Saldo inicial = importe, en la moneda y en pesos.

La NC no se aplica sola: se aplica con la pantalla de Aplicación (5). Si al crearla se marca "Aplicar a la factura asociada", que viene marcado por defecto, la aplicación se hace en el mismo paso 3.

### 3.7 PDF

`GET /api/ventas/comprobantes/:id/pdf`, solo para AUTORIZADO, generado con pdfkit.
- **Encabezado:** letra en un recuadro con su código ARCA, "ORIGINAL", razón social, CUIT, condición IVA y domicilio de la empresa, punto de venta-número y fecha.
- **Cliente:** datos y condición de venta.
- **Servicios:** período facturado y vencimiento del pago.
- **Renglones e importes:**
  - en A se discrimina neto e IVA por alícuota;
  - en B y C se muestra el precio final;
  - en USD, la cotización.
- **Pie:** CAE, vencimiento del CAE y el QR de ARCA.
- **Contenido del QR:** `https://www.afip.gob.ar/fe/qr/?p=` + base64 del JSON con estos campos:
  ```
  {ver: 1, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda, ctz,
   tipoDocRec, nroDocRec, tipoCodAut: "E", codAut}
  ```
  Se genera con la librería `qrcode`, que es una dependencia nueva.
- Si el ambiente es Simulado u Homologación, lleva la leyenda **"SIN VALIDEZ FISCAL"** cruzada en la hoja.

### 3.8 Cliente ARCA

`ClienteArca` es una interfaz con estos métodos:
- `ultimoAutorizado`;
- `consultar`;
- `solicitarCae`;
- `probar`.

La implementación se elige por el `ambiente` de la empresa.

**`ArcaSimulado`:**
- **Estado:** lleva en la tabla `ArcaSimuladoComprobante` (empresa, ptoVta, cbteTipo, número, CAE, datos) los comprobantes autorizados, así la numeración sobrevive a reinicios.
- **Respuestas normales:**
  - CAE de 14 dígitos;
  - vencimiento a 10 días;
  - número correlativo, que debe ser exactamente el siguiente o rechaza con 10016.
- **Validaciones como ARCA:**
  - ImpTotal ≠ suma de importes → 10048;
  - NC o ND sin asociado → 10197;
  - suma del IVA distinta del ImpIVA → 10018.
- **Modo de falla** para las pruebas (`forzarFalla`, solo con `NODE_ENV=test`):
  - `RECHAZO`;
  - `SIN_CONEXION`;
  - `AUTORIZA_SIN_RESPONDER`: registra el comprobante y después lanza un error de red.

**`ArcaReal`:**
- arma los mensajes SOAP como texto y los lee con `fast-xml-parser`, que es una dependencia nueva;
- usa `fetch` nativo con un timeout de 30 s;
- las respuestas con `Errors` a nivel de servicio (por ejemplo, 600 por token vencido) se tratan como error de login: se borra el token y se reintenta una vez.

## 4. Recibos

### 4.1 Modelo

**`Recibo`:**
- `puntoVentaId`, `numero` (talonario `RECIBO` por punto de venta);
- `terceroId`, `fecha`, `sucursalId`, `cajaId`;
- `ingresoId` (el `IngresoValores` creado), `totalValores`, `totalRetenciones`, `total` (todo en pesos);
- `estado` (`CONFIRMADO | ANULADO`), `asientoId`, `asientoAnulacionId`, `motivoAnulacion`;
- `creadoPor`, `creadoEn`.

**`ReciboRetencion`:**
- `tipo` (`IVA | GANANCIAS | IIBB | SUSS`), `jurisdiccion` (solo IIBB);
- `numeroCertificado`, `fecha`, `importe`.

### 4.2 Alta

`POST /api/ventas/recibos` recibe:
- cliente, fecha, punto de venta, caja;
- valores con la misma forma que el ingreso de Tesorería: `efectivo[]`, `cheques[]`, `transferencias[]`;
- `retenciones[]`;
- `aplicaciones[]` con comprobanteId e importe en la moneda del comprobante.

**Valores:**
- Se crean llamando a la lógica del ingreso de Tesorería, extraída como `IngresosService.crearEnTx(tx, datos, opciones)`, con origen CLIENTE.
- Las opciones indican que **no genere su asiento ni su movimiento de cuenta corriente**: el recibo hace el asiento único y el movimiento.
- Los cheques quedan en cartera con su sucursal, como en 4A.

**Movimiento de cuenta corriente:** origenTipo `RECIBO`, importe = −(valores + retenciones) en pesos y en ARS. El recibo es siempre en pesos. Un cobro en USD en efectivo o por transferencia en USD se convierte a pesos a la cotización del día, con la regla de 4A.

**Aplicaciones:** se registran contra los comprobantes indicados (ver 5.2).
- Lo aplicado, convertido a pesos a la cotización del día, no puede superar el total del recibo: "Lo aplicado supera el total del recibo".
- Lo que no se aplica queda como saldo a favor en el movimiento del recibo.

**Validaciones:**
- total > 0;
- retenciones con importe > 0, número de certificado no vacío, y jurisdicción si son de IIBB;
- cliente con `esCliente`;
- aplicaciones a comprobantes AUTORIZADOS del mismo cliente, factura o ND, con saldo suficiente: "El comprobante 0001-00000012 tiene saldo 1.000,00".

### 4.3 Anulación

`POST /api/ventas/recibos/:id/anular` recibe `{ motivo }`:
- revierte sus aplicaciones (5.3);
- anula el ingreso de valores con las reglas de 4A (los cheques deben seguir en cartera, las transferencias no conciliadas, etc.), con los mensajes de 4A;
- deja el movimiento de cuenta corriente anulado;
- genera el contraasiento.

**Restricción:** no se puede anular si el saldo a favor del recibo ya se usó en una Aplicación posterior. Mensaje: "El saldo del recibo fue aplicado: deshaga primero la aplicación".

## 5. Aplicación

### 5.1 Modelo

**`AplicacionCobro`:**
- `numero` (por empresa), `terceroId`, `fecha`;
- `origenTipo` (`RECIBO | APLICACION | VENTA`) y `origenId`: el documento que la creó (`VENTA` es la NC aplicada al autorizarse);
- `creditoMovId` (movimiento con saldo negativo: recibo, cobro de Tesorería o NC);
- `debitoMovId` (factura o ND);
- `importe` (en la moneda del débito), `importePesosCredito`, `importePesosDebito`, `diferenciaCambio`;
- `anulada`.

### 5.2 Reglas de aplicación

**Monedas:**
- **Débito en ARS:** el crédito debe ser en ARS. Se aplican pesos contra pesos y no hay diferencia de cambio.
- **Débito en USD, crédito en USD** (una NC en USD): se aplica en USD.
  - Los pesos del crédito se toman proporcionales de su saldo en pesos, y lo mismo los del débito.
  - La diferencia, si la hay, es diferencia de cambio.
- **Débito en USD, crédito en ARS** (el caso común: se cobra en pesos):
  - el importe aplicado se expresa en USD;
  - los pesos que consume del crédito = importe × cotización del día de la aplicación (Cotizaciones de Entrega 2; si no hay: "No hay cotización USD para el dd/mm/aaaa");
  - los pesos que cancela del débito = proporción del saldo en pesos del débito.

**Diferencia de cambio:** diferencia = pesos del crédito − pesos del débito.
- **Positiva** (se cobraron más pesos): DIFERENCIA_CAMBIO_POSITIVA al haber.
- **Negativa:** DIFERENCIA_CAMBIO_NEGATIVA al debe.
- La contrapartida es Deudores por ventas. Va en el asiento del recibo o en un asiento propio de la Aplicación.

**Saldos:**
- se descuentan del `saldo` y del `saldoPesos` de ambos movimientos, bloqueados con `bloquear` en orden de id;
- un saldo nunca cambia de signo: "El importe supera el saldo disponible".

**Pantalla de Aplicación** (`POST /api/ventas/aplicaciones`):
- recibe cliente, fecha, `items[]` (créditoMovId, débitoMovId, importe);
- todos los movimientos deben ser del cliente y no estar anulados;
- un cobro de Tesorería (origenTipo `COBRO`) sirve como crédito.

### 5.3 Deshacer

`POST /api/ventas/aplicaciones/:id/anular`:
- restituye los saldos de ambos movimientos;
- marca la aplicación como anulada;
- si tuvo diferencia de cambio, genera el contraasiento;
- el control de período lo hace `AsientosService`.

## 6. Contabilidad

### 6.1 Asientos

Todos van por `AsientosService.generar`, que ya controla el período abierto.

| Operación | origenTipo | Debe | Haber |
|---|---|---|---|
| Factura o ND | `VENTA` | DEUDORES_POR_VENTAS (totalPesos) | Cuenta de ventas de cada renglón (neto en pesos); IVA_DEBITO_FISCAL (IVA en pesos) |
| NC | `VENTA` | Lo inverso | Lo inverso |
| Recibo | `RECIBO` | Por cada valor, la cuenta que usa el ingreso de 4A (caja, valores a depositar, transferencias a acreditar, etc.); RETENCION_SUFRIDA_x por cada retención; DIFERENCIA_CAMBIO_NEGATIVA si corresponde | DEUDORES_POR_VENTAS (valores + retenciones); DIFERENCIA_CAMBIO_POSITIVA si corresponde. La diferencia de cambio se compensa contra DEUDORES_POR_VENTAS. |
| Aplicación con diferencia de cambio | `APLICACION_COBRO` | DEUDORES_POR_VENTAS o DIFERENCIA_CAMBIO_NEGATIVA | DIFERENCIA_CAMBIO_POSITIVA o DEUDORES_POR_VENTAS |

**Redondeo:**
- en USD, los pesos de cada renglón se redondean a 2 decimales;
- la diferencia de redondeo contra totalPesos se ajusta en el renglón de mayor importe, para que el asiento siempre balancee.

### 6.2 Origen en el Diario

`rutaOrigen` de la Entrega 5 agrega estos orígenes:
- `VENTA` → `/ventas/comprobantes?id=`;
- `RECIBO` → `/ventas/recibos?id=`;
- `APLICACION_COBRO` → `/ventas/aplicaciones?id=`.

## 7. Consultas

| Consulta | Endpoint | Contenido |
|---|---|---|
| Comprobantes | `GET /api/ventas/comprobantes` | Filtros: cliente, fechas, tipo, estado, punto de venta. Muestra estado, CAE y saldo. |
| Recibos | `GET /api/ventas/recibos` | Filtros: cliente, fechas, estado. |
| Cuenta corriente | `GET /api/ventas/clientes/:id/cuenta-corriente?desde&hasta` | Saldo anterior, movimientos con saldo acumulado (en pesos y, si hay, en USD), y comprobantes pendientes con días de vencido. |
| Saldos de clientes | `GET /api/ventas/saldos` | Saldo por cliente y antigüedad: no vencido, 1–30, 31–60, 61–90, más de 90 días. |

## 8. Permisos y pantallas

**Permisos nuevos** en `packages/shared/permisos.ts`, con migración que se los da al rol Administrador:
- `venta.emitir`;
- `cobro.registrar`;
- `venta.ver`;
- `arca.configurar`.

El seed crea el rol "Facturación" con `venta.emitir`, `cobro.registrar` y `venta.ver`, y el usuario `facturacion@demo.com` con clave `facturacion1234`.

**Menú Ventas:**
- **Registraciones:** Comprobante de venta, Recibo, Aplicación.
- **Consultas:** Comprobantes, Recibos, Cuenta corriente, Saldos de clientes.
- **Configuración:** ARCA, Puntos de venta.

**Pantallas** (en `apps/web/src/ventas/`):
- **Comprobante de venta:**
  - la letra se muestra al elegir el cliente;
  - grilla de renglones con buscador de artículos o texto libre;
  - totales en vivo con `calcularVenta`;
  - botones Guardar y Emitir;
  - en pendiente o rechazado, se muestra el error de ARCA con Reintentar.
- **Recibo:** valores con los mismos componentes de Tesorería, retenciones y grilla de comprobantes pendientes con "Aplicar automático" (las más viejas primero).
- **Aplicación:** créditos y débitos del cliente, y los importes.
- **Configuración ARCA:** ambiente, carga de `.crt` y `.key`, datos del certificado, aviso de vencimiento y Probar conexión.

## 9. Datos de demo

La empresa demo:
- queda en modo `SIMULADO`;
- tiene el punto de venta 0002 electrónico;
- tiene el cliente "Distribuidora Norte SA" (RI) y "Consumidor Final" (OTRO);
- tiene una factura A de servicios emitida y cobrada parcialmente con recibo.

## 10. Pruebas

**Unitarias (shared y api):**
- `letraVenta`, con todas las combinaciones;
- `calcularVenta`: mezcla de alícuotas, redondeo por alícuota, C, no gravado y exento;
- mapeos a códigos ARCA;
- armado del XML de `FECAESolicitar` con asociados y servicios;
- lectura de respuestas aprobada, rechazada, con observaciones y con errores, a partir de ejemplos fijos;
- TRA y CMS: se firma con un certificado autofirmado generado en la prueba y se verifica la firma;
- cifrado y descifrado del certificado; detección de par certificado–clave que no coincide;
- QR: el JSON y la URL.

**Integración (PostgreSQL más `ArcaSimulado`):**
- **Emisión:**
  - factura A y B en ARS con CAE, número, cuenta corriente y asiento balanceado;
  - factura en USD;
  - NC parcial aplicada a su factura; ND.
- **Fallas y recuperación:**
  - rechazo → corrección → emisión;
  - `SIN_CONEXION` → pendiente → reintento OK;
  - `AUTORIZA_SIN_RESPONDER` → reintento que adopta el CAE sin duplicar número.
- **Concurrencia:** dos emisiones simultáneas del mismo talonario dan una OK y otra 409, o números correlativos sin huecos; nunca duplicados.
- **Validaciones:** NC que supera el saldo, factura A a cliente sin CUIT, edición de un autorizado, período cerrado.
- **Recibos y aplicación:**
  - recibo con efectivo, cheque, transferencia y dos retenciones, aplicación parcial y saldo a cuenta;
  - aplicación del saldo a cuenta y de un cobro de Tesorería;
  - diferencia de cambio positiva y negativa;
  - anulación de recibo, con sus bloqueos (cheque depositado, saldo aplicado);
  - deshacer una aplicación.
- **Otros:** consultas y antigüedad; aislamiento entre empresas.

**Punta a punta (Playwright):**
1. la empresa demo emite una factura B a Consumidor Final en modo Simulado;
2. se ve el CAE y se descarga el PDF;
3. se registra un recibo con un cheque y una retención IIBB que cancela la factura;
4. la cuenta corriente queda en cero.

## 11. Revisión: casos a vigilar

1. ARCA autoriza pero la respuesta no llega: el reintento nunca emite un segundo comprobante por la misma venta.
2. Dos usuarios emiten a la vez en el mismo punto de venta: nunca se pide un número que ARCA ya asignó.
3. Comprobantes en USD: los pesos de la cuenta corriente, del asiento y de la diferencia de cambio cierran al centavo.
4. Un recibo anulado o una aplicación deshecha restituyen exactamente los saldos, aun después de otras aplicaciones parciales.
5. Un certificado vencido, ajeno o con la clave equivocada da un mensaje claro y nunca deja un comprobante con número sin CAE.
