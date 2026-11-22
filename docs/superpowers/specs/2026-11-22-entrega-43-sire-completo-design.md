# Entrega 43 — SIRE completo: anulaciones y Ganancias a beneficiarios del exterior

## 1. Intención
El SIRE de la E35 informa las retenciones de IVA (F.2005) y SUSS (F.2004) del mes. Faltan dos cosas:
- **Anular en el SIRE una retención ya presentada** (por ejemplo, porque se anuló la orden de pago en un mes posterior). Hoy se resuelve a mano.
- **Retención de Ganancias a beneficiarios del exterior** (art. 102 y siguientes de la ley; F.2003 del SIRE). Hoy no se calcula ni se informa.

**Éxito:**
- Al anular una orden de pago cuya retención de IVA o SUSS ya se informó en el SIRE de un mes anterior, el SIRE del mes de la anulación incluye la anulación (IVA) o la nota de crédito (SUSS) del certificado original.
- Al pagar a un proveedor del exterior, la orden de pago calcula la retención de Ganancias con la alícuota de su régimen (con o sin convenio de doble imposición, con acrecentamiento si corresponde), la contabiliza y el F.2003 del mes la informa.

## 2. Enfoques
1. **Elegido:** número de certificado SIRE cargado por el usuario en cada retención (lo devuelve ARCA al procesar el lote), anulaciones y notas de crédito generadas solas en el mes de la anulación; retención al exterior por régimen configurable y F.2003.
2. Importar el archivo de respuesta del SIRE con los números de certificado: no tenemos el diseño de esa respuesta (queda en pendientes).
3. Dejar las anulaciones a mano y solo agregar el F.2003.

## 3. Anulaciones (F.2005 IVA y F.2004 SUSS)
- `OrdenPagoRetencion` agrega:
  - `anuladaEn DateTime? @db.Date`: la fecha de la anulación de la orden (hoy, como el contraasiento);
  - `certificadoSire String?`: el número de certificado que asignó ARCA (hasta 25 caracteres).
- **Carga del número SIRE:** en *Pagos › Retenciones practicadas*, cada retención de IVA o SUSS tiene el campo *Certificado SIRE* editable (`PATCH /api/pagos/retenciones/:id/certificado-sire`, permiso `op.pagar`).
- **SIRE del mes M:**
  - retenciones normales: las de fecha de pago en M que no están anuladas o que se anularon después de M (así regenerar un mes ya presentado da el mismo archivo);
  - anulaciones: las retenciones anuladas con `anuladaEn` en M y fecha de pago anterior a M.
- **F.2005 (IVA), anulación por lote:** solo `VERSIÓN`, `CÓDIGO DE TRAZABILIDAD`, `IMPUESTO`, `CERTIFICADO ORIGINAL NRO` y `MOTIVO DE LA ANULACIÓN`; el resto en blanco o cero según el tipo de campo.
  - Motivo: `ConfigImpuestos.sireMotivoAnulacion Int @default(1)` (código de la tabla MOTIVO_DE_ANULACION del SIRE; la tabla no está en la referencia: dato a verificar).
- **F.2004 (SUSS), nota de crédito:** el F.2004 no tiene anulación: se informa una nota de crédito (`TIPO COMPROBANTE` 3) con fecha de retención y de comprobante = `anuladaEn`, número de comprobante = el de la orden de pago, importe del comprobante y de la retención = los originales, y certificado original número (SIRE), fecha e importe.
- Sin número de certificado SIRE: `Cargue el número de certificado SIRE de la retención <certificado interno> (<proveedor>) para informar su anulación`.
- Anulada en el mismo mes que su pago: no se informa (como hoy).

## 4. Ganancias a beneficiarios del exterior (F.2003)
- **Proveedor del exterior** (`Tercero`): `residenteExterior Boolean @default(false)`, `nif String?` (clave tributaria en su país), `paisSire Int?` (código de la tabla PAIS del SIRE), `domicilioExterior String?`, `tipoPersona` (`F`|`J`), `nacimientoPais Int?`, `nacimientoFecha Date?` (obligatorios para persona física), `regimenExteriorId String?`, `aplicaCdi Boolean @default(false)`, `acrecentamiento Boolean @default(false)`.
- **Régimen** `RegimenExterior` (de empresa): `{ codigoSire (3, impuesto 218), descripcion, alicuotaSinCdi Decimal(9,4) (% efectivo sobre lo pagado, p. ej. 31,5 = 35 % × 90 %), codigoAlicuotaSinCdi Int (tabla ALICUOTAS_SIN_CDI), alicuotaConCdi Decimal?, codigoAlicuotaConCdi Int?, activo }`. Los valores se cargan a mano (tablas del SIRE, a verificar).
- **Cálculo en la orden de pago** (proveedor `residenteExterior` con régimen activo; reemplaza a la retención de Ganancias local, que no se calcula para él):
  - alícuota = la con CDI si `aplicaCdi` (si el régimen no la tiene: `El régimen <x> no tiene alícuota con convenio`), si no la sin CDI;
  - `retención = base × a / 100`; con acrecentamiento (la empresa toma a su cargo el impuesto): `retención = base × a / (100 − a)`;
  - sin mínimo; base = lo que se paga imputado a comprobantes (como la local) en pesos.
  - Se guarda como `impuesto 'GANANCIAS_EXTERIOR'` con el régimen, la alícuota y el código de alícuota en el detalle; certificado con el talonario `RET-GAN-EXT`; cuenta `RETENCION_GANANCIAS` (la misma deuda que la local).
- **SICORE** no incluye estas retenciones (filtra `GANANCIAS`).
- **F.2003** (presentación nueva `SIRE_GANANCIAS_EXTERIOR`, mensual): un registro por retención según el diseño 3.1 de la referencia: formulario 2003, versión 0100, trazabilidad (certificado interno), CUIT agente, impuesto 218, régimen, CUIT ordenante (la empresa), fecha de retención (pago), tipo de comprobante 1 (factura) o 6 (orden de pago) con su número, importe del comprobante (la base), no retención 0, aplica CDI, código de alícuota, acrecentamiento, NIF, denominación, domicilio y país del exterior, tipo de persona y los de nacimiento para personas físicas.
  - Faltan datos del proveedor: `Complete los datos del exterior de: <proveedores>` (NIF, país, domicilio, tipo de persona; nacimiento si es persona física).
  - Las anulaciones posteriores al mes se informan como nota de crédito (tipo 3, certificado original SIRE, fecha, importe y motivo `Anulación de la orden de pago`), igual que §3.
- **Certificado PDF** de la retención al exterior con la leyenda del SIRE (como el de IVA de la E35).

## 5. Pantallas
- *Pagos › Retenciones practicadas*: columna *Certificado SIRE* editable en IVA, SUSS y Ganancias exterior.
- *Configuración de retenciones*: pestaña *Ganancias exterior* (regímenes).
- Ficha del tercero, pestaña *Impuestos*: datos del exterior.
- *Impuestos › Configuración*: motivo de anulación del SIRE.
- *Presentaciones*: *SIRE Ganancias exterior (F.2003)*.

## 6. Mensajes
- `Cargue el número de certificado SIRE de la retención <n> (<proveedor>) para informar su anulación`.
- `Complete los datos del exterior de: <proveedores>`.
- `El régimen <x> no tiene alícuota con convenio`.

## 7. No objetivos
- Importar la respuesta del SIRE con los números de certificado.
- Notas de crédito de retención por devolución parcial (sin anular la orden).
- Retenciones a beneficiarios del exterior de otros impuestos (IVA por prestaciones del exterior).
- Cálculo de la base presunta por tipo de renta (la alícuota efectiva del régimen ya la incluye).

## 8. Casos a vigilar
- Orden anulada el mismo mes que su pago: no hay anulación en el SIRE.
- Regenerar el SIRE de un mes anterior después de anular: el archivo no cambia.
- Retención al exterior en dólares: base en pesos a la cotización del pago.
- Acrecentamiento con alícuota 31,5 %: 100.000 → 45.985,40.
- Proveedor del exterior sin régimen: sin retención y aviso en la orden `El proveedor del exterior <x> no tiene régimen de Ganancias exterior`.
