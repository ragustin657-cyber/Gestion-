# Entrega 38 — Ingresos Brutos por Convenio Multilateral

## 1. Intención
La empresa tributa Ingresos Brutos en varias jurisdicciones por Convenio Multilateral. Hoy el sistema guarda las retenciones y percepciones de IIBB sufridas por jurisdicción, pero no liquida el impuesto propio. Esta entrega agrega la liquidación mensual por jurisdicción, con los números de la DJ mensual (CM03) para cargar en SIFERE, el arrastre de saldos a favor y el asiento. También un informe de ingresos del año por provincia, como ayuda para que el contador arme los coeficientes (CM05).

**Éxito:** el contador carga las jurisdicciones del año con su coeficiente y su alícuota. Cada mes ve, por jurisdicción, la base, el impuesto, las retenciones y percepciones sufridas, el saldo a favor anterior y el resultado. Al cerrar el mes, se genera el asiento y los saldos a favor pasan al mes siguiente.

**Anti-objetivos:**
- compensar el saldo a favor de una jurisdicción con el impuesto de otra (no se compensan);
- que un comprobante cargado tarde cambie un mes ya cerrado;
- calcular el CM05 (lo arma el contador).

## 2. Enfoques
1. **Elegido:** el contador carga los coeficientes y el sistema liquida cada mes con cierre, asiento y arrastre, como la posición de IVA (E37), y además da un informe de ingresos por provincia.
2. El sistema calcula también el CM05: exige la provincia de cada gasto y reglas de computabilidad, y es donde el contador más interviene a mano.
3. Solo un informe, sin liquidación ni saldos.

## 3. Configuración
- `JurisdiccionCm` (de empresa, en `MODELOS_DE_EMPRESA`):
  - `{ id, empresaId, anio, jurisdiccion ('901'…'924'), coeficiente Decimal(9,6), alicuota Decimal(9,4) (%), actividad String (código NAES), saldoInicial Decimal(18,2) @default(0) }`;
  - única por `(empresaId, anio, jurisdiccion)`;
  - una sola actividad y alícuota por jurisdicción: varias actividades quedan fuera de alcance;
  - `saldoInicial` solo cuenta en el año de inicio (`iibbInicioAnio`): en los demás años la pantalla no lo muestra y la API lo guarda en 0.
- `ConfigImpuestos` agrega `iibbInicioAnio Int?` e `iibbInicioMes Int?`: el primer mes que se liquida en el sistema. El `saldoInicial` de las jurisdicciones de ese año es el saldo a favor de cada una al comienzo de ese mes.
- **Validaciones al cerrar un mes:**
  - el año tiene que tener jurisdicciones: `Cargue las jurisdicciones y coeficientes de Convenio Multilateral de AAAA`;
  - los coeficientes del año suman 1 (tolerancia 0,0001): `Los coeficientes de AAAA suman X: deben sumar 1`.
- Endpoints en `/api/impuestos/iibb/jurisdicciones?anio`:
  - `GET` con `impuestos.ver`;
  - `PUT` con `impuestos.presentar`, que reemplaza la lista del año.
  - Con meses del año cerrados, el `PUT` da 400: `Hay meses de AAAA liquidados: reábralos para cambiar las jurisdicciones`.
- El inicio se configura en `PUT /api/impuestos/config`, con la misma guardia que la E37: `Hay liquidaciones de IIBB cerradas: reábralas para cambiar el inicio`.

## 4. Cálculo mensual (importes a 2 decimales)
- **Ingresos gravados del mes:**
  - `netoGravado + noGravado + exento`, por `cotizacion` (en pesos), de los comprobantes de venta `AUTORIZADO` con fecha en el mes;
  - las facturas y notas de débito suman, las notas de crédito restan;
  - mismo criterio de ambiente que el Libro IVA Ventas (`ventasDelAmbiente`).
- **Por jurisdicción del año:**
  - `base = ingresos × coeficiente`;
  - `impuesto = base × alicuota / 100`;
  - `retenciones` = `ReciboRetencion` de tipo `IIBB` de esa jurisdicción con fecha en el mes y recibo `CONFIRMADO`;
  - `percepciones` = `ComprobanteCompraPercepcionIibb` de esa jurisdicción, de compras `CONFIRMADO` con `fechaContable` en el mes;
  - las retenciones y percepciones de IIBB de las liquidaciones de tarjetas (`LiquidacionTarjetaImpuesto`, tipo `IIBB`, de liquidaciones `CONFIRMADO` con `fecha` en el mes) suman a `retenciones` y `percepciones` según su `clase`;
  - `saldoAnterior` = el saldo a favor del mes anterior cerrado o, en el mes de inicio, el `saldoInicial`;
  - `resultado = impuesto − retenciones − percepciones − saldoAnterior`: si es positivo, `aPagar`; si no, `saldoAFavor = −resultado`.
- Las retenciones y percepciones de jurisdicciones sin `JurisdiccionCm` en el año se informan como aviso: `Hay retenciones o percepciones de la jurisdicción X, que no está en el Convenio de AAAA`. Se ignoran en el cálculo.
- **Lo que el cálculo deja afuera queda en su cuenta, con aviso** (el asiento solo cancela lo calculado; el contador lo regulariza a mano):
  - retenciones y percepciones de jurisdicciones fuera del Convenio del año (aviso de arriba);
  - saldos a favor de jurisdicciones del año anterior que no están en el año: en enero, `Los saldos a favor de X (importe) no pasan a AAAA porque la jurisdicción no está en el Convenio: quedan en la cuenta IIBB Saldo a favor`.
- El borrador con el mes anterior sin cerrar usa los saldos del borrador anterior y avisa, como la E37 (encadenando hasta el inicio).

## 5. Cierre, reapertura y bloqueo
- `PosicionIibb` (de empresa):
  - `{ id, empresaId, anio, mes, ingresos, detalle Json (por jurisdicción: coeficiente, alicuota, base, impuesto, retenciones, percepciones, saldoAnterior, aPagar, saldoAFavor), asientoId?, cerradoEn, cerradoPor }`;
  - única por `(empresaId, anio, mes)`.
- **Cerrar:**
  - mismas reglas que la E37: inicio configurado (`Configure el primer mes de la liquidación de IIBB`), mes no anterior al inicio, el anterior cerrado (`Cierre primero la liquidación de IIBB de MM/AAAA`), mes terminado y sin ventas pendientes de autorización en ARCA;
  - más las validaciones de §3;
  - advisory lock `posicion-iibb:<empresa>`.
- **Asiento** (fecha: último día del mes; neto por cuenta; renglones en cero omitidos):
  - Debe: `IIBB_IMPUESTO` (gasto) por el impuesto total;
  - Haber: `RETENCION_SUFRIDA_IIBB` y `PERCEPCION_IIBB` por las retenciones y percepciones del mes;
  - Haber y Debe: `IIBB_SALDO_A_FAVOR`, por el saldo anterior y el nuevo;
  - Haber: `IIBB_A_PAGAR` por la suma de los `aPagar`.

  Los saldos a favor no se compensan entre jurisdicciones en el cálculo, pero el asiento los suma en una cuenta.
- **Reabrir:** solo el último cerrado (`Reabra primero la liquidación de IIBB de MM/AAAA`), con contraasiento del último día del mes.
- **Bloqueo:**
  - el mes de IIBB cerrado bloquea lo mismo que el de IVA: confirmar y anular compras, emitir ventas y recibos;
  - además, crear y anular liquidaciones de tarjetas con impuestos de IIBB con fecha en el mes cerrado;
  - en recibos, la retención que se bloquea es la de IIBB (la de IVA ya la bloquea su posición);
  - el mensaje es `La liquidación de IIBB de MM/AAAA está cerrada: use una fecha de un mes abierto o reabra la liquidación`;
  - el guardia de la E37 se generaliza para mirar las dos posiciones, con el mismo lock compartido por cada una.

## 5 bis. Corrección de la posición de IVA (E37)
- La posición de IVA no toma hoy las retenciones y percepciones de IVA de las liquidaciones de tarjetas, aunque su asiento las registra en las mismas cuentas. Se suman a `retenciones` y `percepciones` del cálculo de IVA con el mismo criterio de §4, y el mes de IVA cerrado bloquea crear y anular liquidaciones de tarjetas con impuestos de IVA en ese mes.

## 6. Cuentas y conceptos
- Cuentas nuevas en el plan modelo y por migración (en empresas con la madre y sin el código):
  - `5.2.13 Impuesto sobre los ingresos brutos`;
  - `1.1.03.011 IIBB Saldo a favor`;
  - `2.1.02.007 IIBB a pagar`.
- Conceptos: `IIBB_IMPUESTO`, `IIBB_SALDO_A_FAVOR`, `IIBB_A_PAGAR`, con su `ConfigCuenta` para las empresas existentes.

## 7. Informe de ingresos por provincia
- `GET /api/impuestos/iibb/ingresos-por-provincia?anio` (`impuestos.ver`, con `?formato=xlsx|pdf`):
  - los ingresos gravados del año (criterio de §4), agrupados por la provincia del cliente;
  - `Tercero.provincia`, texto libre, se normaliza a la jurisdicción por nombre: tabla de nombres y variantes comunes (CABA, Capital Federal, Ciudad de Buenos Aires…), sin tildes ni mayúsculas;
  - sin provincia o no reconocida: «Sin provincia»;
  - columnas: jurisdicción, ingresos y porcentaje del total.
- Es la parte de ingresos del CM05; los gastos los atribuye el contador.

## 8. Pantallas
- **Impuestos → Liquidación de IIBB (Convenio Multilateral):**
  - año con los 12 meses y su estado;
  - el mes elegido, con los ingresos y una tabla por jurisdicción (coeficiente, base, alícuota, impuesto, retenciones, percepciones, saldo anterior, a pagar, saldo a favor) y totales;
  - avisos;
  - botones Cerrar, Reabrir, Excel, PDF y enlace al asiento.
- **Impuestos → Configuración:** el primer mes de IIBB y la tabla de jurisdicciones del año (jurisdicción, coeficiente, alícuota, actividad, saldo inicial) con la suma de coeficientes.
- **Impuestos → Ingresos por provincia:** el informe de §7.

## 9. No objetivos
- Cálculo del CM05 (gastos por jurisdicción).
- Varias actividades o alícuotas por jurisdicción.
- Regímenes especiales del Convenio (arts. 6 a 13).
- Contribuyentes locales de una sola jurisdicción.
- SIRCREB (retenciones bancarias), porque no hay datos bancarios de retenciones.
- Mínimos y anticipos especiales.
- Importación de retenciones y percepciones a SIFERE.
- Presentación automática.
- Ingresos exentos o no gravados de IIBB por actividad.

## 10. Casos a vigilar
- Una nota de crédito que deja los ingresos del mes negativos: impuesto negativo, que se trata como saldo a favor.
- Una jurisdicción con coeficiente 0 y retenciones.
- Coeficientes que no suman 1.
- Un año nuevo sin jurisdicciones cargadas.
- Los saldos a favor de jurisdicciones que dejan de estar en el año siguiente: se informan como aviso, no se arrastran y quedan en la cuenta.
- Retenciones y percepciones de IIBB de liquidaciones de tarjetas.
- Una jurisdicción nueva a mitad de año: no se puede (el `PUT` del año con meses cerrados da 400); entra con saldo cero el año siguiente.
- Facturas en dólares.
