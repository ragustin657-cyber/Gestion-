# Entrega 52 — Listas de precios derivadas y precio desde el costo

## 1. Intención
Hoy cada lista de precios tiene un precio cargado a mano por artículo, con aumento masivo por %, importación desde Excel e historial. Con la inflación, mantener varias listas (minorista, mayorista, distribuidor) y seguir el costo de reposición es trabajo manual constante.

**Éxito:**
- Una lista puede calcularse **desde otra lista** (± %) o **desde el costo** (+ % de margen), con redondeo.
- El usuario aprieta **Recalcular**, ve artículo por artículo el precio actual, el nuevo y la variación, y aplica todo o lo que elige; queda en el historial.
- Puede fijar a mano el precio de un artículo en una lista calculada (no lo toca el recálculo) y darle a un artículo un margen propio.

**No objetivos:** recálculo automático (decisión del usuario: con botón); márgenes por rubro o familia (no hay rubros de artículos); listas por cantidad; precios con IVA incluido (las listas siguen siendo netas, como hoy).

## 2. Enfoques (elegido por el usuario: el 1)
1. **Elegido: regla por lista con margen propio por artículo** y precios fijos.
2. Solo regla por lista: no permite márgenes distintos por producto.
3. Márgenes por rubro: requiere crear rubros de artículos; otra entrega.

## 3. Regla de la lista (`ListaPrecios`)
- `base`: `MANUAL` (como hoy, por defecto), `LISTA` o `COSTO`.
- `LISTA`: `listaBaseId` y `porcentaje` (con signo: −10 = 10 % menos; −99,99 a 1000). Una lista no puede tener como base a sí misma ni a una lista que (directa o indirectamente) depende de ella: `La lista base no puede depender de esta lista`. Una lista base inactiva se permite *(decisión mía: los precios siguen guardados)*.
- `COSTO`: `porcentaje` = **margen sobre el costo** (precio = costo × (1 + margen/100)) *(decisión mía: es la forma usual de "margen" en las pymes; a confirmar con el usuario si prefiere margen sobre el precio)*; de 0 a 1000.
- `redondeo`: `0.01`, `1`, `10` o `100` (los mismos del aumento masivo y la misma regla: al múltiplo más cercano, mitad hacia arriba, nunca menos que un múltiplo).
- Los cambios de la regla no recalculan nada: solo el botón.
- Permiso: `precios.editar`.

## 4. Costo del artículo
- **Último costo de compra:** del último comprobante de compra confirmado de tipo factura o tique (no notas; *decisión mía: el despacho de importación queda afuera porque sus tributos al costo están en la cabecera y habría que prorratearlos; a revisar si hay importadores*) con un renglón del artículo, por fecha de emisión y luego número interno: `importe ÷ cantidad × cotización` del comprobante (el importe ya es neto bonificado y sin IVA). Si hay varios renglones del artículo en esa factura, el promedio ponderado de ellos.
- Si el artículo nunca se compró: el **costo promedio** de stock (`Articulo.costoPromedio`), si es mayor que cero.
- Sin ninguno de los dos: el artículo queda **sin costo** y no se recalcula (se informa en la vista previa).
- Lista en dólares desde el costo (en pesos) o desde una lista en otra moneda: se convierte con la cotización del día (`Cotizacion`); sin cotización del día: `No hay cotización de USD para hoy`.

## 5. Precio por artículo (`PrecioLista`)
- `fijo Boolean @default(false)`: un precio cargado a mano, importado o cambiado por aumento masivo en una lista con base `LISTA` o `COSTO` queda fijo; el recálculo no lo cambia. Se quita la marca desde la pantalla. En listas `MANUAL` la marca no se usa. *(Decisión mía: los precios existentes no quedan fijos al migrar ni al cambiar la base de una lista; la vista previa del primer recálculo los muestra y el usuario destilda los que quiera conservar.)*
- `margenPct Decimal?` (solo listas `COSTO`): margen propio del artículo; vacío = el de la lista. *(Decisión mía: se carga sobre un artículo que ya tiene precio en la lista; el primer recálculo lo agrega con el margen de la lista.)*
- *(Decisión mía)* Al cambiar la base, `fijo` y `margenPct` se conservan y se ignoran donde no aplican (por ejemplo, el margen en una lista `LISTA`).
- *(Decisión mía)* Un precio borrado de una lista `COSTO` vuelve a aparecer como nuevo en el próximo recálculo; el usuario lo destilda en la vista previa si no lo quiere.

## 6. Recalcular
- **Vista previa** (`GET /api/precios/listas/:id/recalculo`): para cada artículo activo:
  - base `LISTA`: los artículos con precio en la lista base;
  - base `COSTO`: los artículos que no son servicios con costo, y además los que ya tienen precio en la lista;
  - columnas: artículo, precio actual (vacío si no tenía), precio nuevo, variación %, y el motivo si no se recalcula (`Precio fijo`, `Sin costo`, `Sin precio en la lista base`).
  - Solo para listas `LISTA` o `COSTO` (si no: `La lista se carga a mano`).
- **Aplicar** (`POST /api/precios/listas/:id/recalculo { articuloIds?: string[] }`): recalcula en el momento (no usa los números de la vista previa) *(decisión mía: entre la vista y la aplicación pudo cambiar un costo)*; aplica todos los recalculables o solo los elegidos; los artículos sin precio en la lista se agregan; precios iguales no generan historial. Historial con el motivo nuevo `RECALCULO`. Auditoría de la operación con la cantidad de precios cambiados. Bloquea las listas con el mismo bloqueo que el alta y la modificación de listas.
- Recalcular una lista no recalcula las que dependen de ella *(decisión mía: cada lista se revisa con su vista previa)*; después de recalcular, aviso `Las listas <nombres> dependen de esta: recalcúlelas` si hay.

## 7. Pantalla (Precios › Listas de precios)
- En cada lista: base, lista base, porcentaje (o margen) y redondeo.
- Botón *Recalcular* (solo base `LISTA`/`COSTO`): modal con la tabla de la vista previa, casillas por artículo (todas marcadas salvo las que no se recalculan), *Aplicar*.
- En la tabla de precios de una lista calculada: columna *Fijo* (con *Quitar*) y, en listas `COSTO`, *Margen %* editable por artículo.

## 8. Fuera de alcance
- Recálculo automático o programado; rubros; listas en cascada en un solo paso; precios con IVA; costo de reposición cargado a mano.
