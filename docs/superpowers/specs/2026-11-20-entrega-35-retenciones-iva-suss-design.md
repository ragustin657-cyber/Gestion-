# Entrega 35 — Retenciones de IVA y SUSS (SIRE)

## 1. Intención
El diseño original del sistema prometía retenciones con exportación SICORE / SIRE / ARBA; la entrega 7 dejó afuera IVA y SUSS. El usuario la pide **para que el sistema esté completo** cuando una empresa sea designada agente: configuración general, regímenes editables y los archivos de importación del SIRE (certificados por lote).

**Éxito:** una empresa marcada como agente de IVA y/o SUSS paga a un proveedor con su régimen asignado, la orden de pago calcula una retención por factura, emite el certificado, contabiliza el pasivo y el SIRE del mes se genera con el diseño oficial.

**Anti-objetivos:** inventar códigos de ARCA; cambiar la carga de compras; tocar las retenciones de Ganancias e IIBB ya existentes.

## 2. Fuente oficial
`docs/referencias/arca-SIRE-emision-por-lote.txt` (ARCA, «SIRE — Especificación de archivo para emisión por lote», versión 11/07/2022): F.2005 (IVA, impuesto 216) y F.2004 (Seguridad Social, impuesto 353). La tabla de códigos de régimen está en `servicioscf.afip.gob.ar` y no se pudo descargar: **los códigos se cargan a mano** (§12).

## 3. Enfoques
1. **Elegido — régimen en la ficha del proveedor.** Interruptores de agente en la empresa, tablas de regímenes de IVA y de SUSS, régimen en la ficha, cálculo por factura al pagar, certificado y archivos SIRE. Reusa el esquema de Ganancias. Límite: un proveedor que factura bienes y servicios usa el régimen de su ficha.
2. Régimen por factura de compra: más preciso para proveedores mixtos, pero suma un campo a la carga de compras.
3. Solo el archivo, con retenciones cargadas a mano: no calcula.

## 4. Configuración
- **Empresa:** `agenteRetencionIva`, `agenteRetencionSuss` (booleanos, por defecto falso), junto a `agenteRetencionGanancias`, editables en la pantalla de la empresa.
- **Regímenes de IVA** (`RegimenIva`, por empresa, permiso de configuración de pagos): `codigoSire` (texto de 3 dígitos, opcional hasta presentar), `descripcion`, `porcentaje` (sobre el IVA de la factura), `minimoComprobante` (si el total de la factura es menor, no se retiene), `minimoRetencion` (si la retención es menor, no se retiene), `condicionSire` (entero opcional: se informa en el campo CONDICIÓN del F.2005 cuando el régimen lo exige), `activo`.
- **Regímenes de SUSS** (`RegimenSuss`): `codigoSire`, `descripcion`, `porcentaje` (sobre el importe pagado sin IVA), `minimoNoSujeto` (base de la factura en ese pago por debajo de la cual no se retiene), `minimoRetencion`, `activo`.
- **Precarga** (editable, con `codigoSire` vacío y un aviso «Cargue el código SIRE…» en la pantalla de regímenes):
  - IVA: «Compraventa de cosas muebles» 50 %; «Locaciones de obras y servicios» 80 %; «Proveedor con incumplimientos (100 %)» 100 %; mínimos en 0.
  - SUSS: «Construcción» 1,2 %; «Limpieza de inmuebles» 6 %; «Investigación y seguridad» 6 %; «Empresas de servicios eventuales» 2 %; mínimos en 0.
  - Los porcentajes son de referencia y quedan a verificar por el usuario (§12).
- **Ficha del proveedor:** `regimenIvaId?`, `regimenSussId?`; exclusión de IVA: `exclusionIvaPorcentaje` (50 o 100, opcional), `exclusionIvaPublicacion` (fecha), `exclusionIvaHasta` (fecha). El campo existente `exentoIva` pasa a significar «no se le retiene IVA» y se respeta **sin fecha de fin**: `exencionHasta` sigue limitando solo a Ganancias (*decisión del constructor*; una exención de IVA con vencimiento se carga como exclusión del 100 % con su fecha).

## 5. Cálculo (en la orden de pago, al calcular las retenciones)
Para cada imputación de la OP a una **factura o nota de débito** de compra (no tickets, notas de crédito ni anticipos; *decisión del constructor*: los tickets no discriminan IVA y el SIRE no tiene un tipo con su formato):
- **Notas de crédito en la misma OP** (*decisión del constructor*): la parte imputada de una nota de crédito reduce la base de IVA y de SUSS de su factura asociada (`comprobanteAsociadoId`) si esa factura está en la misma OP; si no, se reparte en proporción a lo imputado entre las facturas de la OP. Una base que queda en cero o negativa no retiene. Así una OP neteada con notas de crédito no retiene sobre lo que no se paga.
- **IVA** — si la empresa es agente, el proveedor es Responsable Inscripto, tiene régimen de IVA activo, no es `exentoIva`, sin exclusión del 100 % vigente a la fecha de pago, y la factura tiene IVA > 0 y `total ≥ minimoComprobante`:
  - base = IVA de la factura × (importe imputado en pesos / total en pesos de la factura), a 2 decimales;
  - retención = base × porcentaje; con exclusión del 50 % vigente, la mitad;
  - si la retención < `minimoRetencion`, no se retiene.
- **Facturas M** (*decisión del constructor*): no se fuerza el 100 % automáticamente; se asigna el régimen del 100 % al proveedor.
- **SUSS** — por factura, igual que IVA (el F.2004 informa la factura) — si la empresa es agente, el proveedor no es Monotributo y tiene régimen de SUSS activo:
  - base = parte sin IVA del importe imputado (la misma `baseSujeta` de Ganancias);
  - si la base < `minimoNoSujeto`, no se retiene; retención = base × porcentaje; si < `minimoRetencion`, no se retiene.
- Cada retención de IVA y SUSS es una fila de `OrdenPagoRetencion` con `impuesto` `IVA` o `SUSS`, `regimen` = id del régimen, `comprobanteCompraId` (nuevo, opcional) y `detalle` con base, porcentaje, exclusión y datos de la factura.
- El control existente «Las retenciones superan el importe a pagar» incluye estas retenciones.
- La vista previa de retenciones de la OP las muestra con el comprobante.

## 6. Pago, certificado y contabilidad
- Al pagar, cada retención > 0 recibe número de certificado de los talonarios `RET-IVA` y `RET-SUSS`.
- Asiento: haber en `RETENCION_IVA` (2.1.02.003) y `RETENCION_SUSS` (2.1.02.005), que se agregan a los conceptos contables.
- PDF: con el SIRE, el certificado oficial lo emite ARCA al importar el lote (su número es otro; el nuestro va en el código de trazabilidad, de uso no fiscal). El PDF del sistema se titula «Constancia de retención de IVA» / «… de SUSS», con la leyenda «El certificado oficial se emite en el SIRE de ARCA», régimen, factura retenida (tipo, número, fecha, total), base y porcentaje (*decisión del constructor*). Guardar el número de certificado del SIRE queda fuera de alcance.
- Anular la OP marca las retenciones como anuladas (como hoy); si ya se presentaron en el SIRE, la anulación del certificado en SIRE la hace el usuario (fuera de alcance).
- Las consultas de retenciones practicadas incluyen IVA y SUSS.

## 7. Archivos SIRE
Nuevas presentaciones `SIRE_IVA` y `SIRE_SUSS`, mensuales (el SIRE exige un único mes por archivo), con el historial y la huella existentes.
- Registros: una retención no anulada con certificado, de OP pagadas en el mes, ordenadas por fecha de pago y certificado.
- Si un régimen usado no tiene `codigoSire`: 400 `Cargue el código SIRE del régimen <descripción>`.
- **F.2005 (IVA)** — longitud 305, campos según §5.1 del manual: versión `0100`; trazabilidad = número de certificado; impuesto `216`; régimen = `codigoSire`; fecha de retención = fecha de pago; condición = `condicionSire` o espacios; imposibilidad `0`; motivo en espacios; importe de retención; base de cálculo; régimen de exclusión `1` con porcentaje (50/100) y fecha de publicación si el proveedor tiene exclusión vigente, si no `0` y espacios; tipo de comprobante (factura `1`, nota de débito `4`); fecha de comprobante; número `PPPPP-NNNNNNNN`; COE, COE original y CAE en espacios; importe del comprobante (total en pesos); motivo de NC en espacios; retenido clave = CUIT del proveedor; certificado original y motivo de anulación en espacios.
- **F.2004 (SUSS)** — longitud 191, §4.1: formulario `2004`; versión `0100`; trazabilidad = número de certificado; CUIT agente; impuesto `353`; régimen; CUIT retenido; fecha de retención; tipo de comprobante; fecha; número; importe del comprobante; importe de la retención; certificado original y otros datos en espacios.
- Tipos de campo como §2.2: enteros alineados a la derecha con ceros, decimales con punto y 2 decimales, textos a la izquierda con espacios, fechas `DD/MM/AAAA`. Separador CRLF, ISO 8859-1.
- Nombre: `SIRE-F2005_<CUIT>_<AAAAMM>.txt` y `SIRE-F2004_<CUIT>_<AAAAMM>.txt`.

## 8. Pantallas
- Empresa: los dos interruptores.
- Configuración de pagos: pestañas «Regímenes de IVA» y «Regímenes de SUSS» como la de Ganancias, con el aviso de códigos SIRE faltantes.
- Proveedor: selects de régimen de IVA y de SUSS y los campos de exclusión de IVA.
- Orden de pago: las retenciones de IVA y SUSS en la vista previa y el detalle, con la factura.
- Impuestos → Presentaciones: «SIRE IVA (F.2005)» y «SIRE SUSS (F.2004)».

## 9. Migración y demo
- Migración de esquema (enum `TipoPresentacion` con los dos valores nuevos en su propia migración) y de datos: precarga de regímenes para las empresas existentes.
- Demo: la empresa no es agente de IVA ni SUSS (las e2e existentes no cambian); la e2e nueva la activa desde la pantalla.

## 10. No objetivos
Percepciones de IVA; guardar el número de certificado que emite el SIRE; 100 % automático para facturas M; notas de crédito de retenciones y anulaciones por lote en el SIRE; F.2003 (Ganancias a no residentes); retenciones sobre anticipos; régimen por factura; quincenas.

## 11. Casos a vigilar
Factura pagada en varias OP (cada pago retiene su proporción); factura en dólares (pesos del pago sobre total en pesos); proveedor que cambia de régimen entre OP; exclusión vencida a la fecha de pago; OP con retenciones de los cuatro impuestos y el tope del neto.

## 12. A verificar con ARCA
Códigos de régimen del SIRE (tabla REGIMEN de impuestos 216 y 353); porcentajes y mínimos vigentes de los regímenes precargados; qué regímenes exigen CONDICIÓN.
