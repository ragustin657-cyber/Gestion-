# Entrega 46 — DJ de Ganancias de sociedades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Papel de trabajo de la DJ anual de Ganancias de sociedades (resultado contable → impositivo → escala → pagos a cuenta → saldo) y plan de anticipos, con presentación congelada e historial.

**Architecture:** Función pura `determinarDj` en `apps/api/src/impuestos/dj-ganancias/calculo.ts`. `DjGananciasService` junta el resultado contable del Mayor, la diferencia de amortizaciones (`PlanillaImpositivaService`, E44), el ajuste impositivo (`AjusteImpositivoService`, E45), retenciones y percepciones, la escala y los datos cargados; presenta guardando la foto en `DjGananciasPresentacion`. Pantalla en *Impuestos* y escala en la configuración.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-entrega-46-dj-ganancias-sociedades-design.md`

## Global Constraints
- Mensajes exactos: `Cargue la escala de Ganancias de sociedades de <año>`, `El ejercicio no es de 12 meses: verifique la escala aplicada`, `La DJ de Ganancias del ejercicio está presentada`, `Cierre el ejercicio antes de presentar la DJ`, `La DJ no está presentada`, `Indique el ejercicio`, `Ejercicio no encontrado`, `Ajuste no encontrado`.
- Escala de la ley 27.630 (botón de copia): `[{desde 0, fijo 0, alicuota 25}, {desde 5000000, fijo 1250000, alicuota 30}, {desde 50000000, fijo 14750000, alicuota 35}]`.
- Anticipos: 10; el 1.º 25 %, del 2.º al 10.º 8,33 % (el 10.º = base − los nueve anteriores); vencimiento de la DJ = mes de cierre + 5; anticipos desde el mes de cierre + 6, uno por mes.
- Modelos (de empresa, en `MODELOS_DE_EMPRESA`; enums en migración aparte): `EscalaSociedades { anio, desde, fijo, alicuota; @@unique([empresaId, anio, desde]) }`; `DjGananciasSociedades { ejercicioId @unique, estado EstadoDjGanancias (BORRADOR|PRESENTADA), quebrantosAnteriores, anticiposIngresados, saldoAFavorAnterior, impuestoCheque, otrosPagos (Decimal 18,2 default 0) }`; `DjGananciasAjuste { ejercicioId, concepto, importe }`; `DjGananciasPresentacion { ejercicioId, numero Int, datos Json, presentadaPor, presentadaEn, anuladaEn?, anuladaPor?, motivoAnulacion? }`.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. DJ presentada y después cambia el Mayor, un índice o la escala: la DJ muestra la foto, no un recálculo (Task 2).
2. Anular y volver a presentar: queda la original anulada y la rectificativa número 1 (Task 2).
3. Resultado impositivo negativo con quebrantos anteriores: impuesto 0, quebranto del ejercicio informado, anticipos en 0 (Task 1).
4. Faltan índices para la E44 o la E45: la DJ entera da ese error (Task 2).
5. Recibos o compras anulados: sus retenciones y percepciones no cuentan (Task 2).

---

### Task 1: Cálculo puro
**Files:** Create `apps/api/src/impuestos/dj-ganancias/calculo.ts`; Test `apps/api/src/impuestos/dj-ganancias/calculo.spec.ts`.
**Produces:**
```ts
export interface TramoEscala { desde: Dec; fijo: Dec; alicuota: Dec /* % */ }
export interface DatosDj {
  resultadoContable: Dec; diferenciaAmortizaciones: Dec /* E44: deducible − contable */; ajusteInflacion: Dec /* E45 totalDj */;
  ajustesManuales: { concepto: string; importe: Dec }[]; quebrantosAnteriores: Dec; tramos: TramoEscala[];
  retenciones: Dec; percepciones: Dec; impuestoCheque: Dec; anticiposIngresados: Dec; saldoAFavorAnterior: Dec; otrosPagos: Dec;
  mesCierre: string /* 'AAAA-MM' */; mesesEjercicio: number;
}
export interface Anticipo { numero: number; mes: string; porcentaje: Dec; importe: Dec }
export interface ResultadoDj {
  resultadoContable: Dec; ajusteAmortizaciones: Dec /* = −diferencia */; ajusteInflacion: Dec; totalAjustesManuales: Dec; resultadoImpositivo: Dec;
  quebrantosComputados: Dec; quebrantoEjercicio: Dec; gananciaNetaImponible: Dec; impuestoDeterminado: Dec;
  pagosACuenta: Dec; saldo: Dec /* + a pagar, − a favor */; baseAnticipos: Dec; vencimientoDj: string; anticipos: Anticipo[]; avisos: string[];
}
export function impuestoEscala(gni: Dec, tramos: TramoEscala[]): Dec // tramo con mayor desde ≤ gni: fijo + (gni − desde) × alicuota / 100
export function determinarDj(d: DatosDj): ResultadoDj
```
- [ ] Pruebas que fallan (escala de la ley 27.630; cierre `2026-12`, 12 meses):
  - resultado 10.000.000, diferencia de amortizaciones 200.000 (ajuste −200.000), ajuste por inflación −1.500.000, manuales +300.000 y −100.000 → resultado impositivo 8.500.000; quebrantos 500.000 → computados 500.000, GNI 8.000.000; impuesto 2.150.000;
  - pagos: retenciones 100.000, percepciones 50.000, cheque 150.000, anticipos 600.000, saldo a favor 20.000, otros 30.000 → pagos 950.000, saldo 1.200.000;
  - base de anticipos 1.850.000 → anticipo 1 = 462.500 (mes `2027-06`), anticipos 2 a 9 = 154.105 cada uno, anticipo 10 = 154.660 (mes `2028-03`), suma 1.850.000; vencimientoDj `2027-05`;
  - resultado impositivo −300.000 con quebrantos 500.000 → computados 0, quebranto del ejercicio 300.000, GNI 0, impuesto 0, base de anticipos 0 y anticipos en 0;
  - resultado 400.000 con quebrantos 500.000 → computados 400.000, GNI 0;
  - `impuestoEscala(60.000.000)` = 18.250.000; `impuestoEscala(5.000.000)` = 1.250.000; `impuestoEscala(1.000.000)` = 250.000;
  - `mesesEjercicio` 6 → avisos contiene `El ejercicio no es de 12 meses: verifique la escala aplicada`;
  - saldo a favor: impuesto 0 y retenciones 100.000 → saldo −100.000.
- [ ] `cd apps/api && npx jest src/impuestos/dj-ganancias` → PASS. Commit `feat(impuestos): cálculo de la DJ de Ganancias de sociedades`.

### Task 2: Datos, escala, presentación e historial (API)
**Files:** `prisma/schema.prisma` + migraciones; `prisma/modelos-empresa.ts`; Create `impuestos/dj-ganancias/{dj-ganancias.service,dj-ganancias.controller,escala.controller}.ts` en `impuestos.module.ts`; `impuestos/ajuste-inflacion/ajuste-impositivo.service.ts` (bloqueo de partidas con la DJ presentada). **Test:** `apps/api/test/dj-ganancias.e2e-spec.ts`.
**Consumes:** Task 1; `PlanillaImpositivaService.planilla({ ejercicioId }).totales.diferencia`; `AjusteImpositivoService.planilla({ ejercicioId }).totalDj`.
**Produces (rutas):**
- `GET /api/impuestos/escala-sociedades/:anio` → tramos; `PUT /api/impuestos/escala-sociedades/:anio { tramos: {desde, fijo, alicuota}[] }` (reemplaza; el primero desde 0, `desde` creciente, alícuota 0..100; permiso `impuestos.presentar`).
- `GET /api/impuestos/dj-ganancias?ejercicioId=[&formato=xlsx]` (`impuestos.ver`) → `{ ejercicio: {numero, desde, hasta, estado}, estado, datos: {quebrantosAnteriores, anticiposIngresados, saldoAFavorAnterior, impuestoCheque, otrosPagos}, ajustes: {id, concepto, importe}[], determinacion: ResultadoDj en texto, presentaciones: {numero, presentadaEn, presentadaPor, anuladaEn, motivoAnulacion}[] }`; con `PRESENTADA`, `determinacion` es la foto de la presentación vigente.
- `PUT /api/impuestos/dj-ganancias/datos { ejercicioId, ...datos }`; `POST/PUT/DELETE /api/impuestos/dj-ganancias/ajustes[/:id] { ejercicioId, concepto, importe ≠ 0 }`; `POST /api/impuestos/dj-ganancias/presentar { ejercicioId }`; `POST /api/impuestos/dj-ganancias/anular { ejercicioId, motivo }` (todo `impuestos.presentar`, auditado).
Resultado contable: Σ (haber − debe) de cuentas `RESULTADO_POSITIVO`/`RESULTADO_NEGATIVO` en asientos del ejercicio (por fecha) con tipo ∈ {AUTOMATICO, MANUAL} y origenTipo ≠ `AJUSTE_INFLACION`. Retenciones: `ReciboRetencion` tipo `GANANCIAS`, fecha en el ejercicio, recibo no anulado. Percepciones: `ComprobanteCompra.percepcionGanancias` con fecha contable en el ejercicio, no anulado. Escala del año de `ejercicio.desde`.
- [ ] Pruebas que fallan (empresa de `sesionConPlan`, ejercicio 2026; índices 2023-12 50, 2025-12 100, 2026-12 150 para la E45; asiento manual de venta 10.000.000):
  - sin escala → 400 `Cargue la escala de Ganancias de sociedades de 2026`; con la escala de la ley → resultado contable 10.000.000, ajustes automáticos 0, impuesto 2.900.000 con un ajuste manual de +500.000;
  - retención de Ganancias sufrida de 100.000 en un recibo (y otra en un recibo anulado, que no cuenta) → pagos 100.000, saldo 2.800.000, primer anticipo 700.000;
  - asiento de ajuste por inflación contable (origen `AJUSTE_INFLACION`, a RECPAM) no cambia el resultado contable;
  - `PUT datos` guarda los cinco importes y se reflejan;
  - presentar con el ejercicio abierto → 400 `Cierre el ejercicio antes de presentar la DJ`; con el ejercicio cerrado → 200, estado `PRESENTADA`, presentación número 0; después cambiar la escala no cambia `determinacion.impuestoDeterminado`;
  - presentada: `PUT datos`, alta de ajuste y alta de partida del ajuste impositivo del ejercicio → 400 `La DJ de Ganancias del ejercicio está presentada`;
  - anular con motivo → `BORRADOR`, la 0 con `anuladaEn` y motivo; presentar de nuevo → número 1; anular sin presentar → 400 `La DJ no está presentada`;
  - faltan índices de la E45 → 400 `Faltan los índices de: …`;
  - escala con `desde` no creciente → 400; Excel → `spreadsheetml`; sin `ejercicioId` → 400; usuario sin `impuestos.ver` → 403.
- [ ] Migraciones desplegadas en `gestion`, `gestion_test`, `gestion_mig`. `npx jest --runInBand test/dj-ganancias test/ajuste-impositivo test/bienes-impositiva src/impuestos/dj-ganancias` → PASS. Commit `feat(impuestos): DJ de Ganancias de sociedades`.

### Task 3: Pantallas y e2e
**Files:** `apps/web/src/impuestos/DjGananciasPage.tsx` (ejercicio; determinación renglón por renglón con enlaces a `/contabilidad/planilla-impositiva` y `/impuestos/ajuste-inflacion`; datos cargados; ajustes manuales; impuesto, pagos y saldo con "a pagar"/"a favor"; tabla de anticipos con mes `mm/aaaa`; historial de presentaciones; botones *Marcar como presentada* y *Anular presentación* (con motivo); avisos; Excel); `impuestos/ConfigImpuestosPage.tsx` (sección *Escala de sociedades*: año, tramos editables, botón *Copiar escala de la ley 27.630*); ruta `/impuestos/dj-ganancias` y menú *DJ de Ganancias (sociedades)*; `e2e/dj-ganancias.spec.ts` (proyecto después de `ajuste-impositivo`); `docs/pendientes.md` (1.1 punto 9: la parte de sociedades hecha; §2 datos de la spec §8). **Test:** `apps/web/src/impuestos/dj-ganancias.test.tsx`.
- [ ] Pruebas que fallan: la determinación muestra resultado contable, GNI, impuesto y saldo "a pagar"; los anticipos con su mes en `06/2027`; con estado `PRESENTADA` los datos no se editan y aparece *Anular presentación*; el botón de copiar escala llena los tres tramos; el menú tiene la ruta con `impuestos.ver`. e2e: el administrador copia la escala de la ley para el año, abre la DJ del ejercicio, carga un ajuste manual y ve impuesto y anticipos.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): DJ de Ganancias de sociedades`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final.
