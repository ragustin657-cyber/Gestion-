# Entrega 56 — Rubros de artículos y descuentos por cantidad (diseño)

## Intención
Dos pendientes de ventas que se apoyan uno en el otro:
- **Rubros de artículos** (familias): agrupar artículos y darle a cada rubro un **margen sobre el costo** para las listas calculadas desde el costo (pendiente de E52).
- **Descuentos por cantidad automáticos** (pendiente de E51): escalas por rubro, con excepción por artículo, que **sugieren** el % de bonificación del renglón según la cantidad.

Ítems 16 y 17 de `docs/pendientes.md` (sección 1.2), en lo que tienen de rubros y escalas.

## Objetivos
- ABM de rubros de artículos; cada artículo puede tener un rubro.
- Margen sobre el costo por rubro, usado por el recálculo de listas COSTO.
- Escalas de descuento por cantidad por rubro y por artículo (la del artículo reemplaza a la del rubro).
- La bonificación del renglón se sugiere sola en el pedido y el comprobante al elegir artículo o cambiar la cantidad, como hoy el precio; lo cargado a mano se respeta.
- La facturación por lotes (E55) usa la escala en los remitos sin pedido.

## No objetivos
- Escalas por lista de precios o por cliente (el usuario eligió escalas por rubro con excepción por artículo).
- Tope de descuento por usuario, descuento en importe fijo, pronto pago, descuento por total del comprobante.
- Rubros jerárquicos (sub-rubros): un solo nivel. *(Decisión mía.)*
- Que el servidor imponga la escala al guardar (enfoque B descartado).

## Anti-objetivos
- Pisar una bonificación cargada a mano o la que viene del pedido.
- Cambiar precios o bonificaciones de comprobantes ya guardados.

## Enfoques
- **A (elegido): sugerencia**, igual que el precio sugerido: la pantalla consulta la escala y completa la bonificación; el usuario la puede cambiar.
- B: el servidor la aplica siempre al guardar. Descartado: pisa lo cargado a mano y lo pactado en el pedido, y el usuario ve un número distinto del que escribió.

## Diseño

### 1. Rubros
- `RubroArticulo { id, empresaId, nombre (único por empresa), margenPct Decimal(9,2)? (0 a 1000), activo }`.
- `Articulo.rubroId String? @db.Uuid`.
- API `GET/POST /api/rubros-articulos`, `PATCH /api/rubros-articulos/:id` (ver: `articulo.ver`; editar: `articulo.editar`). No se borran: se desactivan; un rubro inactivo no se puede asignar a artículos nuevos o modificados, pero los que ya lo tienen lo conservan. *(Decisión mía.)*
- Mensajes: `Ya existe un rubro con ese nombre`, `Rubro inexistente o inactivo`.
- El alta y la edición de artículos aceptan `rubroId`; el listado de artículos lo devuelve con el nombre y filtra por `?rubroId=`.

### 2. Margen por rubro en las listas desde el costo
En el recálculo de una lista COSTO (E52, `PreciosService`), el margen de cada artículo es:
1. `PrecioLista.margenPct` del artículo en esa lista, si tiene;
2. si no, `RubroArticulo.margenPct` del rubro del artículo, si tiene;
3. si no, `ListaPrecios.porcentaje`.

La vista previa del recálculo agrega `margen` (el % usado) y `origenMargen` (`ARTICULO | RUBRO | LISTA`). Listas MANUAL y LISTA no cambian.

### 3. Escalas de descuento por cantidad
- `EscalaDescuento { id, empresaId, rubroId?, articuloId?, desde Decimal(18,4) > 0, porcentaje Decimal(5,2) (> 0 y ≤ 100) }`, exactamente uno de `rubroId` o `articuloId`; único por (rubro, desde) y por (artículo, desde).
- Se administran como una lista completa por dueño: `GET/PUT /api/rubros-articulos/:id/escalas` y `GET/PUT /api/articulos/:id/escalas` con `{ escalas: { desde, porcentaje }[] }` (reemplaza todas; lista vacía = sin escala). Permiso `articulo.editar` (ver: `articulo.ver`).
- Validación: `desde` distintos (`Hay dos escalas con la misma cantidad`), porcentaje entre 0 y 100 con hasta 2 decimales.
- *(Decisión mía)* No se exige que el % crezca con la cantidad.

### 4. Bonificación sugerida
`GET /api/ventas/bonificacion?articuloId=&cantidad=` (`RequiereAlguno('venta.emitir', 'pedido.gestionar')`) → `{ bonificacionPct: string | null, origen: 'ARTICULO' | 'RUBRO' | null, desde: string | null }`.
- Si el artículo tiene escalas propias, se usan solo esas; si no, las de su rubro (activo); si no, `null`.
- Se aplica la escala con mayor `desde` ≤ cantidad; cantidad menor a todas → `null`.
- Por renglón, con la cantidad del renglón (no suma renglones del mismo artículo). *(Decisión mía.)*
- Función de dominio reutilizable `bonificacionPorCantidad(tx, articuloId, cantidad)` (la usa también el lote).

### 5. Pantallas
- **Rubros de artículos** (Maestros, `articulo.ver` / editar con `articulo.editar`): tabla nombre, margen sobre el costo, activo; alta y edición; botón *Escalas* que abre un editor de filas (Desde cantidad, % de descuento, agregar/quitar, *Guardar*).
- **Artículos**: campo *Rubro* en el formulario, columna *Rubro* y filtro en el listado; botón *Escalas* con el mismo editor (propias del artículo; aviso `Sin escalas propias: usa las del rubro <nombre>` cuando corresponde).
- **Grilla de venta** (pedido y comprobante, `GrillaVenta`): al elegir artículo y al cambiar la cantidad, si la bonificación del renglón no fue escrita a mano, se consulta la sugerida y se completa (o se vacía si ya no corresponde escala). Escribir en *Bonificación %* marca el renglón como manual. Los renglones que vienen de remito, pedido o devolución no se tocan. Una respuesta que llega tarde se descarta si el renglón cambió de artículo o cantidad (como `aplicarPrecioSugerido`).
- **Listas de precios** (recálculo): columna *Margen* con su origen (Artículo / Rubro / Lista) en la vista previa de listas COSTO.

### 6. Facturación por lotes
En `armarLote` (E55), renglón de remito sin pedido: `bonificacionPct` = la sugerida por la escala para la cantidad pendiente (0 si no hay). Con pedido, la del pedido (sin cambios).

## Restricciones
- Modelos nuevos en `MODELOS_DE_EMPRESA`; migraciones aparte.
- Mensajes exactos: `Ya existe un rubro con ese nombre`, `Rubro inexistente o inactivo`, `Hay dos escalas con la misma cantidad`.
- Mismos rangos que E51/E52: bonificación 0–100 con 2 decimales; margen 0–1000.

## Lo que queda al constructor
- Nombres de componentes y rutas web (`/maestros/rubros-articulos`).
- Si el editor de escalas es un modal o un panel.
- Cómo se marca "manual" en el estado del renglón (`bonificacionManual?: boolean`, no se envía a la API).
