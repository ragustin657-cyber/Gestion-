# Entrega 45 — Ajuste por inflación impositivo

## 1. Intención
El sistema tiene el ajuste por inflación **contable** (reexpresión de estados, RECPAM, asiento). Para la DJ de Ganancias de sociedades (entrega 46) hace falta el **ajuste por inflación impositivo** del Título VI de la ley (arts. 105 a 118): un importe positivo (ganancia) o negativo (pérdida) que se suma al resultado impositivo del ejercicio. Sigue otras reglas que el contable y no se contabiliza.

**Éxito:**
- El contador elige un ejercicio y ve el ajuste impositivo: el estático (activo computable menos pasivo al inicio), el dinámico (aportes, retiros y dividendos; compras y ventas de bienes excluidos) y las partidas que cargó a mano, con el total y si corresponde aplicarlo (prueba de la inflación de 36 meses).
- La entrega 46 usa el mismo cálculo para la DJ.

**No objetivos:** no genera asientos; no toca el ajuste contable; no valúa impositivamente cada activo (bienes de cambio, moneda extranjera, etc.): esas diferencias se cargan como partidas manuales.

## 2. Enfoques
1. **Elegido: calculado desde el Mayor con la clasificación de las cuentas, más partidas manuales.** Cada cuenta de activo y de pasivo se marca como computable o excluida; el estático sale de los saldos al inicio y el dinámico de los asientos del ejercicio. Lo que el Mayor no refleja bien (valuaciones impositivas distintas, movimientos que no se identifican solos) se corrige con partidas manuales. Una función pura (`ajusteImpositivo`) hace el cálculo y la reutiliza la entrega 46.
2. Todo manual (el contador carga activo, pasivo y movimientos): simple, pero repite lo que ya está en el Mayor y es fácil equivocarse.
3. Derivarlo del ajuste contable: no son equivalentes (el contable reexpresa partidas no monetarias; el impositivo ajusta el patrimonio computable), así que no sirve.

## 3. Clasificación de cuentas
- `CuentaContable.ajusteImpositivo` (enum `AjusteImpositivoCuenta { COMPUTABLE EXCLUIDO }`, por defecto `COMPUTABLE`), solo con sentido en cuentas de `ACTIVO` y `PASIVO`.
  - Activo **excluido** (art. 106 inc. a): bienes de uso e inmuebles (con sus amortizaciones acumuladas), intangibles, acciones y participaciones en sociedades, gastos de organización, saldos deudores de socios y dueños, y otros que diga el contador.
  - Pasivo **excluido**: previsiones no deducibles y lo que diga el contador.
- Migración: se marcan `EXCLUIDO` las cuentas de valor de origen y de amortización acumulada de los rubros de bienes de uso existentes; el plan modelo las crea así.
- Se edita en el plan de cuentas (*Contabilidad › Plan de cuentas*, ficha de la cuenta, permiso `plancuentas.editar`).

## 4. Cálculo (ejercicio E, con meses de cierre: anterior A y actual C)
- **Coeficiente** de un mes m: `I(C) / I(m) − 1` (variación del IPC de *Contabilidad › Índices*).
- **Estático:** `base = activo computable − pasivo computable` al inicio de E.
  - Saldos al inicio *(decisión mía)*: los del Mayor **nominales**, es decir la suma de los renglones con fecha anterior al inicio de E, **sin** los asientos de cierre, de apertura ni de ajuste por inflación contable (tipo `AJUSTE_INFLACION` u origen `AJUSTE_INFLACION`), **más la apertura inicial del sistema**: los asientos de apertura del primer ejercicio cargado y, si el ajuste contable tiene configurado un asiento manual de apertura en ese ejercicio (`ConfigAjusteInflacion.asientoAperturaId`), ese asiento. Así el cierre y la apertura de cada año (que además arrastran la reexpresión contable) no se cuentan dos veces. Si no hay apertura inicial, los saldos arrancan en cero. Las cuentas se suman con su signo (activo deudor positivo, pasivo acreedor positivo).
  - `ajuste estático = − base × (I(C) / I(A) − 1)`: si el activo computable supera al pasivo, ajuste **negativo**; si no, **positivo**.
- **Dinámico** (por asiento del ejercicio, automáticos y manuales; sin apertura, cierre, refundición ni ajustes por inflación contables, ni la apertura inicial del sistema aunque sea un asiento manual):
  - **Patrimonio neto:** `N = Σ (haber − debe)` de las cuentas de patrimonio neto del asiento. `N > 0` es un **aporte** → ajuste negativo `N × coef(mes del asiento)`; `N < 0` es un **retiro o dividendo** → ajuste positivo `|N| × coef`. Los asientos que solo reclasifican dentro del patrimonio neto dan 0. *(Decisión mía)* Otros movimientos del patrimonio neto que no son aportes ni retiros (por ejemplo, ajustes de resultados de ejercicios anteriores) aparecen igual en la lista del dinámico con su asiento; el contador los compensa con una partida manual dinámica. No se agregan marcas por cuenta ni por asiento.
  - **Bienes excluidos:** `E = Σ (debe − haber)` de las cuentas de activo excluidas del asiento, sin los asientos de amortización (`origenTipo AMORTIZACION`). `E > 0` es una **compra o incorporación** → ajuste positivo `E × coef`; `E < 0` es una **venta o baja** → ajuste negativo `|E| × coef` (por el valor neto que sale del Mayor).
- **Partidas manuales** (`AjusteImpositivoPartida`, por ejercicio): concepto, tipo (`ACTIVO_INICIO`, `PASIVO_INICIO` o `DINAMICO`), fecha (solo dinámicas), importe con signo.
  - `ACTIVO_INICIO` y `PASIVO_INICIO` suman o restan a la base del estático (por ejemplo, la diferencia de valuación impositiva de bienes de cambio).
  - `DINAMICO`: importe positivo = movimiento que da ajuste positivo (retiro, compra de excluido); negativo = el contrario; se ajusta con el coeficiente de su mes.
  - Permiso `impuestos.presentar` para cargarlas. *(Decisión mía)* Se pueden cargar con el ejercicio contable cerrado (el trabajo de la DJ se hace después del cierre); el bloqueo por DJ presentada llega con la entrega 46.
- **Total** = estático + dinámico + manuales, redondeado a 2 decimales (cada línea a 2 decimales).
- **¿Corresponde?** (art. 106, último párrafo): la variación del IPC de los 36 meses anteriores al cierre (`I(C) / I(C − 36) − 1`) supera el 100 %. Si no, el total que usará la DJ es 0 y se muestra `No corresponde aplicar el ajuste: la variación de los últimos 36 meses es <x> %`. El detalle se muestra igual.
- **Imputación:** 100 % en el ejercicio (ejercicios iniciados desde el 1/1/2021). Las fracciones de 2019 y 2020 (sextos) quedan fuera de alcance.
- Índices faltantes (A, C, C − 36 y los meses de los movimientos): `Faltan los índices de: mm/aaaa, …`.

## 5. Planilla (`GET /api/impuestos/ajuste-inflacion?ejercicioId=`, permiso `impuestos.ver`, Excel con `formato=xlsx`)
- Estático: por cuenta computable con saldo (código, nombre, tipo, saldo al inicio), totales de activo y pasivo, partidas manuales de inicio, base, coeficiente y ajuste.
- Dinámico: por movimiento (fecha, asiento N°, descripción, tipo: aporte, retiro, compra o venta de excluido, partida manual), importe, coeficiente y ajuste.
- Variación de 36 meses, si corresponde, total del ajuste y el que va a la DJ.
- Partidas manuales: `GET/POST/PUT/DELETE /api/impuestos/ajuste-inflacion/partidas` (por ejercicio).

## 6. Pantallas
- *Impuestos › Ajuste por inflación impositivo*: elegir ejercicio; resumen (estático, dinámico, manuales, total, corresponde o no); tablas del estático y del dinámico; partidas manuales con alta, edición y baja; exportar a Excel.
- Ficha de la cuenta del plan de cuentas: *Ajuste impositivo* (computable o excluida) para activo y pasivo.

## 7. Fuera de alcance
- Valuación impositiva automática de cada rubro (bienes de cambio, moneda extranjera, títulos): va como partida manual.
- Fracciones de los ejercicios 2019 y 2020.
- La DJ (entrega 46).

## 8. Datos a verificar (van a `docs/pendientes.md` §2)
- Lista de activos excluidos del art. 106 y si las previsiones van al pasivo.
- Que la prueba de los 36 meses use el IPC del sistema (mes de cierre contra 36 meses antes).
- Signo y momento del ajuste dinámico de dividendos (puesta a disposición) y de las ventas de bienes excluidos (costo impositivo vs. valor neto contable).
