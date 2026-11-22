# Entrega 47 — Bienes Personales: acciones y participaciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Liquidación anual del impuesto sobre los Bienes Personales que la sociedad ingresa como responsable sustituto por las acciones y participaciones de sus socios, con registro de socios, participaciones por año y presentación congelada.

**Architecture:** Función pura `liquidarBienesPersonales` en `apps/api/src/impuestos/bienes-personales/calculo.ts`. `BienesPersonalesService` toma el patrimonio neto del estado de situación (`EstadosService`) al cierre del ejercicio que termina en el año, las participaciones del año (copiadas del registro de socios la primera vez) y la alícuota; presenta guardando la foto, como la DJ de Ganancias (E46), con el bloqueo `FOR UPDATE` sobre la fila del año.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-entrega-47-bienes-personales-acciones-design.md`

## Global Constraints
- Mensajes exactos: `No hay un ejercicio que cierre en <A>`, `Las participaciones suman <x> %: deben sumar 100 %` (`<x>` con coma decimal y sin ceros sobrantes: `90`, `99,5`), `Ningún socio paga el impuesto como responsable sustituto`, `La liquidación de Bienes Personales del año está presentada`, `Cierre el ejercicio antes de presentar la liquidación`, `La liquidación no está presentada`, `Indique el año`, `Socio no encontrado`.
- Tipos de titular (enum `TipoTitularSocio`): `PERSONA_HUMANA_PAIS`, `PERSONA_HUMANA_EXTERIOR`, `SUCESION_INDIVISA`, `SOCIEDAD_EXTERIOR` (pagan), `SOCIEDAD_PAIS` (no paga).
- `ConfigImpuestos.alicuotaBienesPersonalesAcciones Decimal(9,4) @default(0.5)`.
- Modelos de empresa (en `MODELOS_DE_EMPRESA`; enums en migración aparte): `Socio { nombre, tipoDocumento, documento, tipoTitular, porcentaje Decimal(9,4), activo }`; `BienesPersonalesAcciones { anio, ajustePatrimonio Decimal(18,2) default 0, conceptoAjuste String?, estado EstadoBienesPersonales (BORRADOR|PRESENTADA); @@unique([empresaId, anio]) }`; `BienesPersonalesParticipacion { anio, socioId, tipoTitular, porcentaje; @@unique([empresaId, anio, socioId]) }`; `BienesPersonalesPresentacion { anio, numero, datos Json, presentadaPor, presentadaEn, anuladaEn?, anuladaPor?, motivoAnulacion?; @@unique([empresaId, anio, numero]) }`.
- Impuesto por socio = máx(0, VPP × alícuota / 100), 2 decimales; VPP = base × participación / 100, 2 decimales.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Un socio cambia en el registro después de armado el año: el año no cambia hasta *Volver a copiar del registro* (Task 2).
2. Presentada y después cambia el Mayor o la alícuota: se ve la foto (Task 2).
3. Patrimonio neto negativo: VPP negativo, impuesto 0 (Task 1).
4. Dos ejercicios que terminan en el mismo año: se toma el último (Task 2).
5. Socio dado de baja (inactivo) en el registro: no entra al copiar (Task 2).

---

### Task 1: Cálculo puro
**Files:** Create `apps/api/src/impuestos/bienes-personales/calculo.ts`; Test `…/calculo.spec.ts`.
**Produces:**
```ts
export type TipoTitular = 'PERSONA_HUMANA_PAIS' | 'PERSONA_HUMANA_EXTERIOR' | 'SUCESION_INDIVISA' | 'SOCIEDAD_EXTERIOR' | 'SOCIEDAD_PAIS';
export interface ParticipacionBp { socioId: string; nombre: string; documento: string; tipoTitular: TipoTitular; porcentaje: Dec }
export interface ResultadoBp { patrimonio: Dec; ajuste: Dec; base: Dec; alicuota: Dec; filas: (ParticipacionBp & { paga: boolean; vpp: Dec; impuesto: Dec })[]; sumaParticipaciones: Dec; total: Dec; completo: boolean /* suma = 100 */; avisos: string[] }
export function liquidarBienesPersonales(d: { patrimonio: Dec; ajuste: Dec; alicuota: Dec; participaciones: ParticipacionBp[] }): ResultadoBp
```
- [ ] Pruebas que fallan (alícuota 0,5):
  - patrimonio 10.000.000, ajuste −1.000.000 → base 9.000.000; A persona del país 60 % → VPP 5.400.000, impuesto 27.000; B sociedad del país 30 % → VPP 2.700.000, impuesto 0, `paga` false; C persona del exterior 10 % → 900.000 y 4.500; total 31.500; sin avisos; `completo` true;
  - participaciones 60 + 30 → aviso `Las participaciones suman 90 %: deben sumar 100 %`, `completo` false; 99,5 → `…suman 99,5 %…`;
  - solo sociedades del país → total 0 y aviso `Ningún socio paga el impuesto como responsable sustituto`;
  - patrimonio −500.000 → VPP del 100 % = −500.000, impuesto 0.
- [ ] `cd apps/api && npx jest src/impuestos/bienes-personales` → PASS. Commit `feat(impuestos): cálculo de Bienes Personales acciones y participaciones`.

### Task 2: Socios, liquidación anual y presentación (API)
**Files:** `prisma/schema.prisma` + migraciones; `prisma/modelos-empresa.ts`; `impuestos/config/*` (alícuota 0..100); Create `impuestos/bienes-personales/{bienes-personales.service,bienes-personales.controller,socios.controller}.ts` en `impuestos.module.ts`. **Test:** `apps/api/test/bienes-personales.e2e-spec.ts`.
**Consumes:** Task 1; `EstadosService.situacion({ fecha })` → `patrimonioNeto.total`.
**Rutas:** `GET/POST /api/impuestos/socios`, `PUT /api/impuestos/socios/:id` (zod: nombre 1..200, tipoDocumento, documento, tipoTitular, porcentaje 0..100 con hasta 4 decimales, activo); `GET /api/impuestos/bienes-personales?anio=[&formato=xlsx]` → `{ anio, ejercicio: {numero, desde, hasta, estado}, estado, ajuste: {importe, concepto}, liquidacion: ResultadoBp en texto, presentaciones[] }`; `PUT …/bienes-personales/ajuste { anio, importe, concepto }`; `PUT …/bienes-personales/participaciones { anio, participaciones: {socioId, tipoTitular, porcentaje}[] }` (reemplaza las del año); `POST …/bienes-personales/copiar-socios { anio }`; `POST …/presentar { anio }`; `POST …/anular { anio, motivo }`. Lectura `impuestos.ver`; escritura `impuestos.presentar`, auditada, con `FOR UPDATE` sobre la fila del año (como E46).
Ejercicio del año: el de mayor `hasta` con `hasta` en el año. Primera consulta de un año sin participaciones: se copian del registro (socios activos).
- [ ] Pruebas que fallan (empresa de `sesionConPlan`, ejercicio 2026, aporte de capital de 10.000.000 por asiento manual):
  - socios A 60 % persona del país, B 30 % sociedad del país, C 10 % persona del exterior → total 35.000 (30.000 + 0 + 5.000); ajuste −1.000.000 → 31.500;
  - cambiar A a 50 % en el registro → el año sigue con 60 %; `copiar-socios` → toma 50 % y aparece el aviso de 90 %;
  - socio inactivo no se copia;
  - alícuota 1 % en la configuración → total recalculado;
  - presentar con el ejercicio abierto → 400 `Cierre el ejercicio antes de presentar la liquidación`; con participaciones en 90 % (y el ejercicio cerrado) → 400 con el mensaje de 90 %; completo y cerrado → 200, número 0; después cambiar la alícuota no cambia el total;
  - presentada: `PUT ajuste`, `PUT participaciones` y `copiar-socios` → 400 `La liquidación de Bienes Personales del año está presentada`; anular con motivo → `BORRADOR`; presentar → número 1; anular sin presentar → 400 `La liquidación no está presentada`;
  - año sin ejercicio (2030) → 400 `No hay un ejercicio que cierre en 2030`; sin `anio` → 400 `Indique el año`; Excel → `spreadsheetml`; usuario sin `impuestos.ver` → 403.
- [ ] Migraciones en `gestion`, `gestion_test`, `gestion_mig`. `npx jest --runInBand test/bienes-personales src/impuestos/bienes-personales test/pulido42-impuestos` → PASS. Commit `feat(impuestos): Bienes Personales acciones y participaciones`.

### Task 3: Pantallas y e2e
**Files:** `apps/web/src/impuestos/SociosPage.tsx` (ABM con `Maestro`); `apps/web/src/impuestos/BienesPersonalesPage.tsx` (año; patrimonio del balance, ajuste con concepto, tabla de participaciones del año editable mientras está en borrador con *Volver a copiar del registro*, tabla por socio con tipo, participación, VPP e impuesto, total, avisos, presentar/anular e historial, Excel); `ConfigImpuestosPage.tsx` (*Alícuota de Bienes Personales (acciones y participaciones)*); rutas `/impuestos/socios` y `/impuestos/bienes-personales`, menú *Socios* y *Bienes Personales (acciones)*; `e2e/bienes-personales.spec.ts` (proyecto después de `dj-ganancias`); `docs/pendientes.md` (1.1 punto 9 completo; §2 datos de la spec §8). **Test:** `apps/web/src/impuestos/bienes-personales.test.tsx`.
- [ ] Pruebas que fallan: la liquidación muestra la tabla por socio con el tipo en castellano, VPP e impuesto y el total; el aviso de participaciones; presentada sin edición y con *Anular presentación*; el menú tiene las dos rutas con `impuestos.ver`. e2e: el administrador carga dos socios (70 % persona del país, 30 % sociedad del país), abre Bienes Personales del año y ve el impuesto del primero y 0 en el segundo.
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): Bienes Personales acciones y participaciones`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final.
