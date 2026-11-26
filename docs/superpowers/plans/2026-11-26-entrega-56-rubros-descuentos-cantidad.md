# Entrega 56 — Rubros de artículos y descuentos por cantidad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rubros de artículos con margen por rubro en cada lista desde el costo, y escalas de descuento por cantidad (por rubro, con excepción por artículo) que sugieren la bonificación del renglón.

**Architecture:** Un módulo `articulos/rubros` (ABM de `RubroArticulo`, `Articulo.rubroId`) y las escalas (`EscalaDescuento`) con una función de dominio `bonificacionPorCantidad` en `ventas/precios/escalas.ts`, usada por el endpoint de bonificación sugerida y por el armado del lote (E55). El margen por rubro y lista (`MargenRubroLista`) entra en el cálculo de listas COSTO de `PreciosService`. La web sugiere la bonificación en `GrillaVenta` como hoy el precio.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-entrega-56-rubros-descuentos-cantidad-design.md`

## Global Constraints
- Mensajes exactos: `Ya existe un rubro con ese nombre`, `Rubro inexistente o inactivo`, `Hay dos escalas con la misma cantidad`, `La lista no se calcula desde el costo`.
- Rangos: bonificación/porcentaje de escala > 0 y ≤ 100 con hasta 2 decimales; `desde` > 0; margen 0–1000 con 2 decimales.
- Precedencia del margen en listas COSTO: `PrecioLista.margenPct` > `MargenRubroLista` (rubro activo) > `ListaPrecios.porcentaje`.
- Escala: las del artículo si tiene alguna; si no, las de su rubro activo; la de mayor `desde` ≤ cantidad.
- Permisos: rubros y escalas ver `articulo.ver`, editar `articulo.editar`; márgenes por rubro ver `RequiereAlguno('venta.ver','pedido.gestionar')`, guardar `precios.editar`; bonificación sugerida `RequiereAlguno('venta.emitir','pedido.gestionar')`.
- Modelos nuevos en `MODELOS_DE_EMPRESA`; migraciones aparte; desplegar en las tres bases.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Artículo sin rubro, o con rubro inactivo: sin escala del rubro y margen de la lista.
2. Artículo con escalas propias que no alcanzan la cantidad y rubro con escala que sí: no se usa la del rubro (las propias reemplazan).
3. Renglón cuyo usuario cambia la cantidad después de escribir la bonificación a mano: no se pisa; uno con bonificación sugerida que baja de escala se recalcula (o vacía).
4. Lista COSTO con margen por artículo y por rubro: gana el del artículo; otra lista COSTO sin margen del rubro usa su porcentaje.
5. Respuesta tardía de la sugerencia tras cambiar artículo o cantidad: se descarta.

---

### Task 1: Rubros, escalas y bonificación sugerida (API)
**Files:** `prisma/schema.prisma` + migración (`RubroArticulo { id, empresaId, nombre, activo @default(true), creadoEn; @@unique([empresaId, nombre]) }`, `Articulo.rubroId String? @db.Uuid`, `EscalaDescuento { id, empresaId, rubroId String? @db.Uuid, articuloId String? @db.Uuid, desde Decimal(18,4), porcentaje Decimal(5,2); @@unique([empresaId, rubroId, desde]); @@unique([empresaId, articuloId, desde]) }`), `src/prisma/modelos-empresa.ts`. Create `src/articulos/rubros.controller.ts` + `rubros.service.ts` (registrar en `articulos.module.ts`): `GET /api/rubros-articulos` (con `?activos=1`), `POST`, `PATCH :id` (`nombre`, `activo`), `GET/PUT /api/rubros-articulos/:id/escalas`. Modify `articulos.service.ts`/`articulos.controller.ts`: `rubroId` en alta y edición (rubro inexistente o inactivo → 400 `Rubro inexistente o inactivo`, salvo que sea el que el artículo ya tiene), listado con `rubroId`, `rubro` (nombre) y filtro `?rubroId=`; `GET/PUT /api/articulos/:id/escalas`. Esquema común de escalas: `{ escalas: { desde: number > 0, porcentaje: number > 0 ≤ 100 (2 decimales) }[] }`, `desde` repetidos → 400 `Hay dos escalas con la misma cantidad`; PUT reemplaza todas en una transacción. Create `src/ventas/precios/escalas.ts`: `bonificacionPorCantidad(tx: TxEmpresa, articuloId: string, cantidad: Dec | number): Promise<{ bonificacionPct: string | null; origen: 'ARTICULO' | 'RUBRO' | null; desde: string | null }>`. Endpoint `GET /api/ventas/bonificacion?articuloId=&cantidad=` en `precios.controller.ts`.
**Test:** `apps/api/test/rubros-escalas.e2e-spec.ts`.
- [ ] Pruebas que fallan: crear rubro *Bebidas*; repetido → 400 `Ya existe un rubro con ese nombre`; artículo con `rubroId` → listado con `rubro: 'Bebidas'` y filtro; rubro inactivo al asignar a otro artículo → 400 `Rubro inexistente o inactivo`, el artículo que ya lo tenía se puede editar; escalas del rubro `[{12, 5}, {48, 10}]` → GET las devuelve ordenadas; `desde` repetido → 400 con el mensaje; bonificación sugerida: cantidad 6 → `null`, 12 → `'5'` origen `RUBRO`, 100 → `'10'`; artículo con escala propia `[{100, 3}]`: 50 → `null` (no usa la del rubro), 100 → `'3'` origen `ARTICULO`; rubro inactivo → `null`; artículo sin rubro → `null`; PUT `[]` borra las escalas.
- [ ] `npx jest --runInBand test/rubros-escalas test/articulos` → PASS. Commit `feat(articulos): rubros y escalas de descuento por cantidad`.

### Task 2: Margen por rubro y lista, y lote (API)
**Files:** `prisma/schema.prisma` + migración (`MargenRubroLista { id, empresaId, listaId, rubroId, margenPct Decimal(9,2); @@unique([empresaId, listaId, rubroId]) }`), `modelos-empresa.ts`. `ventas/precios/precios.controller.ts` + `precios.service.ts`: `GET/PUT /api/ventas/listas/:id/margenes-rubro` (`{ margenes: { rubroId, margenPct: 0–1000 }[] }`; lista no COSTO → 400 `La lista no se calcula desde el costo`; rubro inexistente o inactivo → 400 `Rubro inexistente o inactivo`; GET devuelve todos los rubros activos con `margenPct | null`). En el cálculo COSTO (hoy `actual?.margenPct != null ? actual.margenPct : lista.porcentaje`): margen = artículo > rubro activo en esa lista > lista; la vista previa agrega `margen: string` y `origenMargen: 'ARTICULO' | 'RUBRO' | 'LISTA'` por fila. `ventas/lotes/armado.ts`: renglón sin pedido con artículo → `bonificacionPct` de `bonificacionPorCantidad(tx, articuloId, cantidad pendiente)` (o 0).
**Test:** `apps/api/test/rubros-escalas.e2e-spec.ts` (agregar), `apps/api/test/facturacion-lotes.e2e-spec.ts` (agregar).
- [ ] Pruebas que fallan: listas COSTO *Mayorista* 30 % y *Minorista* 60 %, artículo del rubro *Bebidas* con costo 1000; margen del rubro 20 en *Mayorista* → vista previa *Mayorista* 1200 `origenMargen: 'RUBRO'`, *Minorista* 1600 `'LISTA'`; margen del artículo 50 en *Mayorista* → 1500 `'ARTICULO'`; rubro inactivo → 1300 `'LISTA'`; PUT en una lista MANUAL → 400 con el mensaje; lote: remito sin pedido de 12 unidades del artículo con escala del rubro 12 → 5 % → renglón con `bonificacionPct: '5'` y total con el descuento.
- [ ] `npx jest --runInBand test/rubros-escalas test/listas-derivadas test/facturacion-lotes` → PASS. Commit `feat(precios): margen por rubro y lista; escalas en la facturación por lotes`.

### Task 3: Pantallas y e2e
**Files:** web `apps/web/src/articulos/RubrosArticulosPage.tsx` (ruta `/maestros/rubros-articulos`, menú Maestros *Rubros de artículos* con `articulo.ver`; tabla nombre y activo, alta/edición, botón *Escalas*), `apps/web/src/articulos/EditorEscalas.tsx` (exporta `EditorEscalas({ url, titulo, aviso? })`: filas *Desde cantidad* y *% de descuento*, agregar/quitar, *Guardar* con PUT), formulario/listado de artículos (campo y columna *Rubro*, filtro, botón *Escalas* con aviso `Sin escalas propias: usa las del rubro <nombre>`), `apps/web/src/ventas/ListasPreciosPage.tsx` (lista COSTO: botón *Márgenes por rubro* con modal de filas rubro/margen; vista previa del recálculo con columna *Margen* y origen *Artículo*/*Rubro*/*Lista*), `apps/web/src/ventas/GrillaVenta.tsx` (prop `sugerirBonificacion?: (articuloId: string, cantidad: string) => Promise<string | null>`; `RenglonVentaEditable.bonificacionManual?: boolean`, no se manda en `cuerpoRenglonVenta`; escribir en *Bonificación %* → manual; al elegir artículo o cambiar la cantidad de un renglón DIRECTO no manual → consulta y aplica con `aplicarBonificacionSugerida(renglones, i, articuloId, cantidad, pct | null)` que descarta si el renglón cambió de artículo o cantidad o pasó a manual), `PedidoVentaPage.tsx` y `ComprobanteVentaPage.tsx` (pasan `sugerirBonificacion` solo en pedido y en FACTURA; al cargar un guardado, renglones con bonificación ≠ 0 → `bonificacionManual: true`), `e2e/rubros-descuentos.spec.ts` (encadenado después de `facturacion-lotes`, agregado al `testIgnore` de `general`), `docs/pendientes.md` (ítems 16 y 17: rubros y descuentos por cantidad hechos en la entrega 56; quedan tope por usuario, importe fijo, pronto pago, recálculo automático y despachos en el costo).
**Test:** `apps/web/src/ventas/descuentos-cantidad.test.tsx`.
- [ ] Pruebas que fallan (vitest): `aplicarBonificacionSugerida` aplica `'5'` a un renglón no manual con ese artículo y cantidad, no toca uno manual, descarta si cambió la cantidad, vacía con `null`; `GrillaVenta` con `sugerirBonificacion` simulado: elegir artículo con cantidad 12 → campo *Bonificación %* `5`; escribir `7` y cambiar la cantidad → sigue `7`; `EditorEscalas` manda el PUT con las filas; el menú tiene `/maestros/rubros-articulos`.
- [ ] e2e: crear rubro *Bebidas* con escala desde 10 → 5 %, asignarlo a un artículo, en una factura elegir el artículo con cantidad 10 → *Bonificación %* 5.
- [ ] vitest, `pnpm build`, e2e del proyecto sobre base nueva y `npx jest --runInBand test/rubros-escalas` → PASS. Commit `feat(web): rubros de artículos y descuentos por cantidad`.

Al final: suite completa de la API (dos shards), web y e2e sola sobre base nueva; revisión final.
