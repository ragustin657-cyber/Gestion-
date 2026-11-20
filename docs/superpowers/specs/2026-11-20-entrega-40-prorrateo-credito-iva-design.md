# Entrega 40 — Prorrateo del crédito fiscal de IVA

## 1. Intención
Una empresa que vende cosas gravadas y exentas (o no gravadas) no puede computar todo el IVA de sus compras: el art. 13 de la Ley de IVA obliga a apropiar el crédito. El IVA de una compra que se usa solo para operaciones gravadas se computa entero; el de una compra que se usa solo para exentas no se computa; el de una compra de uso común se prorratea en la proporción de las ventas gravadas sobre el total. Hoy la posición de IVA (E37) computa todo el crédito. Esta entrega agrega el destino del crédito en cada compra, el coeficiente de prorrateo y su efecto en la posición mensual, el ajuste anual y el asiento del crédito no computable.

**Éxito:** el contador activa el prorrateo, marca las compras que son solo para exentas o de uso común (las demás siguen siendo para gravadas) y la posición de IVA del mes muestra el crédito computable, el no computable y el coeficiente; al cerrar, el no computable va a gasto. En el último mes del ejercicio la posición recalcula con el coeficiente anual y ajusta la diferencia.

**Anti-objetivos:**
- cambiar la posición de una empresa que no activa el prorrateo;
- prorratear compras que el usuario no marcó (por defecto todo es para gravadas, como hoy);
- que un mes cerrado cambie por un cambio de destino de una compra.

## 2. Enfoques
1. **Elegido:** destino por comprobante de compra (gravado, exento, común), coeficiente acumulado del ejercicio en cada mes y ajuste anual en el último mes, como pide la RG 3349 / art. 13.
2. Coeficiente fijo cargado por el contador (más simple, pero no es lo que pide la norma y deja el ajuste a mano).
3. Destino por renglón de la compra (más fino, pero multiplica la carga; se puede agregar después).

## 3. Configuración y datos
- `ConfigImpuestos`:
  - `prorrateoIva Boolean @default(false)`;
  - `prorrateoDesdeAnio Int?`, `prorrateoDesdeMes Int?`: el primer mes con prorrateo. Los meses anteriores (cerrados o no) no se tocan;
  - `prorrateoInicioMes Int @default(1)`: el mes en que empieza el ejercicio fiscal para el coeficiente acumulado (1 = año calendario);
  - `prorrateoGravadasIniciales` y `prorrateoExentasIniciales` (`Decimal(18,2) @default(0)`): las ventas gravadas y las exentas y no gravadas del ejercicio fiscal anteriores al primer mes con prorrateo (cuando el prorrateo o el sistema empiezan a mitad del ejercicio). Solo se usan en el ejercicio que contiene ese mes.
- **Activar, desactivar o cambiar el inicio:** con posiciones de IVA cerradas en el mes desde o después, 400 (§6). Las cerradas antes no impiden. Desactivar a mitad de año deja ese ejercicio sin ajuste anual.
- `ComprobanteCompra.destinoCreditoIva DestinoCreditoIva @default(GRAVADO)` (enum `GRAVADO`, `EXENTO`, `COMUN`).
  - Se elige al cargar la compra (solo se muestra con el prorrateo activo).
  - Se puede cambiar en una compra confirmada con un endpoint propio (`PATCH /api/compras/comprobantes/:id/destino-iva`), salvo que su mes de IVA esté cerrado (`verificarMesIvaAbierto` de la E37).
- Cuenta nueva `5.2.14 IVA crédito fiscal no computable` y concepto `IVA_NO_COMPUTABLE` (total de conceptos 49), en el plan modelo y por migración.

## 4. Coeficiente
- **Ventas del período** (en pesos, NC restan, ambiente vigente, mismo criterio que el Libro IVA Ventas):
  - gravadas = neto gravado (incluye alícuota 0 % si existiera como gravada);
  - exentas y no gravadas = exento + no gravado.
- **Coeficiente del mes** = gravadas / (gravadas + exentas y no gravadas), acumulado desde el primer mes del ejercicio fiscal hasta el mes inclusive, redondeado a 4 decimales.
  - En el ejercicio que contiene el primer mes con prorrateo, el acumulado empieza en ese mes y suma los importes iniciales de §3 (las ventas anteriores no se leen del sistema).
  - Sin ventas en el acumulado: coeficiente 1 (todo computable) con aviso `Sin ventas en el ejercicio: el crédito de uso común se computa entero`.
  - El coeficiente queda entre 0 y 1 (con NC que dejan negativos se acota).

## 5. Posición mensual de IVA (cambia la E37)
- Con el prorrateo activo, el crédito del mes se separa por destino:
  - `creditoGravado` = IVA de compras `GRAVADO` (entero);
  - `creditoExento` = IVA de compras `EXENTO` (no computable);
  - `creditoComun` = IVA de compras `COMUN`;
  - `creditoComputable` = creditoGravado + creditoComun × coeficiente;
  - `creditoNoComputable` = creditoExento + creditoComun × (1 − coeficiente).
- El saldo técnico usa `creditoComputable` en lugar del crédito total.
- **Ajuste anual** (en el último mes del ejercicio fiscal, si el prorrateo sigue activo): se recalcula el crédito común de los meses del ejercicio con prorrateo con el coeficiente anual; la diferencia contra lo computado en esos meses anteriores (cerrados) se suma (o resta) al crédito computable del mes y se muestra en su renglón `Ajuste anual del prorrateo`.
- `creditoComputable` y `creditoNoComputable` incluyen el ajuste (siempre suman el crédito total del mes); `ajusteProrrateo` se guarda aparte para mostrarlo. El no computable puede quedar negativo por el ajuste.
- `PosicionIva` guarda `coeficiente`, `creditoComputable`, `creditoNoComputable`, `creditoComun` y `ajusteProrrateo` (nulos sin prorrateo).
- **Asiento de liquidación:** el IVA crédito fiscal se sigue cancelando entero; `creditoNoComputable` va al Debe de `IVA_NO_COMPUTABLE` (al Haber si es negativo). Cuadra por construcción.
- **Libro IVA Digital:** el campo de crédito computable sigue siendo el IVA de cada compra; con el prorrateo activo, la generación avisa `Con prorrateo del crédito fiscal: declare el prorrateo global en el Libro IVA Digital (coeficiente X)` (dato a verificar con ARCA, §2 de pendientes).
- La pantalla de la posición muestra el desglose, el coeficiente y el ajuste; el Excel/PDF los incluye.

## 6. Mensajes
- `La posición de IVA de MM/AAAA está cerrada: use una fecha de un mes abierto o reabra la posición` (E37) al cambiar el destino de una compra de un mes cerrado.
- `Hay posiciones de IVA cerradas desde MM/AAAA: reábralas para cambiar el prorrateo` al activar o desactivar el prorrateo, o cambiar su primer mes, el inicio del ejercicio o los importes iniciales, con posiciones cerradas en el primer mes con prorrateo o después.
- `Sin ventas en el ejercicio: el crédito de uso común se computa entero`.

## 7. Pantallas
- Configuración de impuestos: interruptor *Prorrateo del crédito fiscal*, *Primer mes con prorrateo*, *Primer mes del ejercicio fiscal* y las ventas gravadas y exentas del ejercicio anteriores a ese mes.
- Factura de compra: selector *Destino del crédito de IVA* (gravadas, exentas, uso común) cuando el prorrateo está activo; en la consulta de la compra confirmada, el mismo selector editable.
- Libro IVA Compras: columna *Destino* (G, E, C) con el prorrateo activo.
- Posición de IVA: renglones de crédito computable, no computable, coeficiente y ajuste anual.

## 8. No objetivos
- Destino por renglón.
- Prorrateo de bienes de uso con reintegro por cambio de destino (art. 13 último párrafo).
- Coeficiente por actividad.
- F.2002: la presentación sigue siendo manual con los números de la pantalla.

## 9. Casos a vigilar
- Empresa sin prorrateo: la posición no cambia.
- Mes con ventas solo exentas: coeficiente 0, el común no se computa.
- Ejercicio fiscal que no empieza en enero (inicio en julio: el acumulado de agosto toma julio y agosto).
- Ajuste anual con meses anteriores sin prorrateo (activado a mitad de año): el ajuste toma solo los meses con prorrateo.
- Nota de crédito de compra marcada como común: resta crédito común.
- Cambio de destino de una compra de un mes abierto: la posición borrador cambia.
