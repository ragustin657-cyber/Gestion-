# Entrega 55 — Facturación por lotes (diseño)

## Intención
Hoy cada factura se arma de a una: cliente, *Agregar desde remitos y pedidos*, emitir. Quien entrega con remito y factura después (fin de semana o de mes) repite eso para cada cliente. La entrega 55 factura **los remitos pendientes de muchos clientes de una vez**: una vista previa por cliente, se eligen los clientes y el sistema crea y emite una factura por cliente, dejando constancia del lote.

Ítem 15 de `docs/pendientes.md` (sección 1.2).

## Objetivos
- Pantalla *Facturación por lotes* (menú Ventas) con filtros, vista previa por cliente, selección y *Generar*.
- Una factura por cliente (y moneda, ver §3) con todos sus renglones de remito pendientes de facturar hasta la fecha de corte, con las mismas reglas que la factura de a una (`ComprobantesService.crearEnTx` + `EmisionService.emitir`).
- Los errores de un cliente no frenan a los demás; el resultado queda registrado por cliente.
- Registro del lote (fecha, usuario, filtros, facturas y resultado) consultable, con todos los PDF juntos.

## No objetivos
- Abonos o facturas recurrentes (la otra variante de "lotes"; queda en pendientes).
- Facturar pedidos sin remito (se facturan como hoy, de a uno).
- Proceso en segundo plano / cola: el lote corre dentro del pedido HTTP.
- Envío de las facturas por correo.

## Anti-objetivos
- Que el lote invente precios: un renglón sin precio de pedido ni de lista no se factura en silencio a cero.
- Que un fallo a mitad del lote deje facturas a medias sin rastro, o que un reintento duplique facturas.

## Enfoques
- **A (elegido por el usuario): el servidor arma y emite el lote**, vista previa y generación en la API, registro `LoteFacturacion`. Única que deja constancia y no depende de la pestaña abierta.
- B: la pantalla recorre los clientes llamando a la factura de a una. Más barato, pero la lógica de precios queda en el navegador y un corte deja el lote sin registro.
- C: proceso en segundo plano con cola. Complejidad de más para el volumen de una pyme.

## Diseño

### 1. Filtros y vista previa
`GET /api/ventas/facturacion-lotes/vista-previa?hasta=AAAA-MM-DD&puntoVentaId=&terceroIds=` (permiso `venta.emitir`).
- Renglones de remitos `ENTREGA` `CONFIRMADO` con `fecha ≤ hasta` y pendiente `cantidad − cantidadFacturada − cantidadDevuelta > 0` (mismo cálculo que `pendientesFacturar`), de los clientes filtrados (todos si no se indica).
- Excluye los renglones que ya están en un comprobante sin autorizar (borrador o `PENDIENTE_CAE`) y lo informa como **aviso** (no bloquea al cliente; se factura el resto): `Ya está en la factura <número o borrador> sin autorizar`. *(Decisión mía: un borrador olvidado no frena todo el cliente.)*
- `puntoVentaId` es el punto de venta **de emisión**: se toman los remitos de todos los puntos de venta. *(Decisión mía.)*
- Por cliente: razón social, CUIT, letra que le corresponde, moneda, remitos (números), renglones (remito, descripción, cantidad pendiente, precio, bonificación, alícuota, importe), total estimado y lista de **problemas**.
- Un cliente con al menos un problema bloqueante (`Sin precio`, `No hay cotización…`) aparece **sin marcar y sin poder marcarse**; los demás, marcados. *(Decisión mía: no se factura un cliente a medias por un precio faltante; se corrige el precio y se vuelve a correr.)*

### 2. Precio de cada renglón
1. Renglón de remito con renglón de pedido: precio, bonificación y alícuota del pedido (igual que *Agregar desde remitos y pedidos*).
2. Sin pedido: precio sugerido de la lista del cliente (`PreciosService.sugerido`, lista del cliente o la por defecto), bonificación 0, alícuota del artículo.
3. Sin precio por ninguna vía → problema bloqueante `Sin precio: <descripción> (remito <número>)`.
4. Renglón sin artículo (texto libre) y sin pedido → mismo problema.

### 3. Moneda
- Moneda de la factura: la del pedido de sus renglones; sin pedido, ARS. *(Decisión mía.)*
- Si los renglones de un cliente vienen de pedidos en monedas distintas, se arma **una factura por moneda**. *(Decisión mía: no se mezclan monedas en una factura.)*
- Factura en USD: cotización de la **fecha de emisión** elegida (`cotizacion(tx, 'USD', fecha)`), igual que la factura de a una, que toma el precio del pedido en su moneda y la cotización del día del comprobante; sin cotización → problema bloqueante `No hay cotización de USD para la fecha`. Precio de lista en otra moneda que la factura: se convierte como en `sugerido`.

### 4. Datos de cada factura
- `tipo: FACTURA`, `concepto: PRODUCTOS`, `fecha` = fecha de emisión elegida en la pantalla (hoy por defecto; no anterior a la última factura emitida del punto de venta, que ya valida la emisión).
- `fechaVencimiento` = fecha + `diasPago` del cliente.
- Punto de venta: el del filtro (obligatorio). Depósito: el que corresponde hoy a facturas desde remito (la mercadería ya salió con el remito; no se mueve stock).
- Vendedor: el que resuelve hoy `preparar` (del pedido o del cliente).
- `descuentoPct`: ninguno.
- FCE: en la generación, antes de crear cada factura, se consulta la obligación del cliente (`ObligacionFceService.obligacion`, igual que `emitir`); si está obligado se crea como FCE (`fce: true`, `transferenciaFce` = el de `ConfigArca`, vencimiento del pago = vencimiento). *(Decisión mía: si no, `emitir` la rechazaría.)* La vista previa no consulta ARCA; el resultado muestra *FCE*.

### 5. Generación
`POST /api/ventas/facturacion-lotes` `{ hasta, puntoVentaId, fecha, terceroIds: string[] }` (`venta.emitir`).
- Crea el `LoteFacturacion` (estado `EN_CURSO`) en su propia transacción.
- Recalcula la vista previa en el servidor para esos clientes (no confía en lo que mostró la pantalla); un cliente que ahora tiene problemas queda con resultado `OMITIDO` y el motivo.
- Por cada factura, en orden de razón social: `crearEnTx` en su transacción (si falla → resultado `ERROR` con el mensaje, sin factura) y luego `emitir` (si ARCA falla → la factura queda guardada sin CAE, resultado `SIN_CAE` con el mensaje, reintento desde la consulta de comprobantes como hoy).
- Al terminar, el lote pasa a `TERMINADO` con contadores (emitidas, sin CAE, con error, omitidas).
- Errores de `emitir` que no son de comunicación con ARCA (período cerrado, fecha anterior a la última, rechazo de ARCA): la factura **queda guardada** sin autorizar y el resultado es `SIN_CAE` con el mensaje; se corrige y se emite (o se elimina) desde la consulta de comprobantes, como hoy. *(Decisión mía: el borrador deja rastro y sus renglones aparecen como aviso en el próximo lote.)*
- Concurrencia: la generación toma un bloqueo consultivo por empresa (`pg_advisory_xact_lock` en una transacción corta por factura no alcanza; se usa un bloqueo de sesión del lote o una marca `EN_CURSO` única por empresa → 409 `Ya hay un lote de facturación en curso`). Dentro de la transacción de cada factura se bloquean los renglones de remito y se vuelve a excluir lo que esté en comprobantes sin autorizar. La factura de a una no cambia: si coincide con un lote, la emisión de la segunda falla por el control de pendiente que ya existe al autorizar. *(Decisión mía.)*
- Sin reintento del lote: los ítems se graban con resultado `PENDIENTE` al crear el lote y se actualizan a medida que avanza. Un lote cortado (caída, timeout) queda `EN_CURSO`; al consultarlo o al iniciar otro, un `EN_CURSO` de más de 15 minutos pasa a `INTERRUMPIDO`. Lo no facturado sigue pendiente y entra en el próximo lote; no hay duplicados porque el pendiente ya descontó lo emitido. *(Decisión mía.)*
- Un lote se corta a 200 facturas: más → 400 `El lote supera las 200 facturas: acote los clientes o la fecha`. *(Decisión mía: mantiene el pedido HTTP en tiempos razonables.)*

### 6. Registro y consulta
- `LoteFacturacion` (empresa, número correlativo, fecha, `hasta`, punto de venta, usuario, estado `EN_CURSO | TERMINADO | INTERRUMPIDO`, contadores, creado) y `LoteFacturacionItem` (lote, cliente, moneda, comprobanteId?, resultado `PENDIENTE | EMITIDA | SIN_CAE | ERROR | OMITIDO`, `fce`, mensaje, total).
- `GET /api/ventas/facturacion-lotes` (listado) y `GET /api/ventas/facturacion-lotes/:id` (detalle con ítems), permiso `venta.ver`.
- `GET /api/ventas/facturacion-lotes/:id/pdf`: un PDF con todas las facturas `AUTORIZADO` del lote, una tras otra.
- Auditoría `LoteFacturacion` CREAR.

### 7. Pantalla
Menú Ventas → *Facturación por lotes* (`venta.emitir`):
```
Hasta [2026-11-30]  Punto de venta [0001]  Fecha de emisión [2026-11-24]  Clientes [todos ▾]  [Ver]
☑ Constructora Norte S.R.L.   A  ARS  R 0001-00000012, -00000015   $ 145.200,00
☐ Kiosco Sur  (Sin precio: Cable UTP (remito R 0001-00000020))
                                                      [Generar 1 factura]
```
- Cada cliente se despliega para ver sus renglones.
- Tras *Generar*: tabla de resultado por cliente (factura, estado, mensaje) y botón *PDF del lote*.
- Pestaña o sección *Lotes anteriores* con el listado y el detalle.

## Restricciones
- Mismas reglas de la factura de a una: no se duplica lógica de cálculo, IVA, percepciones, FCE ni numeración.
- Modelos nuevos en `MODELOS_DE_EMPRESA`; enum nuevo en su propia migración.
- Mensajes exactos: `Sin precio: <descripción> (remito <número>)`, `Ya está en la factura <número> sin autorizar`, `No hay cotización de USD para la fecha`, `Ya hay un lote de facturación en curso`, `El lote supera las 200 facturas: acote los clientes o la fecha`.

## Lo que queda al constructor
- Cómo se reusa el armado de renglones de `pendientesFacturar` para la vista previa (extraer una función común).
- Cómo se concatena el PDF del lote con el generador de PDF existente.
- Nombres de archivos y componentes.
