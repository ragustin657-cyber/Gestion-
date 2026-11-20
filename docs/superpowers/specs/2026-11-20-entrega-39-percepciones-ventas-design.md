# Entrega 39 — Percepciones practicadas en las facturas de venta (IIBB e IVA)

## 1. Intención
La empresa es agente de percepción de Ingresos Brutos (ARBA, AGIP) y, si ARCA la designó, de IVA. Hoy el sistema solo registra las percepciones que sufre en sus compras y practica retenciones en los pagos. Esta entrega calcula las percepciones en cada factura y nota de débito según el padrón del cliente, las revierte en las notas de crédito, las informa a ARCA con el CAE, las contabiliza como deuda a depositar, las muestra en los libros de IVA y en el PDF, y genera los archivos para ARBA y AGIP.

**Éxito:** el usuario emite una factura a un cliente que figura en el padrón de ARBA. El sistema agrega sola la percepción con la alícuota del padrón, el total la incluye, ARCA la recibe en el CAE, el asiento la deja en *Percepciones IIBB a depositar* y, al final del mes, el lote de percepciones de ARBA sale con esa factura.

**Anti-objetivos:**
- que el usuario tenga que calcular a mano la percepción;
- que la percepción practicada entre en la posición de IVA o en la liquidación de IIBB propias: es dinero del fisco que la empresa deposita aparte;
- percibir a quien no corresponde: consumidor final, cliente exento por ficha o excluido por certificado.

## 2. Enfoques
1. **Elegido:** IIBB (ARBA y AGIP) e IVA, con cálculo automático por padrón y ficha, nota de crédito que revierte, CAE, asiento, libros, PDF y archivos.
2. Solo IIBB.
3. Carga manual sin cálculo.

## 3. Configuración
- **IIBB, por jurisdicción** (`JurisdiccionIibb`, la misma de las retenciones), campos nuevos:
  - `percibe Boolean @default(false)`;
  - `alicuotaPercepcionDefecto Decimal(18,6) @default(0)`;
  - `minimoPercepcion Decimal(18,2) @default(0)`: si la percepción calculada no llega, no se percibe;
  - `sinPadronPercepcion SinPadron @default(NO_RETENER)`: qué hacer con el cliente que no figura en el padrón (no percibir o alícuota por defecto).
- **Ficha de IIBB del cliente:** `TerceroIibb.alicuotaPercepcion` pasa a ser opcional (`Decimal?`). Vacía = sin dato; 0 = se percibe al 0 %. Migración: las fichas existentes con 0 quedan vacías (hasta hoy la percepción no se usaba). En el formulario del tercero el campo vacío no se guarda como 0.
- **IVA:**
  - `Empresa.agentePercepcionIva Boolean @default(false)`;
  - modelo `RegimenPercepcionIva` (de empresa): `{ codigo String (régimen SIRE), descripcion, alicuotaGeneral Decimal(9,4), alicuotaReducida Decimal(9,4), minimoNeto Decimal(18,2), activo }`. Uno solo activo por empresa: `Active solo un régimen de percepción de IVA`.
- **ARBA:** `ConfigImpuestos.arbaActividadPercepcion String @default("7")` para el nombre del lote.
- La pantalla de configuración de retenciones pasa a llamarse *Retenciones y percepciones*: los campos de percepción en la tabla de jurisdicciones y el régimen de percepción de IVA.

## 4. Cálculo (factura y nota de débito)
Se calcula al guardar el borrador (para mostrarlo) y se recalcula al emitir con el padrón vigente a la fecha del comprobante. Solo letras A y B; nunca a `CONSUMIDOR_FINAL`.

- **IIBB, por cada jurisdicción con `percibe`:**
  - alícuota con la misma regla que la retención (`alicuotaIibb`): exento por ficha → no; padrón (si `usaPadron`) → su `alicuotaPercepcion`; ficha con alícuota de percepción cargada; si no, según `sinPadronPercepcion`;
  - la alícuota por defecto (`ALICUOTA_DEFECTO`) solo se aplica a clientes vinculados a la jurisdicción: con ficha de IIBB en ella, o con `Tercero.provincia` que se normaliza a esa jurisdicción (la normalización del informe por provincia de la E38). Sin vínculo, el cliente que no está en el padrón no se percibe;
  - `base = netoGravado + noGravado + exento` (moneda del comprobante);
  - `importe = base × alícuota / 100` redondeado; 0 si no llega a `minimoPercepcion` (comparado en pesos).
- **IVA, si `agentePercepcionIva` y hay régimen activo:**
  - solo a clientes `RESPONSABLE_INSCRIPTO` sin exclusión vigente (`exclusionIvaHasta ≥ fecha`, misma ficha que la retención de IVA; con exclusión parcial, la percepción se reduce en el porcentaje);
  - `base` = neto gravado; alícuota general para la parte al 21 % y 27 %, reducida para la parte al 10,5 %, 5 % y 2,5 %: **un renglón de percepción por cada una** (general y reducida), cada uno con su base y su alícuota;
  - la exclusión parcial reduce el importe en su porcentaje; la alícuota guardada es la del régimen y el renglón guarda `exclusionPct`;
  - no se percibe si el neto gravado en pesos no supera `minimoNeto`.
- Se guarda en `ComprobanteVentaPercepcion { id, empresaId, comprobanteId, tipo ('IIBB'|'IVA'), jurisdiccion?, regimenCodigo?, base, alicuota, importe, origenAlicuota ('PADRON'|'FICHA'|'DEFECTO'|'REGIMEN'), exclusionPct Int? }`.
- `ComprobanteVenta.percepciones Decimal(18,2) @default(0)` = suma; `total` y `totalPesos` la incluyen.

## 5. Nota de crédito
- **Con comprobante asociado que tuvo percepciones:** por cada percepción de la asociada, `importe = base de la NC × alícuota de la asociada` (con la exclusión de la asociada), sin mínimo; para IIBB la base de la NC es neto gravado + no gravado + exento; para IVA, el neto gravado de la NC en las alícuotas de ese renglón (general o reducida); el total revertido de cada percepción no supera lo percibido en la asociada menos lo ya revertido por otras NC.
- **Sin asociada:** no lleva percepciones (la NC suelta no revierte nada).
- La NC no consulta el padrón.

## 6. ARCA (CAE)
- `ImpTrib` = suma de percepciones; `ImpTotal` las incluye.
- `<Tributos>` con un `<Tributo>` por percepción: `Id` 7 (Percepción de IIBB) o 6 (Percepción de IVA), `Desc` («Percepción IIBB 902 Buenos Aires», «Percepción IVA RG <código>»), `BaseImp`, `Alic`, `Importe`. Los códigos se confirman con `FEParamGetTiposTributos` (dato a verificar, §2 de pendientes).
- El simulador de ARCA valida que `ImpTotal = ImpNeto + ImpTotConc + ImpOpEx + ImpIVA + ImpTrib`.

## 7. Contabilidad, cuenta corriente y PDF
- **Asiento de la venta:** Deudores por ventas al debe por el total con percepciones; al haber, además de ventas e IVA débito, `PERCEPCION_IIBB_PRACTICADA` (`2.1.02.008 Percepciones IIBB a depositar`) y `PERCEPCION_IVA_PRACTICADA` (`2.1.02.009 Percepciones IVA a depositar`). En la NC, al revés. Cuentas en el plan modelo y por migración, como en la E38.
- La cuenta corriente y la cobranza usan el total con percepciones (ya usan `total`).
- **PDF:** renglón por percepción («Percepción IIBB Buenos Aires 3,00 %») entre el IVA y el total.

## 8. Libros de IVA
- **Libro IVA Ventas:** columnas *Percepciones IVA* y *Percepciones IIBB*; el total las incluye.
- **Libro IVA Digital (ventas):** `percepcionesNacionales` = percepciones de IVA a responsables inscriptos; `percepcionesIibb` = las de IIBB (moneda de origen, como los demás importes).
- `cuadreIva` no cambia (las percepciones no son débito fiscal).

## 9. Archivos para los organismos (Impuestos → Presentaciones)
- **ARBA — percepciones** (tipo nuevo `ARBA_PERCEPCIONES`, con la misma periodicidad que las retenciones y **su propio correlativo de lotes** `ARBA-LOTE-PERCEPCION`, separado del de retenciones): un renglón por comprobante con percepción 902 del período: CUIT del cliente (con guiones), fecha, tipo de comprobante (F, D o C para la NC), letra, punto de venta, número, base (negativa en la NC), importe (negativo en la NC) y tipo de operación `A`. Lote ZIP `AR-<cuit>-<período><quincena>-<actividad percepción>-LOTE<n>`. Diseño a verificar con el instructivo de ARBA (§2 de pendientes).
- **AGIP:** el archivo e-ARCIBA existente agrega las percepciones 901 de facturas y notas de débito del mes (`tipoOperacion` 2, datos del comprobante, situación de IIBB e IVA del cliente, base, alícuota e importe). Las exigencias de ficha completa valen también para los clientes.
- **Notas de crédito de AGIP:** e-ARCIBA las recibe en un archivo con otro diseño (referencia a la factura y monto a deducir), que no está en el repositorio. Esta entrega las lista en un detalle (Excel/PDF: NC, factura asociada, cliente, base y percepción revertida) con el aviso `Hay notas de crédito con percepciones de CABA: cárguelas en e-ARCIBA` y el diseño del archivo queda a verificar (§2 de pendientes).
- **IVA:** el SIRE de IVA (`SIRE_IVA`) agrega una sección informativa con las percepciones del mes (Excel/PDF del detalle por cliente) para cargar en el SIRE; el lote de percepciones queda fuera de alcance hasta verificar su diseño (§2 de pendientes).
- Sin movimientos: los mismos avisos que las retenciones.

## 10. Mensajes
- `Complete la situación de Ingresos Brutos de: <clientes>` (AGIP, como en proveedores).
- `Active solo un régimen de percepción de IVA`.
- En el formulario de la factura, las percepciones calculadas se muestran como renglones de solo lectura con su origen («padrón», «ficha», «alícuota por defecto», «régimen»).

## 11. No objetivos
- Percepciones de otras jurisdicciones (las de otras provincias siguen en §1.1 punto 4 de pendientes).
- Lote del SIRE para percepciones de IVA (solo informe) y percepción de IVA a no categorizados.
- Percepciones municipales.
- Depósito o pago de lo percibido (se hace fuera del sistema; el asiento de pago es manual).
- Percepción en recibos o anticipos.
- Factura de exportación.

## 12. Casos a vigilar
- Factura en dólares: base e importe en la moneda del comprobante; el mínimo y el asiento en pesos.
- Cliente en el padrón con alícuota 0.
- NC parcial y varias NC sobre la misma factura: lo revertido no supera lo percibido.
- Borrador guardado antes de cargar el padrón y emitido después: al emitir manda el padrón vigente.
- Cliente exento por ficha en una jurisdicción y en el padrón de otra.
- Factura B a un monotributista (sí percibe IIBB; no IVA).
- Cliente sin ficha ni provincia de la jurisdicción con `ALICUOTA_DEFECTO`: no se percibe.
- Proveedor que también es cliente, con ficha de IIBB cargada para retenciones: su percepción vacía no lo percibe al 0 %.
