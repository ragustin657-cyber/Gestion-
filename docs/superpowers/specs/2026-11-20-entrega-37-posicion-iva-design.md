# Entrega 37 — Posición mensual de IVA

## 1. Intención
El sistema tiene los libros de IVA, el Libro IVA Digital y las retenciones y percepciones sufridas, pero no calcula el saldo del mes. Esta entrega cierra el circuito del IVA mensual. Cada mes da el impuesto a pagar o el saldo a favor, con los renglones ordenados como el F.2002 para comparar con el Portal IVA. Además deja asentada la liquidación en la contabilidad.

**Éxito:** el contador abre un mes, ve débito y crédito por alícuota, los saldos anteriores, las retenciones y percepciones y el resultado. Lo cierra, se genera el asiento de liquidación, y el mes siguiente arranca con el saldo a favor arrastrado.

**Anti-objetivos:**
- que un comprobante cargado tarde en un mes ya cerrado cambie el resultado cerrado;
- que el saldo a favor se cuente dos veces;
- que la posición no cuadre con los libros de IVA del mismo mes.

## 2. Enfoques
1. **Elegido — posición mensual con cierre:** borrador calculado en el momento; al cerrar se congelan los importes, se arrastran los saldos y se genera el asiento.
2. Solo una consulta: no arrastra saldos de forma confiable.
3. Con cierre pero sin asiento: le deja al contador un asiento manual por mes.

## 3. Fuentes del mes (del 1 al último día)
- **Débito fiscal por alícuota:** los totales `ivaPorAlicuota` del Libro IVA Ventas del mes (`LibroVentasService.libro`), con las notas de crédito restando, como ya hace el libro.
- **Crédito fiscal por alícuota:** los totales `ivaPorAlicuota` del Libro IVA Compras del mes (el mismo servicio del endpoint `libro-iva-compras`).
- **Percepciones de IVA sufridas:** total de `percepcionIva` del Libro IVA Compras del mes.
- **Retenciones de IVA sufridas:** suma de `ReciboRetencion` de tipo `IVA` con `fecha` en el mes, de recibos no anulados.
- **Avisos de cuadre:** los mismos `cuadre` de débito y crédito que ya usan los libros, contra el mayor.

## 4. Cálculo (importes a 2 decimales)
- `saldoTecnico = debito − credito − saldoTecnicoAnterior`.
- Si `saldoTecnico ≤ 0`:
  - `saldoTecnicoAFavor = −saldoTecnico`;
  - `impuestoDeterminado = 0`;
  - las retenciones y percepciones del mes y el saldo de libre disponibilidad anterior pasan enteros como libre disponibilidad.
- Si `saldoTecnico > 0`:
  - `saldoTecnicoAFavor = 0`;
  - `impuestoDeterminado = saldoTecnico`.
- `saldoAPagar = impuestoDeterminado − retenciones − percepciones − libreAnterior`.
  - Si es `> 0`: `impuestoAPagar = saldoAPagar` y `libreDisponibilidad = 0`.
  - Si no: `impuestoAPagar = 0` y `libreDisponibilidad = −saldoAPagar`.
- Saldos anteriores:
  - Primer mes: los saldos iniciales cargados (§5).
  - Resto: los saldos `saldoTecnicoAFavor` y `libreDisponibilidad` del mes anterior **cerrado**.
  - Si el mes anterior no está cerrado, el borrador se calcula con los saldos que da su borrador y avisa: `El mes anterior no está cerrado: los saldos anteriores pueden cambiar`.

## 5. Datos
- `ConfigImpuestos` agrega:
  - `ivaInicioAnio Int?` e `ivaInicioMes Int?`: el primer mes que se liquida en el sistema;
  - `ivaSaldoTecnicoInicial Decimal(18,2) @default(0)` e `ivaSaldoLibreInicial Decimal(18,2) @default(0)`: los saldos a favor al inicio de ese mes.
- `PosicionIva` (de empresa, en `MODELOS_DE_EMPRESA`):
  - `{ id, empresaId, anio, mes, estado BORRADOR | CERRADA, debito Json (por alícuota), credito Json (por alícuota), totalDebito, totalCredito, saldoTecnicoAnterior, libreAnterior, retenciones, percepciones, saldoTecnicoAFavor, impuestoDeterminado, impuestoAPagar, libreDisponibilidad, asientoId?, cerradoEn?, cerradoPor? }`;
  - única por `(empresaId, anio, mes)`;
  - la fila se crea al cerrar; el borrador no se guarda.

## 6. Cierre y reapertura
- **Cerrar:**
  - Requiere los saldos iniciales configurados: `Configure el primer mes y los saldos iniciales de IVA`.
  - El mes tiene que ser igual o posterior al de inicio: `El mes es anterior al inicio de la liquidación de IVA en el sistema`.
  - El mes anterior tiene que estar cerrado, salvo que sea el de inicio: `Cierre primero la posición de IVA de MM/AAAA`.
  - Solo un mes terminado: `Solo se cierra un mes terminado`.
- Al cerrar se guardan los importes del momento y se genera el asiento con fecha del último día del mes. El período contable tiene que estar abierto; si no, vale el error existente del asiento.
- **Asiento de liquidación:**

  | Lado | Cuenta (concepto) | Importe |
  |---|---|---|
  | Debe | `IVA_DEBITO_FISCAL` | total débito |
  | Haber | `IVA_CREDITO_FISCAL` | total crédito |
  | Haber | `PERCEPCION_IVA` | percepciones |
  | Haber | `RETENCION_SUFRIDA_IVA` | retenciones |
  | Haber | `IVA_SALDO_TECNICO` | saldo técnico anterior |
  | Haber | `IVA_LIBRE_DISPONIBILIDAD` | libre anterior |
  | Debe | `IVA_SALDO_TECNICO` | saldo técnico a favor nuevo |
  | Debe | `IVA_LIBRE_DISPONIBILIDAD` | libre disponibilidad nueva |
  | Haber | `IVA_A_PAGAR` | impuesto a pagar |

  Los renglones en cero se omiten. Cuadra por construcción.
- **Reabrir:**
  - solo si el mes siguiente no está cerrado: `Reabra primero la posición de IVA de MM/AAAA`;
  - anula el asiento con contraasiento y borra la fila.
- **Concurrencia:** cerrar y reabrir bloquean por empresa, con un advisory lock `posicion-iva:<empresa>`.

## 7. Cuentas y conceptos
- Cuentas nuevas en el plan modelo:
  - `1.1.03.009 IVA Saldo técnico a favor`;
  - `1.1.03.010 IVA Saldo de libre disponibilidad`;
  - `2.1.02.006 IVA a pagar`.

  La migración las crea en cada empresa que tenga la cuenta madre y no tenga el código.
- Conceptos nuevos en `CONCEPTOS_CUENTA`: `IVA_SALDO_TECNICO`, `IVA_LIBRE_DISPONIBILIDAD` e `IVA_A_PAGAR`. La migración agrega sus `ConfigCuenta` en las empresas existentes.

## 8. API y permisos
- `GET /api/impuestos/posicion-iva?anio&mes` (`impuestos.ver`): la posición del mes. Si está cerrada, la guardada; si no, el borrador calculado. Devuelve `estado`, los importes de §4, `debito` y `credito` por alícuota, los `avisos` y el `asientoId`.
- `GET /api/impuestos/posicion-iva/meses?anio` (`impuestos.ver`): los 12 meses con su estado y su `impuestoAPagar` o saldo a favor (cerrados) o nada (sin cerrar).
- `POST /api/impuestos/posicion-iva/:anio/:mes/cerrar` y `.../reabrir` (`impuestos.presentar`).
- `GET` y `PUT /api/impuestos/config` (lo existente) agregan los cuatro campos de inicio. El inicio no se puede cambiar si hay meses cerrados: `Hay posiciones de IVA cerradas: reábralas para cambiar el inicio`.
- `?formato=xlsx|pdf` en el GET del mes: el detalle para bajar.

## 9. Pantalla
- Impuestos → **Posición de IVA**:
  - selector de año con los 12 meses y su estado;
  - el mes elegido, con un bloque de débito fiscal por alícuota, otro de crédito fiscal por alícuota y luego, en este orden, saldo técnico anterior, saldo técnico, retenciones y percepciones, libre disponibilidad anterior y resultado (*Impuesto a pagar* o *Saldo de libre disponibilidad*);
  - los avisos;
  - los botones *Cerrar*, *Reabrir*, *Excel* y *PDF*, y el enlace al asiento.
- En Impuestos → Configuración: el primer mes y los dos saldos iniciales.

## 10. No objetivos
Prorrateo del crédito fiscal; percepciones practicadas; exportaciones y reintegros; débito por operaciones con no categorizados; restitución de débito y crédito por operaciones de períodos anteriores fuera de las NC; pagos a cuenta, VEP e intereses; presentación automática en ARCA; regímenes especiales (IVA diferido, sectoriales).

## 11. Casos a vigilar
- Una nota de crédito de compra que deja el crédito del mes negativo: el crédito total puede ser negativo y el cálculo lo resta igual.
- Un mes sin movimientos se cierra con todo en cero y arrastra los saldos.
- Un comprobante cargado tarde en un mes cerrado: la posición cerrada no cambia, y el borrador muestra un aviso si el libro del mes ya no coincide con lo guardado.
- Reabrir después de que se cerró el mes siguiente: no se permite.
- Facturas en dólares: el libro ya las lleva a pesos.
