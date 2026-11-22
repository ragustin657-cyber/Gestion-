# Entrega 44 — Amortización impositiva Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Planilla anual de amortización impositiva de bienes de uso (Ganancias), calculada al vuelo, con actualización por IPC, tope de automóviles, inmuebles por trimestre y diferencia con la contable.

**Architecture:** Función pura `amortizacionImpositiva` en `apps/api/src/bienes-uso/impositiva.ts` (la reutiliza la entrega 46). `PlanillaImpositivaService` arma los ejercicios fiscales (los del sistema más los supuestos anteriores), valida índices y agrupa por rubro con la amortización contable nominal del ejercicio. Campos impositivos en `RubroBienUso`, `BienUso` y `ConfigImpuestos`. Pantalla *Bienes de uso › Planilla impositiva*.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-entrega-44-amortizacion-impositiva-design.md`

## Global Constraints
- Sin asientos ni procesos: nada se persiste salvo los datos impositivos de rubros, bienes y configuración.
- Mensajes exactos: `Faltan los índices de: mm/aaaa, …` (orden cronológico), `Se usa la vida útil contable de: <rubros>`, `Revise el valor del terreno de: <bienes>`, `Indique el ejercicio`, `Ejercicio no encontrado`.
- Enum Prisma `TipoImpositivoBien { MUEBLE INMUEBLE AUTOMOVIL NO_AMORTIZABLE }` en su propia migración (sin datos que lo usen).
- `ConfigImpuestos.topeAutomovilesCosto Decimal(18,2) @default(20000)`.
- Redondeo: coeficiente a precisión completa; `valorActualizado`, edificio actualizado y cada cuota a 2 decimales.
- Corte de actualización: inicio del ejercicio del alta < 2018-01-01 → coeficiente 1.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Bien al final de su vida útil con actualización: la cuota del último año es el remanente y la acumulada no supera el valor actualizado (Task 1).
2. Bien con alta en un ejercicio anterior al primero del sistema y ejercicio no calendario: años contados con los ejercicios supuestos (Task 1).
3. Bien dado de baja en el ejercicio: sin cuota y costo computable al coeficiente del mes de la baja; dado de baja antes del ejercicio: no aparece (Task 2).
4. Empresa sin índices cargados y todos sus bienes con alta anterior a 2018: la planilla sale (solo pide el índice si algún bien se actualiza) (Task 2).
5. Bien con vida útil contable de 18 meses y rubro sin vida impositiva: usa 2 años y avisa (Task 2).

---

### Task 1: Cálculo puro
**Files:** Create `apps/api/src/bienes-uso/impositiva.ts`; Test `apps/api/src/bienes-uso/impositiva.spec.ts`.
**Produces:**
```ts
export type TipoImpositivo = 'MUEBLE' | 'INMUEBLE' | 'AUTOMOVIL' | 'NO_AMORTIZABLE';
export interface EjercicioFiscal { desde: Date; hasta: Date }
export interface BienImpositivo { fechaAlta: Date; fechaBaja: Date | null; valorOrigen: Dec; valorTerreno: Dec; tipo: TipoImpositivo; vidaUtilAnios: number }
export interface ContextoImpositivo { ejercicios: EjercicioFiscal[]; indice: (mes: string /* 'AAAA-MM' */) => Dec; topeAutomoviles: Dec }
export interface ResultadoImpositivo { actualiza: boolean; coeficiente: Dec; valorActualizado: Dec; aniosAnteriores: number; acumuladaAnterior: Dec; cuota: Dec; noDeducible: Dec; acumuladaCierre: Dec; valorResidual: Dec; costoComputableBaja: Dec | null }
export function ejerciciosFiscales(delSistema: EjercicioFiscal[], desde: Date): EjercicioFiscal[] // agrega hacia atrás ejercicios de 12 meses con el mes de cierre del primero hasta cubrir `desde`
export function ejercicioDe(ejs: EjercicioFiscal[], fecha: Date): EjercicioFiscal
export function mesesQueActualiza(b: BienImpositivo, ej: EjercicioFiscal, ejs: EjercicioFiscal[]): string[] // [] si no actualiza
export function amortizacionImpositiva(b: BienImpositivo, ej: EjercicioFiscal, ctx: ContextoImpositivo): ResultadoImpositivo
```
Reglas (spec §3): coeficiente = indice(mes de cierre o de la baja si cae en el ejercicio) / indice(mes de alta) si el ejercicio del alta empieza ≥ 2018-01-01, si no 1. Muebles: cuota = valorActualizado / vida; años anteriores = ejercicios entre el del alta (inclusive) y `ej` (exclusive); acumuladaAnterior = mín(cuota × años, valor); cuota del año = mín(cuota, valor − acumuladaAnterior), y en el último año de vida (años anteriores + 1 ≥ vida) el remanente valor − acumuladaAnterior; 0 si la baja cae en `ej`. Inmuebles: base = valorActualizado − round2(terreno × coef); tasa anual = 1/vida (vida por defecto 50); en el ejercicio del alta cuota × trimestresDesdeElAlta/4 (trimestres del ejercicio contados desde su inicio; el del alta inclusive); años anteriores cuentan el primero como fracción. Automóvil: noDeducible = cuota − round2(cuota × mín(1, tope / valorOrigen)). No amortizable: cuota 0, residual = valor.
- [ ] Pruebas que fallan (ejercicios calendario 2024–2026 salvo que se diga; índices por mes en un `Map`):
  - mueble alta 2024-07-10, 10.000, vida 5, I(2024-07)=100, I(2026-12)=200, ejercicio 2026 → coef 2, valor 20.000, años 2, acumAnt 8.000, cuota 4.000, acumCierre 12.000, residual 8.000;
  - mueble alta 2017-05-02, 5.000, vida 10, ejercicio 2026 → `actualiza` false, coef 1, años 9, cuota 500, acumCierre 5.000, residual 0; ejercicio 2027 → cuota 0;
  - inmueble alta 2026-05-15, 1.000.000, terreno 200.000, I(2026-05)=180, I(2026-12)=200 → valor 1.111.111,11, cuota 13.333,33 (888.888,89 × 2 % × 3/4);
  - automóvil alta 2026-12-01, 40.000.000, vida 5, tope 20.000.000 → cuota 8.000.000, noDeducible 4.000.000;
  - baja: mueble alta 2024-07-10, 10.000, vida 5, baja 2026-03-15, I(2026-03)=150 → cuota 0, costoComputableBaja 9.000 (15.000 − 2 × 3.000);
  - remanente: mueble alta 2022-01-10, 1.000, vida 3, coef 1 (índices iguales), ejercicio 2024 → cuota 333,34 y acumCierre 1.000;
  - no amortizable alta 2025-02-01, 500.000, I(2025-02)=100, I(2026-12)=150 → cuota 0, residual 750.000;
  - ejercicios supuestos: sistema con el primero 2025-07-01..2026-06-30; `ejerciciosFiscales` desde 2023-10-01 agrega 2024-07..2025-06 y 2023-07..2024-06; mueble alta 2023-10-05 vida 5 en el ejercicio 2025-07..2026-06 → años anteriores 2;
  - corte 2018: alta 2018-03-10 con ejercicio supuesto 2017-07..2018-06 → `actualiza` false; alta 2018-08-01 → true;
  - `mesesQueActualiza` del primer caso → `['2024-07', '2026-12']`; del bien de 2017 → `[]`.
- [ ] `cd apps/api && npx jest src/bienes-uso/impositiva` → PASS. Commit `feat(bienes): cálculo de la amortización impositiva`.

### Task 2: Datos impositivos y planilla impositiva (API)
**Files:** `prisma/schema.prisma` + migraciones (`TipoImpositivoBien` aparte; `RubroBienUso.vidaUtilImpositivaAnios Int?`, `tipoImpositivo TipoImpositivoBien @default(MUEBLE)`; `BienUso.vidaUtilImpositivaAnios Int?`, `valorTerreno Decimal(18,2) @default(0)`; `ConfigImpuestos.topeAutomovilesCosto`); `bienes-uso/dto.ts` (`esquemaRubro` + los dos campos opcionales; `esquemaImpositivoBien { vidaUtilImpositivaAnios: int 1..100 nullable, valorTerreno: ≥ 0 }`); `bienes.controller.ts` + service (`PUT /api/bienes-uso/bienes/:id/impositivo`, permiso `bienes.gestionar`, auditado; terreno > valor de origen → 400 `El terreno no puede superar el valor de origen`); `impuestos/config/*` (`topeAutomovilesCosto` ≥ 0); Create `bienes-uso/planilla-impositiva.service.ts` y `.controller.ts` (`GET /api/bienes-uso/planilla-impositiva?ejercicioId=&formato=xlsx`, permiso `bienes.ver`). **Test:** `apps/api/test/bienes-impositiva.e2e-spec.ts` (con `prepararBienes`).
**Consumes:** Task 1. **Produces:** `{ ejercicio: { desde, hasta }, filas: { rubroId, rubro, bienes: FilaBien[], subtotal }[], totales: { cuota, noDeducible, deducible, contable, diferencia, valorResidual }, avisos: string[] }`, `FilaBien` con número, descripción, fechaAlta, fechaBaja, tipo, vidaUtilAnios y los campos de `ResultadoImpositivo` en texto (`toFixed(2)`, coeficiente `toFixed(4)`), `contable`, `diferencia` (= cuota − noDeducible − contable).
Bienes incluidos: alta ≤ hasta y (sin baja o baja ≥ desde). Vida útil: bien → rubro → ⌈vidaUtilMeses del bien / 12⌉ con aviso del rubro. Contable: suma nominal de `AmortizacionBien` de procesos `VIGENTE` con mes dentro del ejercicio, más `amortizacionInicial` si la fecha de amortización inicial cae en el ejercicio (como la planilla contable).
- [ ] Pruebas que fallan:
  - mueble alta 2026-03-10 por 1.200.000 (rubro sin vida impositiva, vida contable 60) e índices I(2026-03)=100, I(2026-12)=110 → vida 5, coef 1,1000, valor 1.320.000, cuota 264.000, contable = la generada para 03..10, diferencia; aviso `Se usa la vida útil contable de: <rubro>`;
  - con vida impositiva 3 en el rubro y luego 2 en el bien (`PUT …/impositivo`) → cuota con 2 años; sin aviso;
  - rubro `INMUEBLE` sin terreno → aviso `Revise el valor del terreno de: <n> <descripción>`; terreno mayor que el valor → 400;
  - rubro `AUTOMOVIL` y tope 1.000.000 en la configuración → noDeducible y `totales.deducible`;
  - falta I(2026-12) → 400 `Faltan los índices de: 12/2026`; empresa con todos los bienes anteriores a 2018 y sin índices → 200;
  - bien dado de baja en el ejercicio → cuota 0 y `costoComputableBaja`; dado de baja el ejercicio anterior → no aparece;
  - `formato=xlsx` → 200 con `Content-Type` de Excel; sin `ejercicioId` → 400 `Indique el ejercicio`; usuario sin `bienes.ver` → 403.
- [ ] Migraciones desplegadas en `gestion`, `gestion_test`, `gestion_mig`. `npx jest --runInBand test/bienes-impositiva test/bienes-rubros test/bienes-alta test/bienes-planilla test/pulido42-impuestos` → PASS. Commit `feat(bienes): planilla de amortización impositiva`.

### Task 3: Pantallas y e2e
**Files:** `apps/web/src/bienes-uso/PlanillaImpositivaPage.tsx` (elegir ejercicio, tabla por rubro con bienes y subtotales, totales deducible/contable/diferencia, avisos en `Alert`, exportar a Excel); `RubrosPage.tsx` (vida útil impositiva y tipo impositivo); `BienesPage.tsx` (en la ficha: vida útil impositiva y valor del terreno, guardado con `PUT …/impositivo`); `impuestos/ConfigImpuestosPage.tsx` (tope de automóviles); ruta `/bienes-uso/planilla-impositiva` y menú *Planilla impositiva*; `e2e/bienes-impositiva.spec.ts` (proyecto propio después de `sire-completo`); `docs/pendientes.md` (1.1 punto 11 hecho; §2 datos a verificar de la spec §7). **Test:** `apps/web/src/bienes-uso/impositiva.test.tsx`.
- [ ] Pruebas que fallan: la planilla muestra rubro, bien, cuota, diferencia y el aviso que trae la API; la ficha del rubro tiene *Vida útil impositiva (años)* y *Tipo impositivo*; la configuración de impuestos tiene *Tope de costo de automóviles*. e2e: el administrador pone vida impositiva al rubro *Muebles y útiles*, abre la planilla impositiva del ejercicio y ve la fila del bien y los totales.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): planilla de amortización impositiva`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final.
