# Entrega 52 — Listas de precios derivadas y precio desde el costo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Listas calculadas desde otra lista (± %) o desde el costo (+ margen sobre el costo), con redondeo, precios fijos, margen por artículo y un recálculo con vista previa.

**Architecture:** Regla en `ListaPrecios` (base, lista base, porcentaje, redondeo); `PrecioLista.fijo` y `margenPct`; un módulo puro de cálculo (`precios/derivadas.ts`) y un servicio de recálculo (`precios/recalculo.service.ts`) con vista previa y aplicación, historial `RECALCULO`.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-entrega-52-listas-derivadas-design.md`

## Global Constraints
- Margen sobre el costo: `precio = costo × (1 + margen/100)`; desde lista: `precio = base × (1 + porcentaje/100)`; luego `aumentar`-style redondeo (`redondear(valor, redondeo)`, mismo criterio que `aumento.ts`).
- Mensajes: `La lista base no puede depender de esta lista`, `La lista se carga a mano`, `No hay cotización de USD para hoy`, motivos `Precio fijo`, `Sin costo`, `Sin precio en la lista base`, aviso `Las listas <nombres> dependen de esta: recalcúlelas`.
- Enum nuevo `RECALCULO` en `MotivoPrecio` en su propia migración.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Listas MANUAL existentes: todo igual (precios, aumento, importación, precio sugerido); la marca fijo no aparece.
2. Lista USD desde costo en pesos (y lista ARS desde lista USD): conversión con la cotización del día.
3. Última compra con dos renglones del mismo artículo y con NC/anuladas posteriores: solo facturas/tiques confirmados, promedio ponderado.
4. Aplicar con `articuloIds` que incluye un artículo fijo o sin costo: no se cambia.
5. Cadena A → B → C: cambiar la base de A a C da el error de dependencia.

---

### Task 1: Regla de la lista, fijo y margen
**Files:** `prisma/schema.prisma` + migraciones (`enum BaseLista { MANUAL LISTA COSTO }` y `RECALCULO` en `MotivoPrecio` en una migración; campos en otra): `ListaPrecios.base BaseLista @default(MANUAL)`, `listaBaseId String? @db.Uuid`, `porcentaje Decimal @default(0) @db.Decimal(9,2)`, `redondeo String @default("0.01")`; `PrecioLista.fijo Boolean @default(false)`, `margenPct Decimal? @db.Decimal(9,2)`. `precios/dto.ts` (esquema de lista con `base`, `listaBaseId`, `porcentaje` (LISTA: −99,99 a 1000; COSTO: 0 a 1000), `redondeo` ∈ `REDONDEOS`; `esquemaMarcas = { fijo?: boolean; margenPct?: number | null }` (margen 0 a 1000)); `precios.service.ts` (`crearLista`/`modificarLista` validan la base: LISTA exige `listaBaseId` existente, no ella misma ni una que dependa de ella; `fijar` con `fijo = true` cuando la lista no es MANUAL y el motivo es MANUAL, IMPORTACION o AUMENTO); `precios.controller.ts` (`PATCH /api/precios/listas/:id/precios/:articuloId/marcas` con `esquemaMarcas`, `precios.editar`; el listado de precios devuelve `fijo` y `margenPct`; `GET /listas` devuelve la regla).
**Test:** `apps/api/test/listas-derivadas.e2e-spec.ts`.
- [ ] Pruebas que fallan: crear lista LISTA con base → guarda la regla; base inexistente → 400; A base de B y B base de A → 400 `La lista base no puede depender de esta lista`; B con base A y C con base B; modificar A con base C → 400 con el mismo mensaje; COSTO con porcentaje −5 → 400; precio cargado a mano en lista calculada → `fijo: true`; en lista MANUAL → `fijo: false`; aumento masivo en lista calculada → fijos; `PATCH marcas { fijo: false, margenPct: 40 }` → guardado; margen en un artículo sin precio en la lista → 404 `El artículo no tiene precio en la lista`.
- [ ] `npx jest --runInBand test/listas-derivadas test/ventas-precios` → PASS. Commit `feat(precios): regla de listas derivadas, precios fijos y margen por artículo`.

### Task 2: Costo y recálculo
**Files:** Create `precios/derivadas.ts`: `redondear(valor: Dec, redondeo: Redondeo): Dec` (extraído de `aumentar`, que pasa a usarlo); `precioDerivado(base: Dec, porcentaje: Dec, redondeo: Redondeo): Dec`. Create `precios/costos.ts`: `costosDeArticulos(tx, articuloIds: string[]): Promise<Map<string, Dec>>` (último comprobante de compra CONFIRMADO de tipo FACTURA o TICKET con renglón del artículo, por `fechaEmision` y `numeroInterno` descendentes; Σ importe × cotización ÷ Σ cantidad de los renglones del artículo en ese comprobante; si no hay, `Articulo.costoPromedio` > 0). Create `precios/recalculo.service.ts`: `vistaPrevia(listaId)` → `{ filas: { articuloId, codigo, descripcion, actual: string | null, nuevo: string | null, variacionPct: string | null, motivo: string | null }[] }`; `aplicar(listaId, articuloIds?)` → `{ actualizados: number; agregados: number; aviso: string | null }` (recalcula dentro de la transacción con `bloquearListas`; usa `fijar(..., 'RECALCULO')` sin marcar fijo; auditoría `ListaPrecios` MODIFICAR). Conversión de moneda: si la moneda de origen (lista base o pesos del costo) difiere de la lista, `cotizacion(tx, 'USD', hoy)`; sin cotización → 400 `No hay cotización de USD para hoy`. Controller: `GET /api/precios/listas/:id/recalculo` y `POST /api/precios/listas/:id/recalculo` (`precios.editar`).
**Test:** `apps/api/src/ventas/precios/derivadas.spec.ts`; `apps/api/test/listas-derivadas.e2e-spec.ts` (agregar).
- [ ] Pruebas que fallan (unitarias): `precioDerivado(1000, -10, '1') = 900`; `precioDerivado(1234.56, 30, '10') = 1600`; `redondear` igual que el `aumentar` de hoy para los casos de `aumento.spec.ts`.
- [ ] Pruebas que fallan (e2e): lista COSTO 30 % con redondeo 1: artículo comprado a 1000 (factura) → nuevo 1300; segunda factura posterior a 1100 con dos renglones (1 × 1000 y 1 × 1200) → costo 1100 → 1430; una NC posterior no cuenta; artículo sin compras con `costoPromedio` 500 → 650; sin costo → motivo `Sin costo`; margen propio 50 % → 1650; fijo → motivo `Precio fijo` y no cambia al aplicar aunque esté en `articuloIds`; lista LISTA −10 % desde la COSTO → 90 % de cada precio, `Sin precio en la lista base` para los que faltan; aplicar → historial `RECALCULO`, precios iguales sin historial, aviso de listas dependientes; lista MANUAL → 400 `La lista se carga a mano`; lista USD desde costo con cotización 1000 → costo 1000 pesos = 1,30 USD (redondeo 0.01); sin cotización del día → 400.
- [ ] `npx jest --runInBand test/listas-derivadas test/ventas-precios src/ventas/precios` → PASS. Commit `feat(precios): recálculo de listas derivadas y desde el costo`.

### Task 3: Pantalla y e2e
**Files:** `apps/web/src/ventas/ListasPreciosPage.tsx` (en el alta/edición de lista: *Base* (`Manual`, `Otra lista`, `Costo`), *Lista base*, *Porcentaje* o *Margen sobre el costo (%)*, *Redondeo*; botón *Recalcular* en listas calculadas: modal con la tabla de la vista previa (Artículo, Actual, Nuevo, Variación %, Motivo), casillas marcadas salvo las que tienen motivo, *Aplicar* y notificación con el aviso; en la tabla de precios de una lista calculada, columna *Fijo* con *Quitar* y, en COSTO, *Margen %* editable), `e2e/listas-derivadas.spec.ts` (proyecto encadenado después de `ventas-descuentos`), `docs/pendientes.md` (ítem 17 hecho; quedan rubros, recálculo automático y despachos en el costo).
**Test:** `apps/web/src/ventas/listas-derivadas.test.tsx`.
- [ ] Pruebas que fallan (vitest): el formulario muestra *Lista base* solo con base *Otra lista* y *Margen sobre el costo (%)* con base *Costo*; la vista previa marca las filas sin motivo y desmarca las que lo tienen; aplicar manda solo los elegidos.
- [ ] e2e: crear lista *Mayorista* con base la lista por defecto −10 %, recalcular, aplicar, ver un precio al 90 %.
- [ ] vitest completo, `pnpm build`, e2e del proyecto → PASS. Commit `feat(web): listas de precios derivadas y recálculo`.

Al final: suite completa de la API (dos shards), web y e2e sola sobre base nueva; revisión final.
