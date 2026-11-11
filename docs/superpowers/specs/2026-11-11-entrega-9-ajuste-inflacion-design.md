# Entrega 9 — Ajuste por inflación contable (RT 6 / RT 54)

## 1. Objetivo y alcance

El contador genera desde el sistema el asiento de ajuste por inflación contable (método directo, RT 6), sin planillas externas, a cualquier fin de mes, y no puede cerrar un ejercicio ajustable sin el ajuste al cierre.

**Criterio de éxito.** Con índices cargados y una empresa con apertura, ventas y compras:
1. la vista previa por cuenta (saldo contable, reexpresado, ajuste) y el RECPAM, en pantalla y en Excel;
2. el asiento de ajuste a fin de un mes, y otro posterior que solo agrega lo que falta;
3. el primer ejercicio ajustado con la reexpresión de la apertura contra Resultados no asignados;
4. el cierre bloqueado hasta que el ajuste al cierre esté vigente y al día;
5. los estados contables con el comparativo reexpresado.

**Decisiones tomadas con el usuario:**
- **Método:** directo sobre el Mayor; las cuentas no monetarias se reexpresan movimiento por movimiento con el índice de cada mes; contrapartida RECPAM; más la reexpresión de los saldos iniciales del primer ejercicio que se ajusta.
- **Frecuencia:** a elección, en cualquier fin de mes; cada asiento agrega la diferencia respecto de lo ya ajustado.
- **Índices:** tabla mensual global (IPC FACPCE), cargada por el administrador general a mano o por CSV. Sin valores precargados.
- **Diseño técnico:** una única función de cálculo sin efectos, usada por la vista previa, el asiento y el control del cierre. Se recalcula desde el inicio del ejercicio (no desde el último ajuste), de modo que un asiento cargado después con fecha anterior al último ajuste se recoge en el próximo.

**Fuera de alcance:** índices precargados; ajuste impositivo (Ganancias, Título VI); estados reexpresados sin generar el asiento (lo cubre la vista previa); segregación de componentes financieros implícitos; valuación a valores corrientes (bienes de cambio a reposición); método indirecto.

## 2. Índices

**Modelo global** (no está en `MODELOS_DE_EMPRESA`): `IndiceInflacion { id, anio, mes, valor Decimal(18,6), actualizadoPor, actualizadoEn }`, único por `(anio, mes)`. `valor > 0`.

**Endpoints:**
- `GET /api/indices-inflacion` — cualquier usuario autenticado; lista ordenada por período descendente.
- `PUT /api/indices-inflacion/:anio/:mes { valor }` — `@SoloSuperadmin()`; crea o actualiza.
- `DELETE /api/indices-inflacion/:anio/:mes` — `@SoloSuperadmin()`.
- `POST /api/indices-inflacion/importar` (multipart, campo `archivo`) — `@SoloSuperadmin()`. CSV de dos columnas separadas por `;` o `,`: período (`AAAA-MM` o `MM/AAAA`) y valor (punto o coma decimal; con coma decimal el separador de columnas es `;`). Se ignora una primera línea que no tenga período válido (encabezado) y las líneas vacías. Todo o nada: ante una línea inválida responde 400 `Línea N: <motivo>` sin guardar nada. Respuesta `{ creados, actualizados }`.

**Faltantes.** Si el cálculo necesita un mes sin índice responde 400 `Faltan los índices de: 06/2025, 02/2026` (meses ordenados, sin repetir).

## 3. Plan de cuentas

**Campos nuevos en `CuentaContable`:**
- `monetaria Boolean @default(true)`.
- `cuentaAjusteId String? @db.Uuid` — cuenta donde se registra el ajuste de esta (relación consigo misma).

**Migración de datos** para las cuentas existentes: `monetaria = false` para tipo `PATRIMONIO_NETO`, `RESULTADO_POSITIVO`, `RESULTADO_NEGATIVO`, y para el código `1.2.01` y sus descendientes; el resto queda en `true`. En cada empresa que tenga la cuenta madre y no tenga el código:
- `3.1.02 Ajuste de capital` (PN, imputable, no monetaria); se asigna como `cuentaAjusteId` de `3.1.01` si existe;
- `4.2.03 Resultado por exposición a la inflación (RECPAM)` (RP, imputable, no monetaria).

El plan modelo (`plan-cuentas-modelo.ts`) incorpora las dos cuentas, el campo `monetaria` con la misma regla y el vínculo 3.1.01 → 3.1.02.

**Conceptos nuevos** en `CONCEPTOS_CUENTA`: `RECPAM: '4.2.03'`, `RESULTADOS_NO_ASIGNADOS: '3.2.01'`. La migración los precarga en las empresas que tengan esas cuentas.

**Alta y edición.** Una cuenta nueva toma `monetaria` de su madre (si no se envía). `PUT` de la cuenta acepta `monetaria` y `cuentaAjusteId`. Validaciones de `cuentaAjusteId` (400):
- `La cuenta de ajuste debe ser imputable y no monetaria`;
- `La cuenta de ajuste no puede ser la misma cuenta`;
- `La cuenta de ajuste ya ajusta a la cuenta <código>` (cada cuenta de ajuste sirve a una sola cuenta);
- `Una cuenta de ajuste no puede tener a su vez cuenta de ajuste`;
- solo se permite en cuentas no monetarias: `Solo las cuentas no monetarias tienen cuenta de ajuste`.

## 4. Configuración por empresa

`ConfigAjusteInflacion { empresaId @unique, primerEjercicioId, asientoAperturaId?, actualizadoPor, actualizadoEn }` y `AnticuacionApertura { id, empresaId, cuentaContableId, anio, mes, importe Decimal(18,2) }` único por `(empresaId, cuentaContableId, anio, mes)`. `importe` con signo: positivo = deudor.

- **Primer ejercicio ajustado.** Sin configuración la empresa no ajusta (los endpoints de ajuste responden 400 `Configure el ajuste por inflación`; el cierre no lo exige).
- **Asiento de apertura del primer ejercicio.** Por defecto, los asientos de tipo `APERTURA` del ejercicio. Si la empresa cargó su apertura con un asiento manual, se elige ese asiento (`asientoAperturaId`; debe pertenecer al primer ejercicio y no estar anulado).
- **Anticuación.** Para el primer ejercicio, por cuenta no monetaria con saldo de apertura (excepto la de `RESULTADOS_NO_ASIGNADOS`): tramos `(mes de origen, importe)`. Mes de origen anterior al inicio del ejercicio. Por cuenta, los tramos deben tener el signo del saldo de apertura y su suma, en valor absoluto, no superarlo: `La anticuación de <código> supera su saldo de apertura`. Lo no anticuado se toma originado en el mes anterior al inicio (coeficiente 1) y se avisa: `<código>: <importe> sin anticuar, se toma al inicio del ejercicio`.

**Endpoints** (`contabilidad.cerrar` para escribir, `plancuentas.ver` para leer):
- `GET /api/contabilidad/ajuste-inflacion/config` → `{ primerEjercicioId, asientoAperturaId, anticuacion: [{ cuentaContableId, codigo, nombre, saldoApertura, tramos: [{ anio, mes, importe }] }] }` (lista todas las cuentas no monetarias con saldo de apertura en el primer ejercicio).
- `PUT /api/contabilidad/ajuste-inflacion/config { primerEjercicioId, asientoAperturaId?, anticuacion: [{ cuentaContableId, tramos }] }` — reemplaza la anticuación completa. No se puede cambiar el primer ejercicio si ya hay ajustes vigentes: `Hay ajustes generados: anúlelos antes de cambiar el primer ejercicio`.

## 5. Cálculo

`calcularAjuste(tx, fecha) → { ejercicio, fecha, renglones, cuentas, recpam, avisos }`, en `apps/api/src/contabilidad/ajuste-inflacion/calculo.ts`. `fecha` es el último día de un mes de un ejercicio con número ≥ el del primer ejercicio (si no: `La fecha debe ser el último día de un mes` / `El ejercicio no se ajusta`).

**Definiciones** (índice `I(m)` del mes `m`; `M` = mes de `fecha`; `B` = mes anterior al inicio del ejercicio):
- **Apertura:** renglones del asiento de apertura (§4) en el primer ejercicio; en los siguientes, los asientos `APERTURA` del ejercicio.
- **Movimientos:** renglones de asientos del ejercicio con fecha ≤ `fecha`, excluidos la apertura, los tipos `REFUNDICION` y `CIERRE`, y los de `origenTipo = 'AJUSTE_INFLACION'` (ajustes y sus contraasientos). Los asientos anulados y sus contraasientos se suman ambos (se compensan).
- **Saldo contable:** apertura + movimientos + renglones `AJUSTE_INFLACION` (con fecha ≤ `fecha`). Saldo = debe − haber.
- **Grupo:** cada cuenta no monetaria que no sea cuenta de ajuste de otra, junto con su cuenta de ajuste si tiene. Se excluye la cuenta de `RECPAM`. Las cuentas monetarias no se tocan.

**Requisito de los ejercicios siguientes.** Si el ejercicio no es el primero, el anterior debe tener un ajuste vigente fechado en su último día: si no, 400 `Genere primero el ajuste al cierre del ejercicio N`.

**Paso A — apertura reexpresada a `B`** (por grupo):
- Primer ejercicio: `Σ tramo.importe × I(B) / I(origen) + no anticuado`. Para la cuenta de `RESULTADOS_NO_ASIGNADOS` (fuera de la anticuación): su saldo de apertura menos la suma de las diferencias (reexpresado − saldo) de todos los demás grupos; es decir, absorbe la reexpresión de la apertura.
- Ejercicios siguientes: el saldo de apertura, que ya está en moneda de `B`.

**Paso B — reexpresado a `M`:** `aperturaReexpresada × I(M) / I(B) + Σ movimiento × I(M) / I(mes del movimiento)`, redondeado a 2 decimales por grupo (los cocientes y productos en `Decimal` sin redondeo intermedio).

**Ajuste por grupo:** reexpresado − saldo contable del grupo. Va a la cuenta de ajuste si el grupo la tiene; si no, a la propia cuenta. Grupos con ajuste 0 no generan renglón.

**RECPAM:** la diferencia que balancea los renglones; un renglón en la cuenta del concepto `RECPAM` (si es 0, no hay renglón).

**Salida:**
- `cuentas: [{ cuentaContableId, codigo, nombre, saldoContable, reexpresado, ajuste, cuentaAjuste? }]` ordenadas por código;
- `renglones: RenglonAsiento[]` (debe para ajuste positivo, haber para negativo);
- `recpam` (positivo = ganancia, saldo acreedor);
- `avisos: string[]` (anticuación incompleta).

**Ejemplo que fija el cálculo** (se usa como prueba). Ejercicio 2026 enero–diciembre, primer ejercicio. Índices: 06/2025 = 50, 12/2025 = 80, 01/2026 = 100, 02/2026 = 110, 03/2026 = 120.
- Apertura (asiento `APERTURA` 01/01/2026): 1.2.01.002 Rodados D 600; 1.1.01.002 Bancos D 400; 3.1.01 Capital H 1000.
- Anticuación: Rodados 600 origen 06/2025; Capital −1000 origen 06/2025.
- 15/02/2026: Bancos D 220 / 4.1.01 Ventas H 220.
- 10/03/2026: 1.2.01.001 Muebles D 120 / Bancos H 120.

Ajuste al 31/03/2026:
| Grupo | Apertura a B | Reexpresado a M | Saldo contable | Ajuste |
|---|---|---|---|---|
| 1.2.01.002 Rodados | 960 | 1440 | 600 | D 840 |
| 3.1.01 + 3.1.02 | −1600 | −2400 | −1000 | H 1400 (en 3.1.02) |
| 3.2.01 Res. no asignados | 240 | 360 | 0 | D 360 |
| 1.2.01.001 Muebles | — | 120 | 120 | — |
| 4.1.01 Ventas | — | −240 | −220 | H 20 |

RECPAM D 220 (pérdida: 400 × (120/80 − 1) + 220 × (120/110 − 1)). Asiento: Rodados D 840, Res. no asignados D 360, RECPAM D 220 / Ajuste de capital H 1400, Ventas H 20.

**Ajuste complementario.** Si después del ajuste se registra un gasto 5.2.01 D 100 / Bancos H 100:
- fechado 20/03/2026: su coeficiente es 1, un nuevo ajuste al 31/03/2026 no tiene renglones y se rechaza (`No hay diferencias para ajustar`);
- fechado 20/02/2026: el nuevo ajuste al 31/03/2026 es Gastos generales D 9,09 / RECPAM H 9,09 (100 × 120/110 = 109,09).

## 6. Asiento de ajuste

**Tipo.** `TipoAsiento` suma `AJUSTE_INFLACION`. El asiento: `tipo AJUSTE_INFLACION`, `origenTipo 'AJUSTE_INFLACION'`, `origenId '<ejercicioId>:<AAAA-MM>'`, fecha = `fecha`, descripción `Ajuste por inflación al DD/MM/AAAA`. Se genera con `AsientosService.generar` (valida período abierto y cuentas activas como cualquier asiento automático).

**Reglas:**
- No se acepta una fecha anterior al último ajuste vigente del ejercicio: `Ya hay un ajuste al DD/MM/AAAA: genere uno a esa fecha o posterior`. La misma fecha sí (complementa).
- Sin renglones: 400 `No hay diferencias para ajustar`.
- Concurrencia: generar y anular bloquean la fila de `ConfigAjusteInflacion` (`SELECT … FOR UPDATE`) antes de calcular.
- **Anular:** solo el último ajuste vigente de la empresa: `Solo se puede anular el último ajuste (DD/MM/AAAA)`. Contraasiento con la misma fecha del ajuste (período abierto). La anulación genérica de asientos rechaza este tipo: `Anule el ajuste desde Ajuste por inflación`.
- Auditoría: `AJUSTE_INFLACION_GENERAR` y `AJUSTE_INFLACION_ANULAR`.

**Endpoints** (`contabilidad.cerrar`):
- `GET /api/contabilidad/ajuste-inflacion/previa?fecha=AAAA-MM-DD[&formato=xlsx]` — la salida de §5 (sin efectos), o el Excel con las columnas Código, Cuenta, Saldo contable, Reexpresado, Ajuste, una fila final RECPAM y los avisos debajo.
- `POST /api/contabilidad/ajuste-inflacion { fecha }` → el asiento creado.
- `GET /api/contabilidad/ajuste-inflacion` → ajustes de la empresa `[{ asientoId, numero, fecha, ejercicio, recpam, anulado }]`, por fecha descendente.
- `POST /api/contabilidad/ajuste-inflacion/:asientoId/anular { motivo }`.

## 7. Cierre del ejercicio

Si la empresa ajusta y el ejercicio es ≥ el primero, `faltantes` agrega (después de los requisitos existentes):
- sin ajuste vigente al último día: `Genere el ajuste por inflación al cierre`;
- con ajuste, pero `calcularAjuste(hasta)` da renglones: `El ajuste por inflación al cierre está desactualizado: genere uno nuevo`;
- si el cálculo falla por índices faltantes, se agrega su mensaje.

La refundición toma los resultados ya reexpresados (no cambia).

## 8. Estados contables

`GET` de balance y de resultados aceptan `comparativoReexpresado=true`. Si hay comparativo, cada importe del comparativo se multiplica por `I(mes de hasta) / I(mes de la fecha comparativa)` y se redondea a 2 decimales; la respuesta agrega `comparativo.coeficiente`. Sin índice de alguno de los dos meses: 400 con el mensaje de faltantes. El Excel y el PDF respetan la opción.

## 9. Web

- **Índices de inflación** (`/indices-inflacion`, menú solo para superadmin): tabla período/valor con edición en línea, alta, borrar e importar CSV (muestra creados/actualizados o el error de línea).
- **Plan de cuentas:** columna "Monetaria" (Sí/No) y, en el formulario, el interruptor y el selector de cuenta de ajuste (solo no monetarias).
- **Configuración del ajuste** (`/contabilidad/ajuste-inflacion/config`): primer ejercicio, asiento de apertura y la grilla de anticuación por cuenta (tramos mes/importe, con lo no anticuado a la vista).
- **Ajuste por inflación** (`/contabilidad/ajuste-inflacion`): selector de mes, vista previa con totales, RECPAM y avisos, botones Excel y Generar; debajo, la lista de ajustes con Anular (pide motivo) en el último.
- **Estados contables:** casilla "Comparativo reexpresado".

## 10. Pruebas

- **Unitarias:** cálculo con el ejemplo de §5 sobre datos en memoria si la función lo permite; parser del CSV de índices (formatos, encabezado, coma decimal, errores con número de línea).
- **API (e2e Jest):**
  - índices: permisos (no superadmin → 403), importar, faltantes;
  - plan de cuentas: migración/clasificación por defecto, herencia, validaciones de cuenta de ajuste;
  - configuración y anticuación con sus validaciones;
  - el ejemplo de §5 completo vía HTTP (previa y asiento con importes exactos), el segundo ajuste complementario, fecha anterior rechazada, sin diferencias;
  - ejercicio siguiente: exige el ajuste al cierre del anterior; apertura en moneda de `B`;
  - anular solo el último; anulación genérica rechazada; el ajuste anulado no cuenta y el siguiente lo recalcula;
  - cierre bloqueado (sin ajuste / desactualizado) y desbloqueado;
  - concurrencia: dos generaciones simultáneas no duplican el ajuste;
  - comparativo reexpresado.
- **Web (Vitest):** una prueba por pantalla nueva.
- **E2E (Playwright):** superadmin carga índices por CSV; el contador configura, ve la previa y genera el ajuste.
