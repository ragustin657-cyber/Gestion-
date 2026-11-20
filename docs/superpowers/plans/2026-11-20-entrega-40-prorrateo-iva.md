# Entrega 40 — Prorrateo del crédito fiscal de IVA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Destino del crédito de IVA por compra, coeficiente acumulado del ejercicio, crédito computable y no computable en la posición mensual, ajuste anual y asiento del no computable.

**Architecture:** Cálculo puro nuevo en `apps/api/src/impuestos/posicion-iva/prorrateo.ts` (coeficiente, separación del crédito, ajuste). `PosicionIvaService.fuentes` agrega crédito por destino (desde las filas del Libro IVA Compras, que pasan a llevar `destino`) y ventas gravadas/exentas del mes (desde el Libro IVA Ventas); `borrador` aplica el prorrateo cuando corresponde; `renglonesAsiento` agrega `IVA_NO_COMPUTABLE`.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-entrega-40-prorrateo-credito-iva-design.md`

## Global Constraints
- Mensajes exactos: `Hay posiciones de IVA cerradas desde MM/AAAA: reábralas para cambiar el prorrateo`, `Sin ventas en el ejercicio: el crédito de uso común se computa entero`, `Con prorrateo del crédito fiscal: declare el prorrateo global en el Libro IVA Digital (coeficiente X)` (X con 4 decimales y coma), renglón `Ajuste anual del prorrateo`.
- Cuenta `5.2.14 IVA crédito fiscal no computable`, concepto `IVA_NO_COMPUTABLE` (total 49).
- Coeficiente a 4 decimales, acotado a [0, 1]; importes a 2 decimales.
- Sin prorrateo activo (o mes anterior a `prorrateoDesde`) la posición es idéntica a la E37.
- Un solo jest a la vez; nunca en paralelo con la e2e. Reloj de pruebas 2026-11-06 (meses cerrables ≤ 10/2026).

## Review Focus
1. Empresa sin prorrateo: posición y asiento idénticos a los de la E37 (Task 2).
2. Ajuste anual con ejercicio que no empieza en enero (inicio en julio, cierre de junio) (Task 1).
3. NC de compra marcada como común: resta crédito común (Task 2).
4. Ajuste que deja el no computable negativo: asiento al Haber de 5.2.14 y cuadra (Task 1).
5. Cambiar el destino de una compra de un mes cerrado → 400 con el mensaje de la E37 (Task 2).

---

### Task 1: Cálculo puro
**Files:** Create `apps/api/src/impuestos/posicion-iva/prorrateo.ts`. Modify `calculo.ts` (`renglonesAsiento` acepta `creditoNoComputable?: string` y lo pone en `IVA_NO_COMPUTABLE`). **Test:** `apps/api/src/impuestos/posicion-iva/prorrateo.spec.ts`, `calculo.spec.ts`.
**Produces:**
- `coeficienteProrrateo(gravadas: string, exentas: string) → { coeficiente: string; sinVentas: boolean }` (4 decimales, [0,1]; sin ventas → '1.0000').
- `separarCredito(e: { gravado: string; exento: string; comun: string; coeficiente: string; ajuste?: string }) → { computable: string; noComputable: string }` (computable = gravado + comun × coef + ajuste; noComputable = total − computable).
- `ajusteAnual(e: { comunPorMes: { comun: string; computado: string }[]; coeficienteAnual: string }) → string` (Σ comun × coefAnual − Σ computado del común).
- `ultimoMesEjercicio(mes: number, inicioMes: number) → boolean` y `mesesDelEjercicio(anio, mes, inicioMes) → { anio: number; mes: number }[]` (desde el inicio del ejercicio hasta el mes inclusive).
- [ ] Pruebas que fallan: coeficiente 70.000/(70.000+30.000) = 0.7000; sin ventas → 1 y `sinVentas`; negativo acotado a 0; separar: gravado 1.000, exento 200, común 500, coef 0.7 → computable 1.350, no computable 350; ajuste: comunes [500 a 0.7 = 350, 500 a 0.5 = 250], anual 0.6 → 600 − 600 = 0; con anual 0.4 → −200 y no computable negativo posible; `mesesDelEjercicio(2026, 8, 7)` = julio y agosto 2026; `mesesDelEjercicio(2027, 6, 7)` = 12 meses desde julio 2026; `ultimoMesEjercicio(6, 7)` true; asiento con no computable 350 cuadra y lo pone al Debe de `IVA_NO_COMPUTABLE`; negativo al Haber.
- [ ] `npx jest src/impuestos/posicion-iva` → FAIL → implementar → PASS. Commit `feat(iva): cálculo del prorrateo del crédito fiscal`.

### Task 2: Datos, destino de la compra y posición
**Files:** `prisma/schema.prisma` (+ migraciones: enum y columnas; datos: cuenta y `ConfigCuenta`), `plan-cuentas-modelo.ts`, `conceptos.ts`; `compras/comprobantes/{dto,comprobantes.service,comprobantes.controller}.ts` (`destinoCreditoIva` al cargar; `PATCH :id/destino-iva` con `verificarMesIvaAbierto` y auditoría); `compras/consultas/consultas.service.ts` (fila del libro con `destino`); `impuestos/config/*` (campos y guardia); `impuestos/posicion-iva/{posicion-iva.service,posicion-iva.controller}.ts` (fuentes por destino y ventas gravadas/exentas, prorrateo en el borrador, campos nuevos en `PosicionIva`, filas del Excel/PDF); `impuestos/libros-iva/libro-iva-digital.ts` (aviso). **Test:** `apps/api/test/prorrateo-iva.e2e-spec.ts`.
- [ ] Pruebas que fallan:
  - Sin prorrateo: posición idéntica (crédito total al saldo técnico, campos nuevos nulos).
  - Prorrateo desde 10/2026, inicio del ejercicio enero, iniciales gravadas 0 / exentas 0: venta gravada 1.000 neto y venta exenta 1.000 en octubre → coeficiente 0.5000; compras de octubre GRAVADO (IVA 210), EXENTO (IVA 105) y COMUN (IVA 210) → computable 315, no computable 210; cerrar → asiento con 5.2.14 al Debe 210.
  - Iniciales gravadas 3.000: coeficiente (3.000 + 1.000)/(3.000 + 2.000) = 0.8000.
  - NC de compra COMUN resta crédito común.
  - `PATCH destino-iva` en compra de mes abierto → la posición cambia; de mes cerrado → 400 con el mensaje de la E37.
  - Activar el prorrateo con una posición cerrada en el mes desde o después → 400 `Hay posiciones de IVA cerradas desde 10/2026: reábralas para cambiar el prorrateo`; con cerradas solo antes → ok.
  - Ajuste anual: ejercicio julio–junio (prorrateoInicioMes 7, desde 09/2026, reloj movido a 2027-07-05): cerrar septiembre (coef 1, común 210 computado entero) y llegar a junio 2027 con exentas que bajan el coeficiente anual → renglón de ajuste negativo en junio y no computable con el ajuste incluido. (Si el escenario de 10 meses es demasiado pesado, ruling: ejercicio que termina en octubre con `prorrateoInicioMes` 11 y prorrateo desde 09/2026: septiembre y octubre.)
  - Libro IVA Digital con prorrateo → advertencia con el coeficiente.
  - Sin ventas en el ejercicio → aviso y coeficiente 1.
- [ ] Implementar; migraciones con `prisma migrate diff`, desplegadas en `gestion`, `gestion_test`, `gestion_mig`.
- [ ] `npx jest --runInBand test/prorrateo-iva test/posicion-iva test/compras test/impuestos test/compras-config test/ventas-maestros test/pagos-config` → PASS (conteos a 49). Commit `feat(iva): prorrateo del crédito fiscal en la posición mensual`.

### Task 3: Pantallas y e2e
**Files:** `apps/web/src/impuestos/ConfigImpuestosPage.tsx` (prorrateo, primer mes, inicio del ejercicio, iniciales), factura de compra (selector *Destino del crédito de IVA* con el prorrateo activo) y consulta de la compra (selector editable), Libro IVA Compras (columna *Destino*), `PosicionIvaPage.tsx` (computable, no computable, coeficiente, ajuste); `e2e/prorrateo-iva.spec.ts` (proyecto propio después de `percepciones-ventas`). **Test:** `apps/web/src/impuestos/prorrateo.test.tsx`.
- [ ] Pruebas que fallan: el detalle de la posición con prorrateo muestra *Crédito fiscal computable*, *Crédito fiscal no computable*, *Coeficiente de prorrateo 0,5000* y el ajuste cuando no es cero; sin prorrateo no los muestra. e2e: el contador activa el prorrateo desde dos meses atrás, abre la posición de ese mes y ve el coeficiente.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): prorrateo del crédito fiscal de IVA`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final; `docs/pendientes.md` §2 con el aviso del Libro IVA Digital a verificar.
