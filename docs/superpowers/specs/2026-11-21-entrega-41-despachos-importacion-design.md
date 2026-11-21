# Entrega 41 — Despachos de importación

## 1. Intención
Cuando la empresa importa, la Aduana liquida en el despacho el IVA de la importación, las percepciones de IVA (RG 2937), de Ganancias (RG 2281) y de IIBB (percepciones aduaneras), los derechos de importación y la tasa de estadística. El IVA del despacho es crédito fiscal y las percepciones son pagos a cuenta. Hoy el sistema no tiene un comprobante para el despacho: no entra en el Libro IVA Compras ni en la posición de IVA. Esta entrega agrega el despacho de importación como comprobante de compra.

**Éxito:** el usuario carga el despacho (número, fecha, base imponible y alícuota, IVA, percepciones, derechos y tasa) con la Aduana como proveedor. El IVA aparece en el Libro IVA Compras y en la posición del mes; las percepciones de IVA e IIBB también; la de Ganancias queda como pago a cuenta; los derechos y la tasa se imputan al costo. La deuda con la Aduana es lo liquidado, no el valor de la mercadería. El Libro IVA Digital lo informa con el código 066 y el número de despacho.

**Anti-objetivos:**
- que el valor de la mercadería (base imponible) se sume a la deuda con la Aduana o al asiento: la mercadería se registra con la factura del proveedor del exterior;
- cargar a mano un proveedor «Aduana» con CUIT inventado.

## 2. Enfoques
1. **Elegido:** el despacho como un tipo más de comprobante de compra (`DESPACHO_IMPORTACION`), con campos propios y un asiento que solo registra los tributos.
2. Un módulo de importaciones con carpeta (factura del exterior, flete, seguro, despacho, costeo): mucho más amplio; se puede construir encima de esto.
3. Cargar el despacho como factura A común: deja el IVA, pero suma la base a la deuda y no informa el despacho a ARCA.

## 3. Datos
- `TipoComprobanteCompra` agrega `DESPACHO_IMPORTACION` (migración propia del valor del enum).
- `ComprobanteCompra` agrega:
  - `numeroDespacho String?` (16 caracteres, formato `AAAAA` año y aduana, `XX` destinación, `NN`, `NNNNNN` número, letra de control; validación `^\d{5}[A-Z]{2}\d{2}\d{6}[A-Z]$`): `El número de despacho tiene 16 caracteres (por ejemplo 26001IC04012345K)`;
  - `percepcionGanancias Decimal(18,2) @default(0)`;
  - `derechosImportacion Decimal(18,2) @default(0)` y `tasaEstadistica Decimal(18,2) @default(0)`.
- **Proveedor Aduana:** la Dirección General de Aduanas (CUIT `33-69345023-9`). Al cargar el primer despacho, si la empresa no tiene un tercero con ese CUIT, se crea (`Dirección General de Aduanas`, exento en IVA, exento de Ganancias, proveedor). El despacho siempre va contra ese tercero.
  - Si ya existe pero está inactivo o no es proveedor: `El tercero con el CUIT de la Aduana (<razón social>) no es un proveedor activo: actívelo o márquelo como proveedor`. No se modifica solo.
  - Las órdenes de pago no le retienen nada a ese CUIT (regla explícita en el cálculo de retenciones, además de sus marcas de exento).
- Cuentas nuevas `1.1.03.012 Percepciones Ganancias sufridas` (concepto `PERCEPCION_GANANCIAS`) y `5.1.02 Derechos y tasas de importación` (concepto `COSTO_IMPORTACION`, para derechos y tasa; no se usa Mercaderías porque el stock valoriza esa cuenta sin estos costos; el contador puede reasignarla en la configuración de cuentas). Total de conceptos 51. Plan modelo y migración como en la E38.

## 4. Carga del despacho
- En pesos (la Aduana liquida en pesos); sin letra, sin punto de venta ni número de comprobante (se guardan en 0 y el número de despacho es el identificador; único por empresa: `Ya existe el despacho <número>`).
- Renglones: uno por alícuota, con la base imponible del IVA (valor en aduana + derechos + tasa, como figura en el despacho) y la alícuota (21 % o 10,5 %); el IVA se calcula por alícuota con el mismo cálculo que las facturas (no se escribe a mano).
- El usuario carga el total liquidado del despacho (`totalDeclarado`) y vale el mismo control que en las facturas: si el total calculado difiere en más de 0,05, se rechaza con el mensaje de siempre (así se detecta un IVA distinto del de la Aduana).
- Percepción de IVA (`percepcionIva`, ya existe), percepción de Ganancias, percepciones de IIBB por jurisdicción (ya existen), derechos y tasa.
- **Total del despacho (deuda con la Aduana)** = IVA + percepción IVA + percepción Ganancias + percepciones IIBB + derechos + tasa. La base imponible no suma.
- `fechaContable` = fecha de oficialización (la que el usuario carga); el despacho respeta el bloqueo de los meses de IVA e IIBB cerrados (E37/E38) como cualquier compra.
- La anulación funciona como en las demás compras.

## 5. Asiento
- Debe: IVA crédito fiscal (IVA), `PERCEPCION_IVA`, `PERCEPCION_GANANCIAS`, `PERCEPCION_IIBB`, `COSTO_IMPORTACION` (derechos + tasa).
- Haber: `PROVEEDORES` por el total del despacho.
- Cuenta corriente del proveedor Aduana por el total; se paga con una orden de pago como cualquier deuda (sin retenciones: la Aduana es exenta y los regímenes ya excluyen a exentos; si no, `RetencionesService` no retiene a la Aduana por CUIT).

## 6. Libros y posición
- **Libro IVA Compras:** columnas nuevas *Perc. Ganancias* y *Otros tributos* (derechos + tasa; 0 en los demás comprobantes), también en el Excel y el PDF. El despacho muestra la base por alícuota en el neto, el IVA, las percepciones y el total del despacho (= deuda con la Aduana). En el despacho el total no incluye la base (la nota al pie del libro lo aclara: `En los despachos de importación el total es lo liquidado por la Aduana; la base imponible no lo integra`); comprobante `Despacho <número>`.
- **Posición de IVA (E37):** el IVA entra en el crédito y la percepción de IVA en percepciones, sin cambios (salen del Libro IVA Compras). Con prorrateo (E40) el despacho tiene destino del crédito como cualquier compra.
- **Liquidación de IIBB (E38):** las percepciones IIBB aduaneras entran por jurisdicción, sin cambios.
- **Libro IVA Digital (compras):** tipo de comprobante `066`, punto de venta y número en 0, campo `despacho` con el número, documento CUIT de la Aduana, importe total = total del despacho, `percepcionesIva` y `percepcionesNacionales` (Ganancias), `percepcionesIibb`, `otrosTributos` = derechos + tasa, crédito computable = IVA; alícuotas con la base imponible. (Diseño del importe total y de otros tributos a verificar con ARCA, §2 de pendientes.)

## 7. Pantallas
- Compras → *Despacho de importación*: número, fecha de oficialización, renglones base/alícuota/IVA, percepciones (IVA, Ganancias, IIBB por jurisdicción), derechos y tasa, total; destino del crédito si hay prorrateo.
- Consulta de comprobantes de compra: filtro y etiqueta *Despacho*.

## 8. Mensajes
- `El número de despacho tiene 16 caracteres (por ejemplo 26001IC04012345K)`.
- `Ya existe el despacho <número>`.
- `El despacho no lleva letra ni número de comprobante`.

## 9. No objetivos
- Carpeta de importación y costeo (prorrateo de flete, seguro y derechos a los artículos).
- Factura del proveedor del exterior en moneda extranjera como tipo propio (se sigue cargando como hoy).
- Pago por VEP y su conciliación.
- Despachos de exportación.
- IVA adicional de importación de servicios (art. 4 inc. d).

## 10. Casos a vigilar
- Despacho con dos alícuotas (21 % y 10,5 %).
- Despacho sin percepciones (solo IVA).
- Anular un despacho de un mes con la posición de IVA cerrada → bloqueado.
- La Aduana ya cargada a mano como tercero con ese CUIT: se usa esa.
- Despacho en un mes con prorrateo: destino común.
