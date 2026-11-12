# Entrega 13 — Informes de gestión

## 1. Objetivo y alcance

La dirección ve cómo va el negocio sin planillas: cuánto se vende y a quién, qué deja margen, quién debe y desde cuándo, y cuánto capital hay en stock.

**Criterio de éxito.** Con la demo: abro el tablero, elijo el mes y veo ventas, margen bruto, cobranzas vencidas, deuda con proveedores y stock valorizado, con su variación; las cifras coinciden con el Mayor (Ventas y Costo de mercaderías vendidas) y con las consultas existentes; cada informe se exporta a Excel y PDF.

**Decisiones tomadas con el usuario:**
- **Forma:** tablero de dirección (indicadores + gráficos) e informes detallados exportables, con paso del tablero al informe.
- **Inflación:** importes nominales por defecto y opción "En moneda de hoy" que reexpresa cada mes con los índices FACPCE del sistema.
- **Diseño técnico:** consultas en vivo (SQL agregado) sobre comprobantes, movimientos de stock y cuentas corrientes; sin tablas resumen. Cálculo puro (agrupar, reexpresar, tramos) separado del acceso a datos.

**Fuera de alcance:** vendedores y comisiones, presupuesto contra real, informes en dólares, envíos programados, tableros configurables.

## 2. Qué mide cada cifra

**Ventas** (`apps/api/src/informes/fuentes/ventas.ts`):
- Comprobantes de venta `AUTORIZADO`: FACTURA y NOTA_DEBITO suman, NOTA_CREDITO resta.
- Por renglón: neto (sin IVA) × cotización del comprobante, redondeado a 2 decimales.
- Fecha = fecha del comprobante; cliente = tercero; artículo = el del renglón (sin artículo: "Sin artículo").

**Costo de lo vendido** por renglón de venta:
- Factura directa: suma de los movimientos de stock `VENTA` con `origenTipo 'VENTA'` y `origenRenglonId` = renglón (importe con signo invertido).
- Renglón de remito: `cantidad facturada × costo unitario` del movimiento `VENTA` del renglón de remito (`origenTipo 'REMITO'`).
- NC con devolución: movimientos `DEVOLUCION_VENTA` del renglón (restan).
- Se imputa a la fecha del comprobante de venta. Un renglón sin movimientos de stock es **sin costo**.

**Margen bruto** = ventas con costo − costo; porcentaje = margen / ventas con costo. **Cobertura** = ventas con costo / ventas totales.

**Antigüedad de saldos** (clientes o proveedores) a una fecha de corte:
- Movimientos de cuenta corriente no anulados con saldo pendiente (en pesos) y fecha ≤ corte.
- Tramos por días vencidos (`corte − fechaVencimiento`): `A vencer` (≤ 0), `1–30`, `31–60`, `61–90`, `Más de 90`.
- Saldos en contra del signo normal (anticipos de clientes, NC sin aplicar) en la columna `A favor`, sin entrar en tramos.
- Por tercero y total.

**Stock:**
- Valorizado a una fecha: igual que la consulta de valuación (kardex con fecha ≤ fecha).
- Rotación del período = costo de lo vendido del período / stock promedio, con stock promedio = (valor al día anterior a `desde` + valor a `hasta`) / 2. Sin stock promedio: `—`.
- Días de cobertura = valor a `hasta` / (costo de lo vendido / días del período). Sin ventas: `—`.

**Comparaciones** del tablero: contra el período anterior de igual cantidad de días y contra el mismo período del año anterior (variación en importe y en %; `—` si el anterior es cero).

**Ejemplo que fija el cálculo** (prueba principal; noviembre 2026; artículo A con stock, servicio S sin stock):
| Operación | Ventas | Costo |
|---|---|---|
| Inventario inicial A 100 u @ 10 (02/11) | — | — |
| Factura 1, cliente X, A 10 u @ 20 | 200,00 | 100,00 |
| Factura 2, cliente Y, en USD a 1000: A 5 u @ USD 0,04 | 200,00 | 50,00 |
| Remito a X de A 20 u y Factura 3 de ese remito @ 20 | 400,00 | 200,00 |
| Factura 4, cliente Y, S 1 @ 300 | 300,00 | sin costo |
| NC con devolución sobre la Factura 1: A 2 u @ 20 | −40,00 | −20,00 |
| **Total** | **1.060,00** | **330,00** |

Ventas con costo 760,00; margen 430,00 (56,58 %); sin costo 300,00; cobertura 71,70 %. Por cliente: X 560,00 (costo 280,00), Y 500,00 (costo 50,00). El Mayor da Ventas 1.060,00 y Costo de mercaderías vendidas 330,00. Stock final 67 u = 670,00; rotación de noviembre = 330 / ((0 + 670) / 2) = 0,99; días de cobertura = 670 / (330 / 30) = 60,9.

## 3. Reexpresión "en moneda de hoy"

- Mes base = el último mes con índice cargado que no supere el mes de `hasta`. Coeficiente de un mes = I(base) / I(mes).
- Se aplica a ventas y costos agrupados por mes (y por lo tanto a márgenes y rankings del período) y a las series del tablero.
- No se aplica a antigüedad ni a stock (son saldos a una fecha).
- Si falta el índice de algún mes necesario: no se reexpresa nada y la respuesta trae `aviso: 'Faltan los índices de: 10/2026, …: se muestran importes nominales'`.
- Ejemplo: índices 10/2026 = 100 y 11/2026 = 110; ventas de octubre 1.000,00 nominales → 1.100,00 en moneda de noviembre.

## 4. API

Módulo `apps/api/src/informes/`, permiso nuevo `informes.ver` ("Ver informes de gestión"); en la demo lo tienen Administrador y Contador. Fechas `desde`/`hasta` obligatorias en los informes de período (`hasta ≥ desde`, máximo 3 años: `El período no puede superar los 3 años`); `fecha` obligatoria en los de corte.

- `GET /api/informes/tablero?desde&hasta&reexpresar=true|false` →
  ```
  { periodo, aviso?, indicadores: {
      ventas: { valor, anterior, anioAnterior }, margenPct: { valor, anterior, anioAnterior },
      cobranzasVencidas: { valor }, deudaVencida: { valor }, stock: { valor } },
    ventasPorMes: [{ mes: 'AAAA-MM', ventas, costo, margen }] (12 meses que terminan en el mes de `hasta`),
    topClientes: [{ id, nombre, ventas }] (10), topArticulos: [{ id, codigo, descripcion, ventas, margen }] (10) }
  ```
- `GET /api/informes/ventas?desde&hasta&agrupar=cliente|articulo|mes&reexpresar` → `{ filas: [{ clave, nombre, ventas, costo, margen, margenPct, sinCosto }], totales, aviso? }`.
- `GET /api/informes/margenes?desde&hasta&agrupar=articulo|cliente&reexpresar` → mismas filas, ordenadas por margen descendente, solo con costo; `totales.cobertura`.
- `GET /api/informes/antiguedad?tipo=clientes|proveedores&fecha` → `{ filas: [{ terceroId, nombre, aVencer, d1_30, d31_60, d61_90, mas90, aFavor, total }], totales }`.
- `GET /api/informes/rotacion?desde&hasta` → `{ filas: [{ articuloId, codigo, descripcion, stockInicial, stockFinal, costoVendido, rotacion, diasCobertura }], totales }`.
- Todos aceptan `formato=xlsx|pdf` con `tablaXlsx`/`tablaPdf` (columnas como la tabla de pantalla, fila de totales).

## 5. Web

- **Tablero de dirección** (`/informes/tablero`; es la página de inicio para quien tiene `informes.ver` y entra sin ruta):
  - Selector de período (mes actual por defecto, o desde/hasta) y casilla "En moneda de hoy".
  - Tarjetas con valor y variación (verde/rojo) que llevan al informe: Ventas → Ventas por mes; Margen → Márgenes; Cobranzas vencidas → Antigüedad clientes; Deuda vencida → Antigüedad proveedores; Stock → Rotación.
  - Gráfico de barras de ventas por mes (12 meses) con el margen como línea; rankings de 10 clientes y 10 artículos (barras horizontales).
  - Aviso visible si la reexpresión no se pudo aplicar.
- **Informes de gestión** (menú propio, `informes.ver`): Ventas (agrupar por cliente/artículo/mes), Márgenes, Antigüedad de saldos (clientes/proveedores), Rotación de stock. Tablas con totales, orden por columna, botones Excel y PDF.
- Dependencias nuevas: `@mantine/charts@7.17.8` y `recharts@2.15.4` (versiones fijas).

## 6. Pruebas

- **Cálculo puro:** tramos de antigüedad en los bordes (0, 1, 30, 31, 60, 61, 90, 91 días); reexpresión con el ejemplo de §3 y con índice faltante; rotación y cobertura sin datos.
- **API:** el ejemplo de §2 completo (ventas, costo, margen, cobertura, por cliente y por artículo, coincidencia con el Mayor, rotación); comparaciones del tablero; antigüedad con vencimientos en cada tramo y un anticipo a favor; validaciones de fechas; permisos; exportaciones.
- **Web:** tarjetas con variación, gráfico con datos de ejemplo, tabla de antigüedad con totales.
- **E2E:** contador abre el tablero, entra a Ventas por cliente y descarga el Excel.
