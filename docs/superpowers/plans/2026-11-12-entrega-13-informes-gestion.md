# Entrega 13 — Informes de gestión: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tablero de dirección e informes de ventas, márgenes, antigüedad de saldos y rotación de stock, con reexpresión opcional por inflación y exportación.

**Architecture:** módulo `apps/api/src/informes/` con fuentes de datos (consultas agregadas a la base) y cálculo puro (agrupar, reexpresar, tramos, rotación) separados; un servicio por informe y un controlador. Web: `apps/web/src/informes/` con `@mantine/charts`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16; React 19, Mantine 7.17.8, `@mantine/charts@7.17.8`, `recharts@2.15.4`; Jest/supertest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-entrega-13-informes-gestion-design.md` (§N = sección del spec).

## Global Constraints

- Textos en español, exactamente como el spec. Importes con `Prisma.Decimal`, 2 decimales en las respuestas (`toFixed(2)`); porcentajes con 2 decimales; rotación con 2 y días con 1.
- Ninguna tabla nueva: solo consultas. El permiso nuevo `informes.ver` ("Ver informes de gestión") va en `packages/shared/src/permisos.ts` y en los roles demo Administrador (ya tiene todos) y Contador.
- Fechas de período con `fechaQuery(…, true)`; `El período no puede superar los 3 años`; `La fecha desde no puede ser posterior a la fecha hasta`.
- Reloj de pruebas 2026-11-06.
- Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` y `Claude-Session: https://claude.ai/code/session_01PUxLkCHXNYj9n2P64zhXBQ`.

## Review Focus

1. **Comprobante de venta en borrador (PENDIENTE_CAE) o RECHAZADO** → no suma a ventas ni a costo. Prueba en Task 2.
2. **Remito facturado en dos partes** → el costo de cada factura es su parte (cantidad facturada × costo unitario del remito), no el remito entero dos veces. Prueba en Task 2.
3. **Período de un solo día o que cruza el cambio de año** → comparaciones (anterior de igual duración, año anterior) correctas. Prueba en Task 4.
4. **Empresa sin ventas, sin stock y sin índices** → tablero con ceros y `—`, sin errores. Prueba en Task 4.
5. **Cliente con un anticipo mayor que su deuda** → `A favor` y tramos separados, total neto correcto. Prueba en Task 3.

---

### Task 1: Cálculo puro

**Files:** Create `apps/api/src/informes/calculo.ts`, `apps/api/src/informes/calculo.spec.ts`

**Interfaces — Produces:**
```ts
export type Tramo = 'aVencer' | 'd1_30' | 'd31_60' | 'd61_90' | 'mas90';
export function tramoDe(corte: Date, vencimiento: Date): Tramo;
export function coeficientes(meses: string[] /* 'AAAA-MM' */, indices: Map<string, Dec>, mesHasta: string): { coef: Map<string, Dec>; base: string } | { faltan: string[] };
export function rotacion(costoVendido: Dec, stockInicial: Dec, stockFinal: Dec, dias: number): { rotacion: string | null; diasCobertura: string | null };
export function variacion(valor: Dec, anterior: Dec): { importe: string; pct: string | null };
export function periodoAnterior(desde: Date, hasta: Date): { desde: Date; hasta: Date };   // igual cantidad de días, inmediatamente antes
export function anioAnterior(desde: Date, hasta: Date): { desde: Date; hasta: Date };      // usa unAnioAntes de contabilidad/estados/fechas
```
`coeficientes`: base = último mes con índice ≤ `mesHasta`; si algún mes de `meses` no tiene índice → `{ faltan }` (ordenados, únicos, formato `MM/AAAA`).

- [ ] **Step 1: Tests que fallan** (`calculo.spec.ts`):
  - `tramoDe` con corte 2026-11-30 y vencimientos a 0, 1, 30, 31, 60, 61, 90, 91 días antes → `aVencer, d1_30, d1_30, d31_60, d31_60, d61_90, d61_90, mas90`; vencimiento posterior al corte → `aVencer`.
  - `coeficientes(['2026-10','2026-11'], {2026-10:100, 2026-11:110}, '2026-11')` → coef octubre `1.1`, noviembre `1`, base `2026-11`; sin el índice de octubre → `{ faltan: ['10/2026'] }`; `mesHasta` 2026-12 sin índice de diciembre → base `2026-11`.
  - `rotacion(330, 0, 670, 30)` → `{ rotacion: '0.99', diasCobertura: '60.9' }`; costo 0 → `diasCobertura: null`; stock promedio 0 → `rotacion: null`.
  - `variacion(110, 100)` → `{ importe: '10.00', pct: '10.00' }`; anterior 0 → `pct: null`.
  - `periodoAnterior(2026-11-01, 2026-11-30)` → 2026-10-02 … 2026-10-31; un día (2026-01-01) → 2025-12-31 … 2025-12-31. `anioAnterior(2026-02-01, 2026-02-28)` → 2025-02-01 … 2025-02-28.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(informes): cálculo de tramos, reexpresión, rotación y comparaciones`.

### Task 2: Fuente de ventas y costo; informe de ventas y márgenes

**Files:** Create `apps/api/src/informes/fuentes/ventas.ts`, `apps/api/src/informes/{informes.module.ts,informes.controller.ts,informes.service.ts}`; Modify `apps/api/src/app.module.ts`, `packages/shared/src/permisos.ts`, `apps/api/src/seed/demo.ts`; Create `apps/api/test/helpers-informes.ts`; Test `apps/api/test/informes-ventas.e2e-spec.ts`

**Interfaces — Produces:**
```ts
export interface RenglonVendido { fecha: Date; mes: string; terceroId: string; cliente: string; articuloId: string | null; codigo: string | null; descripcion: string; ventas: Dec; costo: Dec | null }
export function renglonesVendidos(tx: TxEmpresa, desde: Date, hasta: Date): Promise<RenglonVendido[]>;
```
(signo: NC con ventas y costo negativos; `costo` null = sin costo). Costo por renglón según §2 (movimientos `VENTA`/`DEVOLUCION_VENTA` con `origenTipo 'VENTA'` y `origenRenglonId`; renglón de remito: `cantidad × costoUnitario` del movimiento `VENTA` del renglón de remito). Endpoints `GET /api/informes/ventas` y `/margenes` (§4) con `reexpresar` (usa `indicesPara`-like lectura de `IndiceInflacion` y `coeficientes`). `helpers-informes.ts`: `escenarioInformes(app, prisma)` arma el ejemplo de §2 sobre `prepararPedidos` (artículo A con inventario inicial 100 @ 10 el 02/11; servicio S; clientes X = `clienteRI`, Y = otro cliente RI creado ahí; cotización USD 1000) y devuelve `{ ...e, a, s, y }`.

- [ ] **Step 1: Tests que fallan:**
  - `it('reproduce el ejemplo del spec por cliente y por artículo')`: `ventas?desde=2026-11-01&hasta=2026-11-30&agrupar=cliente` → filas X `{ ventas '560.00', costo '280.00', margen '280.00' }`, Y `{ ventas '500.00', costo '50.00', sinCosto '300.00' }`; totales `{ ventas '1060.00', costo '330.00' }`. `agrupar=articulo` → A `ventas '760.00' costo '330.00' margen '430.00' margenPct '56.58'`, S `sinCosto '300.00'`. `margenes?...` → `totales.cobertura '71.70'`, `margenPct '56.58'`.
  - `it('coincide con el Mayor')`: saldo de 4.1.01 (haber − debe) `1060.00`, de 5.1.01 `330.00`.
  - `it('no cuenta borradores ni rechazados')` (Review Focus 1): un borrador y uno rechazado (estado seteado con prisma) no cambian los totales.
  - `it('remito facturado en dos partes')` (Review Focus 2): remito de 20 facturado 12 + 8 → costo total de esas facturas 200.00.
  - `it('agrupa por mes y reexpresa')`: una factura de octubre de 1000 (fecha 2026-10-15, período octubre abierto) e índices 10/2026 = 100, 11/2026 = 110; `agrupar=mes&desde=2026-10-01&hasta=2026-11-30&reexpresar=true` → octubre `1100.00`; sin índice de octubre → `aviso 'Faltan los índices de: 10/2026: se muestran importes nominales'` y octubre `1000.00`.
  - `it('valida fechas y permisos')`: sin `desde` → 400; desde > hasta → 400; 4 años → 400 `El período no puede superar los 3 años`; usuario sin `informes.ver` → 403.
  - `it('exporta')`: `formato=xlsx` y `pdf` con su content-type.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar (SQL agregado o `findMany` con `select` acotado; los cálculos en `Decimal`). - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(informes): ventas y márgenes con costo de stock y reexpresión`.

### Task 3: Antigüedad de saldos y rotación de stock

**Files:** Create `apps/api/src/informes/fuentes/{cuentas.ts,stock.ts}`; Modify `informes.service.ts`, `informes.controller.ts`; Test `apps/api/test/informes-saldos-stock.e2e-spec.ts`

**Interfaces — Produces:** `antiguedad(tx, tipo: 'clientes' | 'proveedores', corte: Date)` y `rotacion(tx, desde, hasta)` con las filas de §4. Clientes = movimientos con `origenTipo` en `ORIGENES_CLIENTE` (de `compras/comun`); proveedores = el resto. Saldo considerado: `saldoPesos` actual de movimientos no anulados con `fecha ≤ corte`. Positivo → tramo por vencimiento; negativo → `aFavor`. Stock: valor a una fecha = suma de `importe` del kardex con `fecha ≤ fecha` (como la valuación); costo vendido del período = el de `renglonesVendidos` por artículo.

- [ ] **Step 1: Tests que fallan:**
  - `it('antigüedad de clientes por tramos')`: facturas emitidas con vencimientos a 10, 45, 75 y 120 días antes del corte 2026-11-30 (fechas de factura y vencimiento seteadas con prisma sobre los movimientos) y una a vencer → cada importe en su tramo; total por cliente y totales.
  - `it('anticipo mayor que la deuda')` (Review Focus 5): cobro sin aplicar de 2000 y deuda de 1210 → `aFavor '-2000.00'`, `d1_30 '1210.00'`, `total '-790.00'`.
  - `it('antigüedad de proveedores')`: `facturaPendiente` de compras con vencimiento pasado → tramo correcto; los movimientos de clientes no aparecen.
  - `it('rotación del ejemplo')` (escenario de Task 2): `rotacion?desde=2026-11-01&hasta=2026-11-30` → A `{ stockInicial '0.00', stockFinal '670.00', costoVendido '330.00', rotacion '0.99', diasCobertura '60.9' }`.
  - `it('exporta antigüedad')`: xlsx.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(informes): antigüedad de saldos y rotación de stock`.

### Task 4: Tablero

**Files:** Modify `informes.service.ts`, `informes.controller.ts`; Test `apps/api/test/informes-tablero.e2e-spec.ts`

**Interfaces — Produces:** `GET /api/informes/tablero` con la forma de §4. `cobranzasVencidas` = suma de tramos vencidos (no `aVencer`, no `aFavor`) de clientes al `hasta`; `deudaVencida` = lo mismo de proveedores; `stock` = valor del kardex al `hasta`; `ventasPorMes` = 12 meses que terminan en el mes de `hasta` (meses sin ventas en 0).

- [ ] **Step 1: Tests que fallan:**
  - `it('indicadores del ejemplo')`: tablero de noviembre → `ventas.valor '1060.00'`, `margenPct.valor '56.58'`, `stock.valor '670.00'`; `ventasPorMes` con 12 elementos, el último `{ mes: '2026-11', ventas '1060.00', costo '330.00', margen '430.00' }`; `topClientes[0]` X; `topArticulos[0]` A.
  - `it('comparaciones')` (Review Focus 3): una factura de octubre de 500 → `ventas.anterior '500.00'`; período de un día 2026-11-02 → anterior 2026-11-01.
  - `it('empresa vacía')` (Review Focus 4): sesión nueva → todos los valores `'0.00'`, `margenPct.valor null`, 12 meses en 0, sin error.
  - `it('reexpresa la serie')`: con índices de los 12 meses → `ventasPorMes` reexpresado; sin alguno → `aviso`.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** implementar. - [ ] **Step 4:** PASS; suite API completa verde.
- [ ] **Step 5:** commit `feat(informes): tablero de dirección`.

### Task 5: Web

**Files:**
- Modify: `apps/web/package.json` (`@mantine/charts@7.17.8`, `recharts@2.15.4`), `apps/web/src/main.tsx` (estilos `@mantine/charts/styles.css`), `apps/web/src/layout/menu.ts` (+ test), `apps/web/src/paginas/rutas.tsx`, la página de inicio (`InicioPage.tsx`: si el usuario tiene `informes.ver`, muestra el tablero)
- Create: `apps/web/src/informes/{TableroPage.tsx,InformesPages.tsx,comun.ts,informes.test.tsx}`

**Interfaces — Produces:** rutas `/informes/tablero`, `/informes/ventas`, `/informes/margenes`, `/informes/antiguedad`, `/informes/rotacion`; menú "Informes de gestión" (`informes.ver`). Componentes exportados para test: `TarjetaIndicador({ titulo, valor, anterior, formato, destino })`, `TablaAntiguedad({ datos })`, `seriesVentas(ventasPorMes)` (datos para el gráfico: `{ mes: 'nov 26', ventas: number, margen: number }`).

- [ ] **Step 1: Tests que fallan** (`informes.test.tsx`):
  - `TarjetaIndicador` con valor 1100 y anterior 1000 → muestra `$ 1.100,00` y `+10,00 %` en verde; anterior 1200 → `-8,33 %` en rojo; sin anterior → sin variación.
  - `TablaAntiguedad` con dos filas → fila de totales con la suma de cada tramo.
  - `seriesVentas([{ mes: '2026-11', ventas: '1060.00', costo: '330.00', margen: '430.00' }])` → `[{ mes: 'nov 26', ventas: 1060, margen: 430 }]`.
  - menú: con `informes.ver` aparecen `Tablero de dirección` y `Antigüedad de saldos`.
- [ ] **Step 2:** FAIL. - [ ] **Step 3:** `pnpm --filter web add @mantine/charts@7.17.8 recharts@2.15.4` (exactas) e implementar páginas (BarChart con `series` ventas y línea de margen vía `CompositeChart`; rankings con `BarChart orientation="vertical"`).
- [ ] **Step 4:** PASS; `pnpm --filter web build`.
- [ ] **Step 5:** commit `feat(web): tablero e informes de gestión`.

### Task 6: E2E y README

**Files:** Create `e2e/informes.spec.ts`; Modify `README.md`

- [ ] **Step 1: Test** `test('informes: el contador abre el tablero, entra a ventas por cliente y descarga el Excel')`: login contador; `/informes/tablero` muestra `Ventas` y `Margen bruto`; clic en la tarjeta Ventas → `/informes/ventas`; elegir agrupar `Cliente`; Excel → descarga `ventas-…xlsx`.
- [ ] **Step 2:** recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 12/12.
- [ ] **Step 3:** README sección Entrega 13.
- [ ] **Step 4:** suites API, web, e2e verdes.
- [ ] **Step 5:** commit `test(e2e): informes; docs: README entrega 13`.
