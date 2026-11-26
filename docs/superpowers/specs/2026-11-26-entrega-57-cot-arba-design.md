# Entrega 57 — COT de ARBA (diseño)

## Intención
ARBA exige un **Código de Operación de Traslado (COT)** para trasladar mercadería con origen o destino en la provincia de Buenos Aires; el remito que viaja lo lleva impreso. Hoy los remitos no tienen datos del traslado. La entrega 57 agrega esos datos y **pide el COT a ARBA automáticamente** (web service con CUIT y clave CIT), lo guarda e imprime en el PDF del remito; si ARBA no responde, se puede descargar el archivo y subirlo a mano.

Ítem 18 de `docs/pendientes.md` (sección 1.2).

## Objetivos
- Datos del traslado en el remito de entrega (y de devolución): domicilio de destino, transportista, patente, fecha y hora de salida, importe.
- Domicilio de origen en los depósitos; domicilio de entrega en los clientes (propuesto en el remito); maestro de transportistas; código del nomenclador y unidad de medida ARBA en los artículos.
- Pedido del COT a ARBA por web service, con un botón *Pedir COT* en el remito y, si se activa, automático al confirmarlo.
- COT en el remito, impreso en el PDF; descarga del archivo TXT para subirlo a mano y carga manual del COT.
- Ambiente SIMULADO (por defecto) y pruebas sin ARBA real, como ARCA.

## No objetivos
- Hoja de ruta: varios remitos en un mismo pedido (queda para otra entrega).
- Modificación del COT (cambio de destino o vehículo) y anulación del COT en ARBA (se informa por la web de ARBA; el sistema solo registra la anulación local).
- COT de otras provincias.
- Facturas que trasladan sin remito.

## Anti-objetivos
- Guardar la clave CIT en texto plano.
- Que un ARBA caído impida confirmar el remito: el remito se confirma igual y el COT queda pendiente.

## Enfoques
- Por web service (elegido por el usuario) vs archivo para subir a mano: el web service evita el paso manual; el archivo queda como respaldo.
- **A (elegido): un COT por remito** con los datos del traslado en el remito. B (hoja de ruta, varios remitos por envío) se descartó para esta entrega por el paso nuevo de armar el viaje.

## Diseño

### 1. Configuración
`ConfigImpuestos` (o un `ConfigCot` propio, a elección del constructor) con: `cotActivo` (bool), `cotAmbiente` (`SIMULADO | PRUEBA | PRODUCCION`, por defecto SIMULADO), `cotUsuario` (CUIT, por defecto el de la empresa), `cotClaveCifrada` (CIT, cifrada con `arca/cifrado.ts`; nunca se devuelve, solo `tieneClave`), `cotPedirAlConfirmar` (bool). Pantalla en *Impuestos → Configuración* (sección *COT de ARBA*), permiso de configuración de impuestos existente.

### 2. Datos maestros
- **Depósito**: `calle`, `numero`, `codigoPostal`, `localidad`, `provincia` (código de provincia ARBA, 1 letra de la tabla de ARBA; *Buenos Aires = B*), `plantaArba` (número de planta) y `puertaArba` (número de puerta) del domicilio inscripto en ARBA.
- **Cliente** (`Tercero`): domicilio de entrega `entregaCalle`, `entregaNumero`, `entregaCodigoPostal`, `entregaLocalidad`, `entregaProvincia` (letra de ARBA). El remito los propone; si están vacíos, se cargan en el remito. *(Decisión mía: el domicilio fiscal es texto libre y no sirve para el archivo; no se usa.)*
- **Transportista** (nuevo maestro `Transportista { cuit, razonSocial, patentePorDefecto?, activo }`), ABM en Maestros con `tercero.ver`/`tercero.editar` *(decisión mía: mismos permisos que terceros)*.
- **Artículo**: `codigoNomencladorArba` (código del nomenclador COT de ARBA, 6 dígitos) y `unidadMedidaArba` (código de la tabla de unidades de ARBA, p. ej. `1` kilogramos, `7` unidades). Artículos de servicio no viajan.

### 3. Datos del traslado en el remito
Los datos del traslado se cargan **en el alta del remito** (los remitos nacen confirmados) y se editan después con `PUT /api/ventas/remitos/:id/traslado` (`pedido.gestionar`) mientras el COT no esté OTORGADO. *(Decisión mía.)*

`Remito`: `trasladoCalle`, `trasladoNumero`, `trasladoCodigoPostal`, `trasladoLocalidad`, `trasladoProvincia` (propuestos del cliente), `transportistaId?` (vacío = transporte propio con el CUIT de la empresa), `patente`, `patenteAcoplado?`, `fechaSalida` (por defecto la del remito), `horaSalida` (`HHMM`, por defecto la hora de confirmación), `importeDeclarado` (valor de la mercadería **sin IVA** en pesos: por defecto Σ cantidad × precio × (1 − bonificación) del renglón de pedido; sin pedido, el precio sugerido de la lista del cliente en pesos; en la devolución, el del renglón de remito de origen con el mismo criterio; editable) *(decisión mía)*, y el resultado: `cot String?`, `cotEstado (SIN_PEDIR | PENDIENTE | OTORGADO | RECHAZADO | NO_CORRESPONDE)?` (null en los remitos anteriores y cuando la empresa no tiene el COT activo: la columna muestra «—»), `cotMensaje String?`, `cotPedidoEn DateTime?`.
- No corresponde COT (`NO_CORRESPONDE`) si ni el origen ni el destino están en la provincia B. Se calcula al crear el remito (con el COT activo) y **cada vez que se editan los datos del traslado**; editar un remito RECHAZADO o NO_CORRESPONDE lo vuelve a SIN_PEDIR si ahora corresponde. *(Decisión mía.)*
- Faltar datos (patente, nomenclador, domicilio) **no bloquea** el alta del remito: queda SIN_PEDIR y las validaciones del §4 se aplican al pedir el COT. *(Decisión mía.)*
- **Remito de devolución**: el traslado va del cliente al depósito: el domicilio del traslado es el **origen** (propuesto del domicilio de entrega del cliente), el depósito es el **destino** y el destinatario es la propia empresa; el emisor del archivo sigue siendo la empresa. *(Decisión mía.)*

### 4. Pedido del COT
- Cliente `ClienteCot` con dos implementaciones: `ArbaCotReal` (HTTPS POST multipart a `https://cot.arba.gov.ar/TransporteBienes/SeguridadCliente/presentarRemitos.do` en PRODUCCION y `https://cot.test.arba.gov.ar/...` en PRUEBA, campos `user`, `password`, `file`) y `ArbaCotSimulado` (en memoria, otorga un COT de 16 dígitos; fallas forzables en pruebas: `RECHAZO`, `SIN_CONEXION`, como `ArcaSimulado.forzarFalla`).
- **Archivo** (`TB_<CUIT>_<planta 6><puerta 3>_<AAAAMMDD>_<secuencia 6>.txt`, campos separados por `|`, según el diseño de registro del COT de ARBA): registro `01` (cabecera con el CUIT), un `02` por remito (fecha de emisión, código único = tipo de comprobante remito R + punto de venta + número, fecha y hora de salida, destinatario: tipo y número de documento, razón social, domicilio de destino; origen: CUIT, razón social, domicilio del depósito; CUIT del transportista; patentes; importe), un `03` por renglón con artículo (unidad ARBA, cantidad, código del nomenclador, descripción) y `04` (pie con la cantidad de remitos). El constructor toma el detalle de cada campo del instructivo de ARBA y deja en `docs/pendientes.md` los puntos a validar contra el instructivo vigente.
- **Validación antes de enviar** (mensajes exactos):
  - `El depósito no tiene el domicilio de ARBA completo (planta, puerta y domicilio)`
  - `Falta el domicilio de destino del traslado`
  - `El artículo <código> no tiene código del nomenclador de ARBA`
  - `Falta la patente del vehículo`
  - `Configure el usuario y la clave CIT de ARBA`
- **Respuesta**: COT otorgado → `cot`, `OTORGADO`; errores de validación de ARBA → `RECHAZADO` con los mensajes; sin conexión → `PENDIENTE` con `No se pudo conectar con ARBA: el COT quedó pendiente` (reintento con el mismo botón).
- `POST /api/ventas/remitos/:id/cot` (pedir o reintentar, `pedido.gestionar`), `GET /api/ventas/remitos/:id/cot/archivo` (TXT), `PUT /api/ventas/remitos/:id/cot` `{ cot }` (carga manual tras subirlo a mano: 16 dígitos → `OTORGADO`).
- Al crear el remito con `cotPedirAlConfirmar` y el COT correspondiendo: se pide fuera de la transacción del remito; un error (de validación o de ARBA) deja el remito creado con el estado y el mensaje del COT. *(Decisión mía.)*
- Anular un remito con COT otorgado: se anula igual y se avisa `Anule también el COT <número> en la web de ARBA`.

### 5. Pantallas
- Remito (entrega y devolución): sección *Traslado* (destino propuesto del cliente, transportista o *Transporte propio*, patente, acoplado, salida, importe); en la consulta de remitos, columna *COT* (número o estado) y en el detalle botones *Pedir COT*, *Descargar archivo COT*, *Cargar COT*.
- Depósitos, clientes y artículos: los campos nuevos.
- Maestros → *Transportistas*.
- PDF del remito: recuadro `COT N° <número>` cuando está otorgado.

## Restricciones
- Clave CIT cifrada con el mismo mecanismo que el certificado de ARCA; jamás en respuestas ni en auditoría.
- Ambiente SIMULADO por defecto; las pruebas nunca llaman a ARBA.
- Modelos nuevos en `MODELOS_DE_EMPRESA`; enums en su propia migración.

## Lo que queda al constructor
- Dónde vive la configuración (sección de `ConfigImpuestos` o modelo propio).
- Detalle de los campos de cada registro del archivo según el instructivo de ARBA; la tabla de provincias y unidades.
- Parseo de la respuesta XML de ARBA.
