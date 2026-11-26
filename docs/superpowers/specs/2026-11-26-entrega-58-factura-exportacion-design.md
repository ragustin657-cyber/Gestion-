# Entrega 58 — Factura de exportación (E) por WSFEX (diseño)

## Intención
Exportar bienes y servicios exige comprobantes clase **E** autorizados por el web service de exportación de ARCA (**WSFEX**), distinto del WSFEv1 que usa el sistema para A, B y C. La entrega 58 agrega la factura, nota de débito y nota de crédito E como un comprobante de venta más (misma pantalla, cuenta corriente, asiento, cobranza, PDF e informes), con los datos de exportación y su emisión por WSFEX. Es la última entrega de ventas.

Ítem 14 de `docs/pendientes.md` (sección 1.2).

## Objetivos
- Letra **E** para clientes del exterior (`Tercero.residenteExterior`), con códigos de comprobante 19 (factura), 20 (nota de débito) y 21 (nota de crédito).
- Datos de exportación en el comprobante: tipo de exportación (bienes, servicios, otros), país de destino, incoterm, permisos de embarque (para bienes), forma de pago, idioma; cliente con su CUIT país e identificación impositiva.
- Sin IVA ni percepciones; en moneda extranjera (USD) con su cotización, o en pesos.
- Emisión por WSFEX (`FEXAuthorize`, `FEXGetLast_CMP`, `FEXGetLast_ID`, `FEXGetCMP`) con numeración propia por punto de venta y tipo; ambiente SIMULADO para pruebas, como el WSFEv1.
- PDF de la factura E (título *FACTURA E*, *Exportación*, datos de exportación, CAE y QR).

## No objetivos
- Monedas distintas de USD y ARS (el sistema hoy solo maneja esas dos).
- Factura E de crédito MiPyME; percepciones en exportación; reintegros y drawback.
- Consultar los parámetros de ARCA en línea (`FEXGetPARAM_*`): las tablas van fijas en el código, a verificar (ver pendientes).
- Libro IVA Ventas digital con las E (se agregan como "exportación" en los informes si ya lo soportan; si no, queda en pendientes).

## Anti-objetivos
- Mandar a WSFEX un comprobante con IVA o a WSFEv1 una E.
- Que la numeración de la E se mezcle con la de A/B/C.

## Enfoques
- **A (elegido): la E como un comprobante de venta más.** Reusa la grilla, la cuenta corriente, los asientos, la cobranza, el PDF y los informes; cambia la letra, aparecen los datos de exportación y la emisión va por WSFEX.
- B: módulo de exportación aparte con modelo y pantallas propios. Descartado: duplica cuenta corriente, asientos, cobranza y PDF, y lo exportado no estaría en los informes.

## Diseño

### 1. Letra E y códigos
- `LetraVenta` agrega `'E'`. `letraVenta(empresa, cliente, exterior)` devuelve `E` si el cliente es residente del exterior, para cualquier condición de la empresa que emita. *(Decisión mía: el monotributista también exporta con E.)*
- `cbteTipo(tipo, 'E')`: FACTURA 19, NOTA_DEBITO 20, NOTA_CREDITO 21. La FCE (`fce: true`) no admite E (400 `La factura de crédito MiPyME no admite la letra E`).

### 2. Datos de exportación
- `Tercero` agrega `cuitPais String?` (CUIT genérico del país del cliente de la tabla de ARCA, 11 dígitos) y `idImpositivo` (usa el `nif` existente). El país del cliente es `paisSire` (código de la tabla de países de ARCA; *a verificar que coincide con la de WSFEX*).
- `ComprobanteVenta` agrega `tipoExportacion (BIENES | SERVICIOS | OTROS)?`, `paisDestino Int?`, `incoterm String?` (FOB, CIF, EXW, FCA, CPT, CIP, DAP, DPU, DDP, FAS, CFR), `incotermDescripcion String?`, `formaPago String?`, `idioma (1 español, 2 inglés, 3 portugués) @default(1)`, `permisoExistente (S | N)?` y `ComprobanteVentaPermiso { comprobanteId, numero (16 caracteres), paisDestino }`.
- Reglas (mensajes exactos):
  - letra E sin `tipoExportacion` → `Indique el tipo de exportación`;
  - E sin `paisDestino` → `Indique el país de destino`;
  - BIENES: `incoterm` obligatorio (`Indique el incoterm`) y `permisoExistente` obligatorio; con `S`, al menos un permiso (`Cargue los permisos de embarque`); con `N`, sin permisos;
  - SERVICIOS/OTROS: sin permisos (`Los permisos de embarque son solo para bienes`) y sin incoterm;
  - renglones E: alícuota `EXENTO` obligatoria (`La exportación no lleva IVA: use alícuota exento`) *(decisión mía: el cálculo existente ya trata exento sin IVA)*;
  - cliente E sin `cuitPais` ni CUIT → `El cliente del exterior no tiene CUIT país`.
- Las percepciones no se calculan en la E.

### 3. Emisión por WSFEX
- `ClienteFex` (`arca/wsfex.ts`, con la misma autenticación WSAA, servicio `wsfex`): `ultimoAutorizado(ptoVta, cbteTipo)`, `ultimoId()`, `consultar(ptoVta, cbteTipo, numero)`, `autorizar(d: DatosFex)` → `{ resultado: 'A', cae, caeVencimiento, observaciones } | { resultado: 'R', errores }`, `probar()`. `ArcaRealFex` (SOAP a `https://wswhomo.afip.gov.ar/wsfexv1/service.asmx` en homologación y `https://servicios1.afip.gov.ar/wsfexv1/service.asmx` en producción) y `ArcaSimuladoFex` (en memoria; numeración y `Id` propios; fallas forzables como `ArcaSimulado.forzarFalla`).
- `FEXAuthorize` lleva: `Id` (último + 1), `Fecha_cbte`, `Cbte_Tipo`, `Punto_vta`, `Cbte_nro`, `Tipo_expo` (1 bienes, 2 servicios, 4 otros), `Permiso_existente`, `Permisos`, `Dst_cmp`, `Cliente`, `Cuit_pais_cliente`, `Domicilio_cliente`, `Id_impositivo`, `Moneda_Id` (`DOL`/`PES`), `Moneda_ctz`, `Imp_total`, `Forma_pago`, `Incoterms`, `Incoterms_Ds`, `Idioma_cbte`, `Cmps_asoc` (NC/ND) e `Items` (código, descripción, cantidad, unidad de medida, precio, bonificación, total).
- `EmisionService.emitir` deriva a WSFEX cuando la letra es E, con las mismas garantías de hoy (número reservado, reintento, `PENDIENTE_CAE` sin conexión, `RECHAZADO` con los errores, consulta del último antes de reservar). La reserva del número usa `FEXGetLast_CMP` del punto de venta y tipo 19/20/21.
- Contabilidad: el asiento usa la cuenta de ventas del exterior si está configurada (`ConfigCuenta` concepto `VENTAS_EXPORTACION`, por defecto la de ventas) *(decisión mía)*; sin IVA débito.

### 4. PDF y pantallas
- PDF: título `FACTURA E` / `NOTA DE DÉBITO E` / `NOTA DE CRÉDITO E`, código 19/20/21, leyenda `Exportación`, bloque con tipo de exportación, país de destino, incoterm, permisos y forma de pago; sin discriminación de IVA; CAE y QR (tipo de documento del receptor según WSFEX).
- Comprobante de venta: con cliente del exterior el título pasa a *Factura E* y aparece la sección *Exportación* (tipo, país, incoterm y descripción, permiso existente y grilla de permisos con número y país, forma de pago, idioma); las alícuotas se fijan en *Exento*; moneda USD por defecto.
- Clientes: campo *CUIT país* junto a los datos del exterior.

## Restricciones
- WSFEX en ambiente SIMULADO por defecto (el de `ConfigArca`); las pruebas nunca llaman a ARCA.
- Tablas fijas en el código (países, incoterms, idiomas, tipos de exportación, CUIT país) marcadas *a verificar* en `docs/pendientes.md`.
- Modelos y enums nuevos con sus migraciones; desplegar en las tres bases.

## Lo que queda al constructor
- Estructura SOAP exacta de cada método WSFEX y su parseo.
- Cómo se reparte `EmisionService` entre WSFEv1 y WSFEX (estrategia por letra).
- Unidades de medida de los ítems (tabla de ARCA; por defecto `7` unidades).
