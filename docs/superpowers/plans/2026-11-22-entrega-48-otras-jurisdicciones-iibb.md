# Entrega 48 — Otras jurisdicciones de IIBB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Padrones de cualquier jurisdicción con formato configurable, presentaciones SIRCAR de retenciones y de percepciones, recaudaciones bancarias SIRCREB restadas en la liquidación de IIBB, y nombres de todas las jurisdicciones.

**Architecture:** Parser genérico de padrón (`parsearLineaConFormato`) guiado por `FormatoPadron` (común, administrador general), integrado en `PadronService` para jurisdicciones ≠ 901/902. Generadores `sircarRetenciones` y `sircarPercepciones` en `impuestos/retenciones/sircar.ts`. `RecaudacionBancaria` (de empresa) con ABM e importación; `calcularPosicionIibb` gana `recaudaciones` por jurisdicción y su asiento acredita `RECAUDACION_BANCARIA_IIBB`.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-entrega-48-otras-jurisdicciones-iibb-design.md`

## Global Constraints
- Mensajes exactos: `Configure el formato del padrón de <nombre>`, `Configure las jurisdicciones adheridas a SIRCAR`, `No hay retenciones ni percepciones de SIRCAR en <mm/aaaa>` (uno por presentación: `No hay retenciones de SIRCAR en …` y `No hay percepciones de SIRCAR en …`), `La liquidación de IIBB de <mm/aaaa> está cerrada`, `Recaudación no encontrada`.
- Nombres: `nombreJurisdiccion(j)` (ya existe en `posicion-iibb`) o `JURISDICCIONES_CM[j]` en todas las constancias, informes y pantallas.
- Modelos y enums (enums y valores de enum en su propia migración): `FormatoPadron` **sin empresaId** `{ jurisdiccion @unique, separador (';'|','|'|'|'TAB'|'FIJO'), encabezado Boolean, cuit, alicuotaPercepcion?, alicuotaRetencion?, vigenciaDesde?, vigenciaHasta? (cada uno: número de columna 1-based o 'desde-hasta' en ancho fijo, String), formatoFecha ('DDMMAAAA'|'DD/MM/AAAA'|'AAAAMMDD'|'AAAA-MM-DD'), separadorDecimal ('.'|',') }`; `RecaudacionBancaria` (de empresa) `{ periodo String(6), jurisdiccion, cuentaBancariaId?, importe Decimal(18,2), referencia? ; @@unique([empresaId, periodo, jurisdiccion, cuentaBancariaId]) }`; `ConfigImpuestos.jurisdiccionesSircar String[]`; `JurisdiccionIibb.regimenSircarRetencion String?`, `regimenSircarPercepcion String?`; `TipoPresentacion` + `SIRCAR_RETENCIONES`, `SIRCAR_PERCEPCIONES`; concepto `RECAUDACION_BANCARIA_IIBB` → cuenta `1.1.03.003` (total de conceptos 53; migración con `ConfigCuenta` para las empresas existentes).
- SIRCAR, un renglón por movimiento, campos separados por coma, decimales con punto, CRLF: `renglon(5, ceros a la izquierda),tipoComprobante(OP|FA|NC|ND),numero(12, ceros),cuit(11),fecha(DD/MM/AAAA),base,alicuota,importe,regimen(3),jurisdiccion(3)`; NC con base e importe negativos.
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Padrón con encabezado, líneas en blanco y separador decimal coma: se cargan bien; una línea mala da el error con su número (Task 1).
2. Percepción en una nota de crédito en moneda extranjera: importe negativo en pesos en SIRCAR (Task 2).
3. Retención anulada en el mes siguiente: sigue en el SIRCAR de su mes (Task 2).
4. Recaudación de una jurisdicción que no está en el Convenio del año: aviso, como retenciones (Task 3).
5. Importación de recaudaciones con una fila repetida (mismo período, jurisdicción y cuenta): actualiza, no duplica (Task 3).

---

### Task 1: Padrones con formato configurable y nombres de jurisdicciones
**Files:** `prisma/schema.prisma` + migración (`FormatoPadron`); `pagos/padron/parsers.ts` (`parsearLineaConFormato(linea: string, nro: number, f: FormatoPadron, periodo?: string): FilaPadron | null`); `pagos/padron/padron.service.ts` (jurisdicciones ≠ 901/902 con formato; sin formato → 400); `pagos/padron/padron.controller.ts` (`GET/PUT /api/padrones/formatos/:jurisdiccion`, superadmin); `pagos/config/*` (*usa padrón* permitido si hay formato; hoy `JURISDICCIONES_CON_PADRON`); `pagos/consultas/consultas-pagos.service.ts` y demás usos de `NOMBRES_JUR` → nombre de la tabla. **Test:** `apps/api/src/pagos/padron/parsers.spec.ts` (agregar) y `apps/api/test/padron-formato.e2e-spec.ts`.
**Produces:** `parsearLineaConFormato`; formato por jurisdicción.
- [ ] Pruebas que fallan:
  - formato `;` con encabezado, CUIT en col 1, retención col 2, percepción col 3, vigencia col 4-5 `DD/MM/AAAA`, decimal `,` → `20123456786;1,5;2,25;01/11/2026;30/11/2026` da `{cuit '20123456786', alicuotaRetencion '1.5', alicuotaPercepcion '2.25', vigencia 2026-11-01..2026-11-30}`; el encabezado y las líneas en blanco se saltean;
  - ancho fijo `cuit '1-11'`, `alicuotaPercepcion '12-17'` sin vigencia + período `202611` → vigencia del mes;
  - CUIT inválido en la línea 3 → error `Línea 3 inválida: CUIT`;
  - e2e: cargar un padrón de Córdoba (904) sin formato → 400 `Configure el formato del padrón de Córdoba`; con formato → carga terminada, `PadronIibb` con 2 filas; la jurisdicción 904 con *usa padrón* aplica la alícuota del padrón a una retención (como la de 902);
  - la constancia de una retención de 904 dice `Córdoba` (no `Jurisdicción 904`).
- [ ] Migración en las tres bases. `npx jest --runInBand src/pagos/padron test/padron-formato test/padron test/retenciones test/pagos-consultas` → PASS. Commit `feat(pagos): padrones de IIBB con formato configurable`.

### Task 2: SIRCAR retenciones y percepciones
**Files:** migraciones (valores de `TipoPresentacion`; `ConfigImpuestos.jurisdiccionesSircar`; `JurisdiccionIibb.regimenSircar*`); `impuestos/config/*` (lista de jurisdicciones 901–924); `pagos/config/*` (regímenes SIRCAR, 3 dígitos); Create `impuestos/retenciones/sircar.ts` (`sircarRetenciones`, `sircarPercepciones`, registrados en `presentaciones.service.ts`). **Test:** `apps/api/test/sircar.e2e-spec.ts`.
**Consumes:** `retencionesDelPeriodo` (E43, regla de anuladas); percepciones del período como `arba-percepciones.ts`.
- [ ] Pruebas que fallan (empresa agente en 904 y 909, adheridas a SIRCAR; régimen de retención 904 = `011`):
  - retención de 904 en una OP pagada en noviembre → `SIRCAR_RETENCIONES` 202611: un renglón `00001,OP,<12>,<cuit>,DD/MM/2026,<base>,<alícuota>,<importe>,011,904`; nombre de archivo `SIRCAR-RETENCIONES_<cuit>_202611.txt`;
  - retención de 902 (no adherida) no aparece; anulada en diciembre sigue en noviembre;
  - percepción de 909 en una factura y una NC de noviembre → `SIRCAR_PERCEPCIONES`: renglones `FA` positivo y `NC` con base e importe negativos; régimen vacío → `000`;
  - sin adheridas → 400 `Configure las jurisdicciones adheridas a SIRCAR`; sin movimientos → archivo vacío con el aviso;
  - `PUT /api/impuestos/config` guarda `jurisdiccionesSircar` (solo 901–924).
- [ ] `npx jest --runInBand test/sircar test/impuestos-retenciones test/percepciones-ventas test/pulido42-impuestos` → PASS. Commit `feat(impuestos): SIRCAR de retenciones y percepciones`.

### Task 3: Recaudaciones bancarias (SIRCREB) en la liquidación de IIBB
**Files:** migraciones (`RecaudacionBancaria`; concepto `RECAUDACION_BANCARIA_IIBB` en `conceptos.ts`, plan modelo y `ConfigCuenta` existentes); Create `impuestos/sircreb/{sircreb.service,sircreb.controller}.ts` (`GET /api/impuestos/recaudaciones-bancarias?periodo=`, `POST`, `PUT/DELETE :id`, `POST /importar` con texto CSV `periodo;jurisdiccion;importe[;cbu]`; lectura `impuestos.ver`, escritura `impuestos.presentar`); `impuestos/posicion-iibb/{calculo,posicion-iibb.service}.ts` (`JurisdiccionEntrada.recaudaciones`, `DetalleJurisdiccion.recaudaciones`, totales y asiento con `['RECAUDACION_BANCARIA_IIBB', 'haber', t.recaudaciones]`; CM03 y Excel con la columna); bloqueo con la posición del período cerrada; conteos de conceptos a 53 en `compras-config`, `pagos-config`, `ventas-maestros`. **Test:** `apps/api/src/impuestos/posicion-iibb/calculo.spec.ts` (agregar) y `apps/api/test/sircreb.e2e-spec.ts`.
- [ ] Pruebas que fallan:
  - cálculo: jurisdicción con impuesto 10.000, retenciones 1.000, percepciones 500, recaudaciones 2.000 → a pagar 6.500; el asiento cuadra y acredita 2.000 en `RECAUDACION_BANCARIA_IIBB`;
  - e2e: recaudación 902 de 2.000 en 202611 → la liquidación de IIBB de noviembre resta 2.000 en 902 y el asiento al cerrar acredita 1.1.03.003; recaudación de una jurisdicción fuera del Convenio → aviso;
  - importar `202611;902;1500,50;0000003100000000000001` y repetirla con otro importe → una sola fila con el último; línea mala → 400 `Línea <n> inválida: <campo>`;
  - con la posición de noviembre cerrada: alta, edición, baja e importación de 202611 → 400 `La liquidación de IIBB de 11/2026 está cerrada`;
  - `DELETE` de otra → 404 `Recaudación no encontrada`; usuario sin `impuestos.ver` → 403.
- [ ] Migraciones en las tres bases. `npx jest --runInBand test/sircreb test/posicion-iibb src/impuestos/posicion-iibb test/compras-config test/pagos-config test/ventas-maestros` → PASS (conteos a 53). Commit `feat(impuestos): recaudaciones bancarias SIRCREB en la liquidación de IIBB`.

### Task 4: Pantallas y e2e
**Files:** `apps/web/src/pagos/PadronesPage.tsx` (todas las jurisdicciones; formato del padrón en un modal para ≠ 901/902); `ConfigRetencionesPage.tsx` (regímenes SIRCAR en la tabla de jurisdicciones; *usa padrón* habilitado si hay formato); `impuestos/ConfigImpuestosPage.tsx` (*Jurisdicciones adheridas a SIRCAR*, multiselect con nombres); `impuestos/comun.ts` (presentaciones `SIRCAR_RETENCIONES` *SIRCAR retenciones (IIBB Convenio)* y `SIRCAR_PERCEPCIONES` *SIRCAR percepciones (IIBB Convenio)*); Create `impuestos/RecaudacionesBancariasPage.tsx` (período, tabla, alta/edición/baja, importar CSV); `PosicionIibbPage.tsx` (columna *Recaudaciones bancarias*); ruta `/impuestos/recaudaciones-bancarias` y menú *Recaudaciones bancarias (SIRCREB)*; `e2e/otras-jurisdicciones-iibb.spec.ts` (proyecto después de `bienes-personales`); `docs/pendientes.md` (1.1 punto 4 hecho; §2 datos de la spec §9). **Test:** `apps/web/src/impuestos/otras-jurisdicciones.test.tsx`.
- [ ] Pruebas que fallan: las presentaciones listan las dos de SIRCAR; la página de recaudaciones muestra la tabla por jurisdicción con nombres; la liquidación de IIBB muestra la columna *Recaudaciones bancarias*; el menú tiene la ruta con `impuestos.ver`. e2e: el contador carga una recaudación de Buenos Aires del mes y la ve restada en la liquidación de IIBB; el administrador marca una jurisdicción adherida a SIRCAR y genera el SIRCAR de retenciones del mes (archivo vacío con aviso o con renglones).
- [ ] `cd apps/web && npx vitest run && pnpm build`; e2e en base nueva → PASS. Commit `feat(web): otras jurisdicciones de IIBB`.

Al final: suite completa de la API (dos shards), web y e2e sola; revisión final.
