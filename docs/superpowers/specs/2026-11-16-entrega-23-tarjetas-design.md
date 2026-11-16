# Entrega 23: Cobros con tarjeta

## 1. Objetivo y alcance

**Problema hoy:** los cobros (recibos de clientes e ingresos de valores) aceptan efectivo, cheques y transferencias, pero no tarjetas. Un comercio que cobra con tarjeta de crédito, débito o QR no sabe qué cupones tiene pendientes de acreditar. Tampoco sabe cuánto le descontó cada tarjeta en aranceles, IVA, retenciones y percepciones, ni contabiliza esos descuentos.

**Qué agrega esta entrega:**
- la tarjeta como medio de cobro, con cupones "a acreditar";
- un documento de liquidación de tarjeta que acredita el neto en el banco y contabiliza los descuentos.

**Criterio de éxito.** Con la demo:
- cobro una factura con dos cupones de Visa crédito (100.000 y 50.000);
- veo los cupones pendientes de Visa;
- cargo la liquidación: arancel 2.700 + IVA 567, retenciones IVA 1.500, Ganancias 1.000 e IIBB Buenos Aires 2.250, neto 141.983;
- el banco recibe 141.983, el asiento reparte los descuentos y los cupones quedan liquidados;
- el informe de costo muestra 5,34 % para Visa en el período.

**Decisiones tomadas con el usuario:**
- **Alcance:** cupones y liquidaciones manuales; la importación de archivos de las tarjetas queda para más adelante.
- **Diseño:** cartera de cupones y documento de liquidación, siguiendo el esquema de los cheques de terceros.

**No objetivos:**
- importar liquidaciones (Prisma, Fiserv, Mercado Pago);
- conciliación automática con el extracto (la conciliación bancaria existente cubre el movimiento del neto);
- contracargos;
- planes de cuotas con tasas a cargo del comercio;
- pagos a proveedores con tarjeta corporativa.

**Anti-objetivos:**
- liquidar dos veces un cupón;
- una liquidación cuyo asiento no cierre con el neto acreditado;
- anular un cobro dejando cupones ya liquidados sin respaldo.

## 2. Modelo

**`Tarjeta`:**
- Campos: `{ id, empresaId, nombre, tipo: CREDITO | DEBITO | QR, cuentaBancariaId, cuentaContableId (a cobrar), activa }`.
- Único `(empresaId, nombre)`.
- La cuenta bancaria debe ser en pesos.

**`CuponTarjeta`:**
- Campos: `{ id, empresaId, tarjetaId, ingresoId, fecha, lote?, numero?, cuotas Int default 1, importe, estado: PENDIENTE | LIQUIDADO | ANULADO, liquidacionId? }`.

**`LiquidacionTarjeta`:**
- Campos: `{ id, empresaId, numero (talonario LIQUIDACION_TARJETA), tarjetaId, fecha, referencia?, bruto, arancel, ivaArancel, costoFinanciero, ivaCostoFinanciero, neto, cuentaBancariaId, estado: CONFIRMADA | ANULADA, asientoId, asientoAnulacionId?, creadoPor, creadoEn }`.

**`LiquidacionTarjetaImpuesto`:**
- Campos: `{ id, empresaId, liquidacionId (cascade), clase: RETENCION | PERCEPCION, tipo: IVA | GANANCIAS | IIBB, jurisdiccion?, importe }`.
- Las percepciones solo pueden ser de IVA o IIBB.
- IIBB exige jurisdicción (`9dd`, como en los recibos).

**Cuentas nuevas en el plan modelo** (y, por migración, en las empresas existentes con el código libre):
- `1.1.02.003 Tarjetas a cobrar`;
- `5.2.12 Comisiones de tarjetas`.

**Demo:** Visa crédito, Mastercard crédito y Mercado Pago (QR), con la cuenta bancaria de la demo y `1.1.02.003`.

Los modelos nuevos van en `MODELOS_DE_EMPRESA`.

**Permisos:**
- **Maestro de tarjetas:** `tesoreria.maestros.editar`.
- **Liquidaciones:** el permiso nuevo `tesoreria.tarjetas` ("Liquidar tarjetas"), que en la demo tienen Administrador y Tesorero si existe, o los roles que hoy tienen `tesoreria.maestros.editar`.
- **Consultas:** el permiso de consulta de tesorería que ya existe.

## 3. Cobro con tarjeta

**Medio nuevo:** `esquemaIngreso` y `esquemaRecibo` suman `cupones: [{ tarjetaId, lote?, numero?, cuotas?, importe }]` (default `[]`).
- El total del cobro incluye los cupones.
- La tarjeta debe estar activa: `Tarjeta inexistente o inactiva`.

**Asiento del ingreso o del recibo:** cada cupón va al **debe** de la `cuentaContableId` de su tarjeta, junto con los demás medios.
- **Fecha:** la del cobro.
- **Movimiento de tesorería:** no se registra ninguno por los cupones (el dinero entra recién con la liquidación).

**Anular un ingreso o recibo con cupones:**
- si algún cupón está liquidado: 400 `El cupón N de <tarjeta> ya está liquidado: anule primero la liquidación N° X`;
- si no, los cupones pasan a `ANULADO`.

**Consulta de cupones:** `GET /api/tesoreria/cupones?tarjetaId&estado&desde&hasta` devuelve:
- cada cupón con su tarjeta, cliente (del ingreso), fecha, lote, número, cuotas, importe, estado y días desde el cobro;
- totales por tarjeta.

## 4. Liquidación de tarjeta

**`POST /api/tesoreria/liquidaciones-tarjeta`** con el cuerpo `{ tarjetaId, fecha, referencia?, cuponIds, arancel, ivaArancel, costoFinanciero?, ivaCostoFinanciero?, impuestos: [{ clase, tipo, jurisdiccion?, importe }], neto, cuentaBancariaId? }`. La cuenta bancaria es por defecto la de la tarjeta.

**Validaciones** (400):
- cupones de esa tarjeta, en estado `PENDIENTE`: `El cupón N no está pendiente`;
- al menos un cupón;
- importes ≥ 0;
- `bruto − arancel − ivaArancel − costoFinanciero − ivaCostoFinanciero − Σ impuestos = neto` al centavo: `La liquidación no cierra: diferencia $ X`;
- `neto > 0`;
- fecha en un período contable abierto.

**Concurrencia:** los cupones se bloquean (`FOR UPDATE`, ordenados) antes de validar.

**Efectos:**
- se graban la liquidación y sus impuestos;
- los cupones pasan a `LIQUIDADO` con `liquidacionId`;
- `MovimientoTesoreria` de **INGRESO** por el neto en la cuenta bancaria (`origenTipo 'LIQUIDACION_TARJETA'`).

**Asiento:**
- **Debe:**
  - la cuenta contable de la cuenta bancaria, por el neto;
  - `5.2.12`, por arancel + costo financiero;
  - `1.1.03.001` IVA Crédito Fiscal, por ivaArancel + ivaCostoFinanciero;
  - retenciones IVA, Ganancias e IIBB en `1.1.03.005`, `1.1.03.006` y `1.1.03.007`;
  - percepciones IVA e IIBB en `1.1.03.002` y `1.1.03.003`.
- **Haber:** la cuenta a cobrar de la tarjeta, por el bruto.
- **Resolución de cuentas:** cada una se busca por código. Si falta: `Falta la cuenta contable <código> <nombre>`.

**`POST /api/tesoreria/liquidaciones-tarjeta/:id/anular { motivo }`:**
- contraasiento con la fecha del día;
- movimiento de tesorería anulado;
- los cupones vuelven a `PENDIENTE`.

Si el movimiento bancario está conciliado, la anulación se rechaza con el mensaje que ya usa tesorería para movimientos conciliados.

**Listado:** `GET /api/tesoreria/liquidaciones-tarjeta?tarjetaId&desde&hasta` y `GET :id` (con cupones e impuestos).

## 5. Costo por tarjeta

**`GET /api/tesoreria/tarjetas/costo?desde&hasta`** devuelve, por tarjeta y con las liquidaciones confirmadas por fecha:
- bruto;
- arancel + costo financiero;
- IVA;
- retenciones y percepciones;
- neto;
- `costoPct = (arancel + costoFinanciero) / bruto × 100`, a 2 decimales;
- `descuentoTotalPct = (bruto − neto) / bruto × 100`.

Se exporta a Excel y PDF como los demás informes.

## 6. Web

**Maestros → Bancos y cajas:** pestaña "Tarjetas", con alta y edición.

**Cobros** (recibo de cliente e ingreso de valores): sección "Tarjetas" con renglones de tarjeta, lote, cupón, cuotas e importe, que suman al total.

**Tesorería → Tarjetas:**
- **Cupones a acreditar:** filtro por tarjeta y estado; totales; antigüedad en días.
- **Liquidaciones:**
  - **Nueva:** se elige la tarjeta y se tildan los cupones pendientes, con el bruto en vivo. Se cargan los descuentos, se agregan renglones de retenciones y percepciones y se carga el neto. Muestra la diferencia en vivo y no deja confirmar si no es cero.
  - **Lista:** con Anular.
- **Costo por tarjeta:** período, tabla y exportación.

## 7. Pruebas

### Ejemplo

Cupones de Visa crédito por 100.000 y 50.000 (bruto 150.000). La liquidación:

| Concepto | Importe |
|---|---|
| Arancel | 2.700,00 |
| IVA arancel | 567,00 |
| Retención IVA | 1.500,00 |
| Retención Ganancias | 1.000,00 |
| Retención IIBB (902) | 2.250,00 |
| **Neto** | **141.983,00** |

**Asiento:**

| Cuenta | Debe | Haber |
|---|---|---|
| Banco | 141.983,00 | |
| 5.2.12 Comisiones de tarjetas | 2.700,00 | |
| 1.1.03.001 IVA Crédito Fiscal | 567,00 | |
| 1.1.03.005 Retenciones IVA sufridas | 1.500,00 | |
| 1.1.03.006 Retenciones Ganancias sufridas | 1.000,00 | |
| 1.1.03.007 Retenciones IIBB sufridas | 2.250,00 | |
| 1.1.02.003 Tarjetas a cobrar | | 150.000,00 |
| **Totales** | **150.000,00** | **150.000,00** |

**Costo de Visa en el período:**
- `costoPct` 1,80;
- `descuentoTotalPct` 5,34 (8.017 / 150.000).

### API

- Recibo con cupones: asiento con debe en `1.1.02.003` y cupones pendientes.
- Ingreso de valores con cupones.
- Liquidación del ejemplo: asiento, movimiento y cupones liquidados.
- Diferencia de un centavo → 400.
- Cupón de otra tarjeta o ya liquidado → 400.
- Dos liquidaciones simultáneas del mismo cupón → una 201 y otra 400.
- Anular la liquidación: cupones pendientes y contraasiento.
- Anular un recibo con un cupón liquidado → 400; sin liquidar → cupones anulados.
- Consulta de cupones con totales.
- Costo por tarjeta.
- Permisos.
- Migración de cuentas.

### Web

- Renglones de cupones en el cobro (suman al total).
- Formulario de liquidación con diferencia en vivo y confirmar deshabilitado.

### E2E

El tesorero (o el administrador) cobra una factura con tarjeta, liquida los cupones y ve el neto en el banco.

## 8. Lo que queda al builder

- **Pantallas:** su distribución.
- **Errores:** textos de errores secundarios.
- **Rol de la demo:** a qué rol se le da el permiso nuevo, dentro de lo indicado en §2.

## 9. Decisiones del builder

Las tomé yo después de la revisión del diseño y se pueden corregir.

1. **Cuentas por configuración, no por código.**
   - IVA crédito fiscal, percepciones y retenciones sufridas se resuelven con la configuración de cuentas que ya usan los recibos (`IVA_CREDITO_FISCAL`, `PERCEPCION_IVA`, `PERCEPCION_IIBB` y `RETENCION_SUFRIDA_*`), así una empresa que las cambió usa las mismas para tarjetas.
   - Se agrega el concepto `COMISIONES_TARJETA`, por defecto `5.2.12`.
   - El error por cuenta faltante es el que ya da esa configuración.
2. **Cuenta a cobrar copiada en el cupón.** `CuponTarjeta.cuentaContableId` se graba al cobrar. La liquidación acredita, por cupón, la cuenta copiada. Así cambiar la cuenta de la tarjeta no deja saldos colgados.
3. **Sucursales.**
   - El cupón guarda `sucursalId` (la del ingreso).
   - Un usuario limitado a una sucursal ve y liquida solo los cupones de su sucursal, y el informe de costo se filtra igual.
   - Un usuario sin restricción puede liquidar cupones de varias sucursales juntos: una liquidación suele cubrir un número de comercio.
4. **Moneda.** Los cupones se cobran en pesos. Un cobro con cupones en una caja de otra moneda se rechaza: `Los cupones de tarjeta se cobran en pesos`.
5. **Otras decisiones:**
   - se admite un cobro solo con cupones;
   - el contraasiento de la anulación lleva la fecha posterior entre hoy y la de la liquidación;
   - no se controla la duplicación de lote o cupón (pueden repetirse entre tarjetas o días);
   - la columna IVA del informe es la del arancel y la del costo financiero.
