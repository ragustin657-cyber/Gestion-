# Entrega 45 — Ajuste por inflación impositivo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ajuste por inflación impositivo (Título VI de Ganancias) por ejercicio: estático, dinámico desde el Mayor, partidas manuales, prueba de los 36 meses y planilla.

**Architecture:** Función pura `ajusteImpositivo` en `apps/api/src/impuestos/ajuste-inflacion/calculo.ts` (la reutiliza la entrega 46). `AjusteImpositivoService` lee del Mayor los saldos nominales al inicio y los movimientos del ejercicio con SQL agregado por asiento, más las partidas manuales, y arma la planilla. `CuentaContable.ajusteImpositivo` clasifica activo y pasivo. Pantalla en *Impuestos*.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-entrega-45-ajuste-inflacion-impositivo-design.md`

## Global Constraints
- Sin asientos: nada se contabiliza; solo se guardan la clasificación de las cuentas y las partidas manuales.
- Mensajes exactos: `Faltan los índices de: mm/aaaa, …` (orden cronológico), `No corresponde aplicar el ajuste: la variación de los últimos 36 meses es <x> %` (`<x>` con coma decimal y 2 decimales, p. ej. `87,50`), `Indique el ejercicio`, `Ejercicio no encontrado`, `Partida no encontrada`.
- Enum `AjusteImpositivoCuenta { COMPUTABLE EXCLUIDO }` en su propia migración; `CuentaContable.ajusteImpositivo @default(COMPUTABLE)`; modelo `AjusteImpositivoPartida { id, empresaId, ejercicioId, concepto, tipo AjusteImpositivoPartidaTipo (ACTIVO_INICIO|PASIVO_INICIO|DINAMICO), fecha Date?, importe Decimal(18,2), creadoPor, creadoEn }` en `MODELOS_DE_EMPRESA` (enum aparte del dato).
- Redondeo: cada línea (estático, cada movimiento) a 2 decimales; total = suma de las líneas.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Tercer ejercicio del sistema con cierres y aperturas anteriores (y ajuste contable aplicado): saldos al inicio nominales, sin duplicar (Task 2).
2. Apertura inicial como asiento manual configurado en el ajuste contable: entra al estático y no al dinámico (Task 2).
3. Asiento que reclasifica dentro del patrimonio neto (reserva legal) y asiento de amortización: no aparecen en el dinámico (Task 2).
4. Ejercicio sin movimientos ni saldos: planilla en cero sin errores, pero pide los índices (Task 2).
5. Partida manual con importe 0 o tipo dinámico sin fecha: 400 (Task 2).

---

### Task 1: Cálculo puro
**Files:** Create `apps/api/src/impuestos/ajuste-inflacion/calculo.ts`; Test `apps/api/src/impuestos/ajuste-inflacion/calculo.spec.ts`.
**Produces:**
```ts
export type TipoMovimiento = 'APORTE' | 'RETIRO' | 'COMPRA_EXCLUIDO' | 'VENTA_EXCLUIDO' | 'MANUAL';
/** importe con signo: positivo = da ajuste positivo (retiro, compra de excluido); negativo = ajuste negativo. */
export interface MovimientoDinamico { fecha: Date; asientoNumero: number | null; descripcion: string; tipo: TipoMovimiento; importe: Dec }
export interface DatosAjusteImpositivo { mesAnterior: string; mesCierre: string; activoComputable: Dec; pasivoComputable: Dec; manualActivo: Dec; manualPasivo: Dec; movimientos: MovimientoDinamico[]; indice: (mes: string) => Dec }
export interface ResultadoAjusteImpositivo {
  base: Dec; coeficienteEstatico: Dec; estatico: Dec;
  dinamico: (MovimientoDinamico & { coeficiente: Dec; ajuste: Dec })[]; totalDinamico: Dec;
  total: Dec; variacion36: Dec /* en %, 2 decimales */; corresponde: boolean; totalDj: Dec; aviso: string | null;
}
export function mesesNecesarios(d: Pick<DatosAjusteImpositivo, 'mesAnterior' | 'mesCierre' | 'movimientos'>): string[] // A, C, C−36 y los de los movimientos, sin repetir, ordenados
export function clasificarAsiento(renglones: { tipoCuenta: TipoCuenta; excluida: boolean; debe: Dec; haber: Dec }[]): { pn: Dec /* Σ haber − debe de PN */; excluidos: Dec /* Σ debe − haber de activo excluido */ }
export function ajusteImpositivo(d: DatosAjusteImpositivo): ResultadoAjusteImpositivo
```
Reglas (spec §4): coef(m) = I(C)/I(m) − 1; base = (activo + manualActivo) − (pasivo + manualPasivo); estático = round2(−base × (I(C)/I(A) − 1)); ajuste de cada movimiento = round2(importe × coef(mes de su fecha)); variación36 = (I(C)/I(C − 36 meses) − 1) × 100; corresponde si > 100.
- [ ] Pruebas que fallan (índices: A=2025-12 100, C=2026-12 150, 2026-03 110, 2026-05 120, 2026-07 125, 2026-10 140, 2023-12 50):
  - activo 1.000.000, pasivo 400.000 → base 600.000, coef 0,5, estático −300.000; con manualActivo 40.000 → base 640.000, estático −320.000;
  - movimientos: aporte −100.000 (mayo) → −25.000; retiro 50.000 (julio) → 10.000; compra de excluido 200.000 (marzo) → 72.727,27; venta de excluido −30.000 (octubre) → −2.142,86; total dinámico 55.584,41;
  - total = −300.000 + 55.584,41 = −244.415,59; variación36 200 → corresponde, totalDj = total, aviso null;
  - con I(2023-12)=80 → variación36 87,5, corresponde false, totalDj 0, aviso `No corresponde aplicar el ajuste: la variación de los últimos 36 meses es 87,50 %`;
  - pasivo mayor que activo (activo 100.000, pasivo 300.000) → estático +100.000;
  - `clasificarAsiento`: aporte (debe caja 100, haber capital 100) → pn 100, excluidos 0; compra de rodado (debe rodados excluido 200, haber caja 200) → excluidos 200; reserva legal (debe RNA 10, haber reserva 10) → pn 0;
  - `mesesNecesarios` del ejemplo → `['2023-12','2025-12','2026-03','2026-05','2026-07','2026-10','2026-12']`.
- [ ] `cd apps/api && npx jest src/impuestos/ajuste-inflacion` → PASS. Commit `feat(impuestos): cálculo del ajuste por inflación impositivo`.

### Task 2: Clasificación, datos del Mayor, partidas y planilla (API)
**Files:** `prisma/schema.prisma` + migraciones (enums aparte; campo; modelo; datos: `UPDATE "CuentaContable" SET "ajusteImpositivo"='EXCLUIDO'` para las cuentas de origen y amortización de los rubros de bienes de uso); `prisma/modelos-empresa.ts`; `seed/plan-cuentas-modelo.ts` (cuentas de bienes de uso `EXCLUIDO`); `contabilidad/plan-cuentas/*` (`ajusteImpositivo` en el PATCH y en el árbol); Create `impuestos/ajuste-inflacion/{ajuste-impositivo.service,ajuste-impositivo.controller}.ts` registrados en `impuestos.module.ts`. **Test:** `apps/api/test/ajuste-impositivo.e2e-spec.ts`.
**Consumes:** Task 1. **Produces:** `GET /api/impuestos/ajuste-inflacion?ejercicioId=[&formato=xlsx]` (permiso `impuestos.ver`) → `{ ejercicio: {numero, desde, hasta}, estatico: { cuentas: {codigo, nombre, tipo, saldo}[], activo, pasivo, manualActivo, manualPasivo, base, coeficiente, ajuste }, dinamico: { movimientos: {fecha, asientoNumero, descripcion, tipo, importe, coeficiente, ajuste}[], total }, partidas: Partida[], variacion36, corresponde, total, totalDj, aviso }` (importes `toFixed(2)`, coeficientes `toFixed(6)`); `GET/POST /api/impuestos/ajuste-inflacion/partidas?ejercicioId=`, `PUT/DELETE /api/impuestos/ajuste-inflacion/partidas/:id` (escritura con `impuestos.presentar`; zod: concepto 1..200, tipo, fecha obligatoria solo si `DINAMICO`, importe ≠ 0; auditadas).
Datos del Mayor (SQL agregado, empresa del tenant):
- Saldos al inicio por cuenta de activo/pasivo computable: renglones de asientos con fecha < desde y tipo ∉ {CIERRE, APERTURA, AJUSTE_INFLACION} y origenTipo ≠ 'AJUSTE_INFLACION', más la apertura inicial (asientos APERTURA del primer ejercicio por `desde` y `ConfigAjusteInflacion.asientoAperturaId` si es de ese ejercicio). Activo: debe − haber; pasivo: haber − debe.
- Movimientos: por asiento con fecha en el ejercicio y tipo ∈ {AUTOMATICO, MANUAL}, origenTipo ≠ 'AJUSTE_INFLACION', sin la apertura inicial; `clasificarAsiento`; pn > 0 → APORTE (importe −pn), pn < 0 → RETIRO (importe |pn|); excluidos (solo si origenTipo ≠ 'AMORTIZACION') > 0 → COMPRA_EXCLUIDO (importe excluidos), < 0 → VENTA_EXCLUIDO (importe excluidos); un asiento puede dar dos movimientos. Partidas `DINAMICO` → MANUAL.
- [ ] Pruebas que fallan (empresa de `sesionConPlan`, ejercicio 2026; índices del ejemplo de Task 1; asientos manuales con `POST /api/contabilidad/asientos`):
  - apertura inicial (asiento APERTURA del ejercicio 1 con caja 1.000.000 y proveedores 400.000 y capital) → estático −300.000 con las cuentas listadas;
  - aporte de capital en mayo, retiro (dividendo pagado: debe RNA, haber caja) en julio, compra de rodado (cuenta de bienes de uso, excluida por la migración/seed) en marzo, amortización de bienes de uso (`origenTipo AMORTIZACION`): no aparece; reserva legal: no aparece → movimientos y total del ejemplo;
  - partida `ACTIVO_INICIO` 40.000 → estático −320.000; partida `DINAMICO` sin fecha → 400; importe 0 → 400; `PUT` y `DELETE` → 200; `DELETE` de otra → 404 `Partida no encontrada`;
  - con I(2023-12)=80 → `corresponde` false, `totalDj` '0.00', aviso exacto;
  - falta I(2026-12) → 400 `Faltan los índices de: 12/2026`;
  - segundo y tercer ejercicio (se cierra el 1 y el 2 con el servicio de cierre) → saldos al inicio del 3 = los nominales acumulados, sin duplicar;
  - `PATCH /api/plan-cuentas/:id { ajusteImpositivo: 'EXCLUIDO' }` lo guarda y el árbol lo devuelve; `formato=xlsx` → Excel; sin `ejercicioId` → 400; usuario sin `impuestos.ver` → 403.
- [ ] Migraciones desplegadas en `gestion`, `gestion_test`, `gestion_mig`. `npx jest --runInBand test/ajuste-impositivo test/plan-cuentas test/ajuste-inflacion src/impuestos/ajuste-inflacion` → PASS. Commit `feat(impuestos): planilla del ajuste por inflación impositivo`.

### Task 3: Pantallas y e2e
**Files:** `apps/web/src/impuestos/AjusteImpositivoPage.tsx` (ejercicio; resumen con estático, dinámico, manuales, total y `totalDj`; aviso; tablas; partidas con alta/edición/baja; Excel); ruta `/impuestos/ajuste-inflacion` y menú *Ajuste por inflación impositivo* (permiso `impuestos.ver`); ficha de la cuenta del plan de cuentas: *Ajuste impositivo* (Computable/Excluida) solo para activo y pasivo; `e2e/ajuste-impositivo.spec.ts` (proyecto propio después de `bienes-impositiva`); `docs/pendientes.md` (1.1 punto 10 hecho; §2 datos de la spec §8). **Test:** `apps/web/src/impuestos/ajuste-impositivo.test.tsx`.
- [ ] Pruebas que fallan: el resumen muestra estático, dinámico y total con el formato de moneda y el aviso de 36 meses; la tabla del dinámico muestra el tipo en castellano (Aporte, Retiro, Compra de bien excluido, Venta de bien excluido, Partida manual); el formulario de partida pide fecha solo si es dinámica; el menú tiene la ruta con `impuestos.ver`. e2e: el contador abre el ajuste del ejercicio, carga una partida manual de activo al inicio y ve cambiar el total.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): ajuste por inflación impositivo`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final.
