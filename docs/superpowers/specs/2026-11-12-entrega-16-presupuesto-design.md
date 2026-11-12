# Entrega 16 — Presupuesto contra real

## 1. Objetivo y alcance

La dirección carga un presupuesto mensual de ingresos y gastos por cuenta (y, si quiere, por centro de costo), lo reformula cuando hace falta sin perder el original, y ve en cualquier momento cuánto se desvió el real del Mayor, con el resultado presupuestado contra el real.

**Criterio de éxito.** Con la demo: creo "Original 2026", cargo ventas y gastos por mes (a mano, repartiendo un total anual, trayendo el real del ejercicio anterior o importando un Excel), lo marco como vigente; en *Presupuesto contra real* elijo enero–noviembre y veo por cuenta, por rubro o por centro de costo el presupuesto, el real, el desvío y si es favorable, con el resultado y un gráfico mensual; el tablero muestra la tarjeta "Resultado contra presupuesto".

**Decisiones tomadas con el usuario:**
- **Nivel:** cuenta imputable de resultados, con centro de costo opcional.
- **Versiones:** varios presupuestos por ejercicio, con nombre; uno vigente (el del tablero); se pueden copiar.
- **Diseño técnico:** un importe por mes y línea (tabla normalizada); real desde los renglones de asientos.

**Fuera de alcance:** presupuesto de cuentas patrimoniales, presupuesto financiero, comparación en moneda de hoy, circuitos de aprobación, presupuesto por artículo o cliente.

## 2. Modelo

- `Presupuesto { id, empresaId, ejercicioId, nombre, vigente Boolean default false, observaciones?, creadoPor, creadoEn, actualizadoEn }`; único `(empresaId, ejercicioId, nombre)`; a lo sumo uno vigente por ejercicio (marcar uno desmarca el resto, en la misma transacción).
- `PresupuestoImporte { id, empresaId, presupuestoId, cuentaContableId, centroCostoId?, anio, mes, importe Decimal(18,2) }`; único `(presupuestoId, cuentaContableId, centroCostoId, anio, mes)` (índice único con `COALESCE` del centro o equivalente); borrado en cascada con el presupuesto.
- Ambos modelos en `MODELOS_DE_EMPRESA`.
- **Validaciones (400):** cuenta imputable de tipo `RESULTADO_POSITIVO` o `RESULTADO_NEGATIVO` (`La cuenta <código> no es de resultados`); centro de costo activo de la empresa; `(anio, mes)` dentro del ejercicio (`El mes MM/AAAA no pertenece al ejercicio`); `importe ≥ 0`; ejercicio no cerrado para modificar (`El ejercicio está cerrado`).
- **Signo natural:** el importe es siempre positivo; ingreso presupuestado para cuentas de resultado positivo, gasto presupuestado para las de resultado negativo.

## 3. Carga

Módulo `apps/api/src/presupuestos/`. Permisos nuevos `presupuesto.ver` ("Ver presupuestos") y `presupuesto.editar` ("Editar presupuestos"); en la demo, Administrador y Contador.

- `GET /api/presupuestos?ejercicioId` → lista `{ id, ejercicio, nombre, vigente, observaciones, totalIngresos, totalEgresos, actualizadoEn }`.
- `POST /api/presupuestos { ejercicioId, nombre, observaciones?, copiarDeId? }` → crea (vacío o copia de los importes de otro presupuesto del mismo ejercicio).
- `PUT /api/presupuestos/:id { nombre, observaciones }`; `POST /api/presupuestos/:id/vigente`; `DELETE /api/presupuestos/:id` (no el vigente: `Marque otro presupuesto como vigente antes de eliminarlo`).
- `GET /api/presupuestos/:id/grilla` → `{ presupuesto, meses: ['AAAA-MM', …] (los del ejercicio), lineas: [{ cuentaContableId, codigo, nombre, tipo, centroCostoId, centroCosto, importes: { 'AAAA-MM': '0.00' }, total }], totales: { porMes, ingresos, egresos, resultado } }`, líneas ordenadas por código de cuenta y centro.
- `PUT /api/presupuestos/:id/lineas { cuentaContableId, centroCostoId?, importes: { 'AAAA-MM': number } }` → reemplaza los importes de esa línea (los meses ausentes quedan en 0; una línea toda en 0 se elimina). `DELETE /api/presupuestos/:id/lineas?cuentaContableId&centroCostoId`.
- **Repartir:** `POST /api/presupuestos/:id/lineas/repartir { cuentaContableId, centroCostoId?, total }` → partes iguales a 2 decimales en los meses del ejercicio, el último mes absorbe el redondeo (120.000 en 12 meses → 10.000 cada uno; 100.000 → 8.333,33 × 11 y 8.333,37).
- **Traer el real del ejercicio anterior:** `POST /api/presupuestos/:id/desde-real { ajustePct }` → para cada cuenta de resultados y centro con real en el ejercicio anterior, mes a mes (mes i del anterior → mes i de este), importe = real × (1 + ajustePct/100) redondeado, reemplazando todo el presupuesto. Sin ejercicio anterior: `No hay un ejercicio anterior`. Real negativo (p. ej. una cuenta de gastos con saldo acreedor) → 0.
- **Excel:** `GET /api/presupuestos/:id/exportar` (xlsx: `Cuenta`, `Centro de costo`, una columna por mes con su `MM/AAAA`, `Total`); `POST /api/presupuestos/:id/importar` (multipart `archivo`, xlsx o csv con la misma forma; columnas de mes por encabezado `MM/AAAA` o `AAAA-MM`; números con `numeroAR`). Reemplaza todos los importes; si hay errores no graba nada y responde 400 con `errores: [{ linea, mensaje }]` (`Cuenta inexistente: 9.9.99`, `La cuenta 1.1.01.001 no es de resultados`, `Centro de costo inexistente: XX`, `Importe inválido en 03/2026`, `Línea repetida`).

## 4. Presupuesto contra real

`GET /api/presupuestos/:id/comparacion?desde=AAAA-MM&hasta=AAAA-MM&agrupar=cuenta|rubro|centro&centroCostoId&formato=xlsx|pdf` (`presupuesto.ver`); `desde`/`hasta` dentro del ejercicio (por defecto el primer mes y el mes actual o el último del ejercicio).

- **Real** de cada (cuenta, centro): renglones de asientos del ejercicio con fecha en el rango, excluyendo tipos `REFUNDICION`, `CIERRE`, `APERTURA` y los de origen ajuste por inflación; resultado positivo = haber − debe; resultado negativo = debe − haber.
- **Emparejamiento:** la línea (cuenta, centro) se compara con el real de esa cuenta y ese centro; la línea (cuenta, sin centro), con el real de esa cuenta sin centro. El real de un (cuenta, centro) sin línea aparece con presupuesto 0 y la marca `sinPresupuesto: true`.
- **Agrupar:** `cuenta` (una fila por cuenta, sumando sus centros), `rubro` (cuenta antecesora de dos niveles, p. ej. `4.1`, `5.2`), `centro` (una fila por centro, `Sin centro` incluido). `centroCostoId` filtra antes de agrupar.
- **Fila:** `{ clave, nombre, tipo: 'INGRESO' | 'EGRESO', presupuesto, real, desvio (real − presupuesto), desvioPct (null si presupuesto 0), favorable (ingreso: real ≥ presupuesto; egreso: real ≤ presupuesto), sinPresupuesto }`. En `centro`, cada fila reúne ingresos y egresos: `tipo` = `RESULTADO`, presupuesto/real = resultado del centro, favorable si real ≥ presupuesto.
- **Totales:** `{ ingresos: { presupuesto, real, desvio, desvioPct }, egresos: {…}, resultado: {…} }` (resultado = ingresos − egresos).
- **Serie:** `serie: [{ mes, presupuesto, real }]` del resultado por mes del rango.
- **Exportación:** columnas Concepto, Presupuesto, Real, Desvío, Desvío %, filas y totales.

## 5. Tablero

`GET /api/informes/tablero` agrega `indicadores.presupuesto: { nombre, resultadoPresupuestado, resultadoReal, desvioPct } | null`: presupuesto vigente del ejercicio que contiene `desde`, meses de `desde` a `hasta` (recortados al ejercicio); `null` si no hay vigente o el usuario no tiene `presupuesto.ver`.

## 6. Web

- **Informes de gestión → Presupuestos** (`presupuesto.ver`; edición con `presupuesto.editar`): selector de ejercicio, lista con vigente, Nuevo (vacío o copia), Marcar vigente, Eliminar; al abrir uno, grilla editable (cuenta × meses, totales por fila/mes/general, resultado), Agregar línea (cuenta de resultados + centro opcional), Repartir total anual, Traer real del ejercicio anterior (% de ajuste), Importar y Exportar Excel.
- **Informes de gestión → Presupuesto contra real** (`presupuesto.ver`): presupuesto, desde/hasta, agrupar (Cuenta / Rubro / Centro de costo), filtro de centro; tabla con desvíos en verde (favorable) o rojo, filas sin presupuestar marcadas; totales de ingresos, egresos y resultado; gráfico de barras del resultado presupuestado contra real por mes; Excel y PDF.
- **Tablero:** tarjeta "Resultado contra presupuesto" (valor real, presupuestado y desvío) que lleva al informe.

## 7. Pruebas

**Ejemplo que fija el cálculo** (presupuesto de noviembre 2026; asientos manuales de noviembre):

| Línea | Presupuesto | Real | Desvío |
|---|---|---|---|
| 4.1.01 Ventas | 1.000.000,00 | 900.000,00 | −100.000,00 (−10,00 %) desfavorable |
| 5.2.01 Gastos generales, sin centro | 200.000,00 | 220.000,00 | +20.000,00 (+10,00 %) desfavorable |
| 5.2.01 Gastos generales, Rosario | 100.000,00 | 120.000,00 | +20.000,00 (+20,00 %) desfavorable |
| 5.2.01 Gastos generales, Córdoba (sin presupuestar) | 0,00 | 15.000,00 | +15.000,00 (—) desfavorable |
| **Resultado** | **700.000,00** | **545.000,00** | **−155.000,00 (−22,14 %)** |

Por cuenta: 5.2.01 presupuesto 300.000,00, real 355.000,00. Por centro: Rosario resultado presupuestado −100.000,00, real −120.000,00. Un asiento de ajuste por inflación sobre 4.1.01 no cambia el real.

- **API:** el ejemplo por cuenta, rubro y centro, con filtro de centro; validaciones de líneas; vigente único; copiar; eliminar el vigente rechazado; repartir (redondeo); traer real del anterior con ajuste; importar con errores por línea (nada grabado) y sin errores; exportar; permisos; tablero con y sin vigente.
- **Web:** grilla con totales; tabla de comparación con colores y fila sin presupuestar; tarjeta del tablero.
- **E2E:** el contador crea un presupuesto, reparte un total anual en Ventas, lo marca vigente y ve la comparación.
