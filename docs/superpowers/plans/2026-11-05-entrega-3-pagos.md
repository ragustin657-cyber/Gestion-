# Entrega 3: Órdenes de pago, retenciones y pagos. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orden de pago con imputaciones, aprobación, retenciones de Ganancias e IIBB (con padrones ARBA y AGIP), pago con transferencia, cheque propio o efectivo en ARS o USD, certificados, asiento con diferencia de cambio, anulación, consultas y pantallas.

**Architecture:** Un módulo Nest `pagos` con submódulos `config`, `padron`, `retenciones` y `ordenes`, más consultas.
- Los cálculos de retenciones son funciones puras en `packages/shared/src/pagos`.
- El servicio `RetencionesService` reúne los datos (acumulados, padrón, ficha) y llama a esas funciones.
- El pago corre en una sola transacción que toca cuenta corriente, tesorería, cheques, certificados y asiento, reusando `AsientosService`, `NumeracionService` y `ConfigComprasService.cuenta`.

**Tech Stack:** la de las entregas 1 y 2. Se suma `multer`, que ya viene con `@nestjs/platform-express`, para subir los padrones.

**Spec:** `docs/superpowers/specs/2026-11-05-entrega-3-pagos-design.md`

## Global Constraints

- Todo modelo de negocio lleva `empresaId` y se agrega a `MODELOS_DE_EMPRESA`. **Excepciones globales** (sin `empresaId`): `PadronIibb` y `PadronCarga`, que se acceden con `PrismaService`.
- Importes `Decimal(18,2)`, alícuotas y cotizaciones `Decimal(18,6)`. Toda la aritmética se hace con decimal.js, redondeando a 2 decimales con ROUND_HALF_UP.
- Las retenciones van siempre en pesos.
- Auditoría en cada escritura, mensajes en castellano y validación con zod (400 `{ message, campos }`).
- "Hoy" se calcula con `hoyEn(ZONA_ARGENTINA)`.
- Bloqueo optimista por `version` en la OP (409 "El comprobante fue modificado por otro usuario"). `FOR UPDATE` en el orden: OP → movimientos de cuenta corriente → chequera.
- Talonarios:
  - `OP` (punto de venta 1);
  - `RET-GAN` (0);
  - `RET-IIBB-901`, `RET-IIBB-902`, … (0).
- Permisos nuevos: `op.ver`, `op.anular`, `retenciones.config`, `padron.cargar`. Se agregan al rol Administrador de las empresas existentes por migración.
- Rutas: `/api/pagos/...` y `/api/padrones`.

## Review Focus

1. **Retención mayor que lo que se paga, o base negativa:** una OP con NC que deja base ≤ 0 no retiene, y ninguna retención supera el total a cancelar. Test en Task 3.
2. **Pago en otro mes que la fecha de la OP:** el acumulado de Ganancias usa el mes de `fechaPago`, no el de la OP. Test en Task 5.
3. **Padrón fuera de vigencia:** una fila del padrón de octubre no aplica a un pago de noviembre y se usa ficha o defecto. Test en Task 3.
4. **Imputación con importe 0 o de signo contrario al saldo:** 400 con campo. Test en Task 4.
5. **Medio de pago en una moneda distinta a la de la cuenta bancaria o caja:** 400 "La moneda del medio de pago no coincide con la de la cuenta". Test en Task 5.

---

## Estructura de archivos

```
packages/shared/src/pagos/
  retenciones.ts        retencionGanancias, alicuotaIibb, retencionIibb, baseSujeta
apps/api/src/pagos/
  config/               montoAprobacionOp, regímenes, escala, jurisdicciones (+ seed de valores)
  padron/               parsers.ts, padron.service.ts, padron.controller.ts
  retenciones/          retenciones.service.ts (datos + motor), certificado-pdf.ts
  ordenes/              ordenes-pago.service.ts, pago.service.ts, anulacion.service.ts, dto.ts, controller, op-pdf.ts
  consultas/            pagos a realizar, retenciones practicadas (+ xlsx)
  pagos.module.ts
apps/web/src/pagos/     OrdenPagoPage, AprobacionOpPage, PagoOpPage, OrdenesPagoPage, DetalleOrdenPago,
                        PagosARealizarPage, RetencionesPage, ConfigRetencionesPage, PadronesPage
```

---

### Task 1: Configuración de pagos y retenciones

**Files:**
- Modify: `schema.prisma`:
  - `Empresa.montoAprobacionOp`, `Tercero.inscriptoGanancias`;
  - modelos `RegimenGanancias`, `EscalaGanancias`, `JurisdiccionIibb` y enum `SinPadron`;
  - migración con datos: conceptos nuevos de `ConfigCuenta` para empresas existentes, permisos nuevos al rol Administrador, regímenes, escala y jurisdicciones para empresas existentes.
- Modify: `modelos-empresa.ts`, `packages/shared/src/permisos.ts`, `src/compras/config/conceptos.ts` (conceptos nuevos en `CONCEPTOS_CUENTA`), `EmpresasService.crear`, `src/seed/demo.ts`, `terceros/dto.ts` (`inscriptoGanancias`)
- Create: `apps/api/src/pagos/config/{valores-iniciales.ts,config-pagos.service.ts,config-pagos.controller.ts}`, `apps/api/src/pagos/pagos.module.ts`
- Test: `apps/api/test/pagos-config.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `CONCEPTOS_CUENTA` agrega:
    - `RETENCION_GANANCIAS: '2.1.02.002'`
    - `RETENCION_IIBB: '2.1.02.004'`
    - `ANTICIPOS_PROVEEDORES: '1.1.04.001'`
    - `CHEQUES_DIFERIDOS: '2.1.01.002'`
    - `DIFERENCIA_CAMBIO_POSITIVA: '4.2.01'`
    - `DIFERENCIA_CAMBIO_NEGATIVA: '5.2.03'`
  - `cargarConfigPagos(tx: Prisma.TransactionClient, empresaId: string): Promise<void>`, en `valores-iniciales.ts`. Carga:
    - regímenes:

      | Código | Descripción | Mínimo no sujeto | Inscripto | No inscripto | Escala | Mínimo de retención |
      |---|---|---|---|---|---|---|
      | 78 | Enajenación de bienes de cambio | 224000 | 2 | 10 | no | 240 |
      | 94 | Locaciones de obra y servicios | 67170 | 2 | 28 | no | 240 |
      | 110 | Alquileres de inmuebles urbanos | 11200 | 6 | 28 | no | 240 |
      | 116 | Honorarios profesionales | 67170 | escala | 28 | sí | 240 |

    - escala:

      | Desde | Hasta | Fijo | % |
      |---|---|---|---|
      | 0 | 8000 | 0 | 5 |
      | 8000 | 16000 | 400 | 9 |
      | 16000 | 24000 | 1120 | 12 |
      | 24000 | 32000 | 2080 | 15 |
      | 32000 | 48000 | 3280 | 19 |
      | 48000 | 64000 | 6320 | 23 |
      | 64000 | 96000 | 10000 | 27 |
      | 96000 | — | 18640 | 31 |

    - jurisdicciones de `Empresa.jurisdiccionesIibb`: 901 y 902 con `usaPadron = true`, `sinPadron = NO_RETENER`, `alicuotaDefecto = 0`, `minimoRetencion = 0`. Las demás con `usaPadron = false`, `sinPadron = ALICUOTA_DEFECTO`, `alicuotaDefecto = 0`.
  - `ConfigPagosService.parametros(tx): Promise<{ montoAprobacionOp: Decimal }>`; `regimen(tx, codigo): Promise<RegimenGanancias | null>`; `escala(tx): Promise<EscalaGanancias[]>` ordenada por `desde`; `jurisdicciones(tx): Promise<JurisdiccionIibb[]>` (solo las de `Empresa.jurisdiccionesIibb`).
  - REST, con `retenciones.config` salvo los GET de lectura que usa la OP (`op.crear`):
    - `GET/PATCH /api/pagos/config` → `{ montoAprobacionOp }`;
    - `GET /api/pagos/config/regimenes`, `POST`, `PATCH /:id`;
    - `GET/PUT /api/pagos/config/escala` (reemplaza la lista; valida tramos contiguos y crecientes: si no, 400 "La escala debe tener tramos contiguos y crecientes");
    - `GET/PUT /api/pagos/config/jurisdicciones`.
  - Las respuestas de regímenes incluyen `verificar: true`. La web muestra la advertencia "verificar valores vigentes" mientras el registro no se haya editado; se guarda `editadoEn DateTime?` en el régimen.

- [ ] **Step 1: Tests que fallan:**
  - Una empresa creada por API tiene los 4 regímenes (el 94 con `minimoNoSujeto: '67170'`), 8 tramos de escala y la jurisdicción 902 con `usaPadron: true` si está en `jurisdiccionesIibb`.
  - `GET /compras/config` lista los 12 conceptos.
  - `PATCH /pagos/config { montoAprobacionOp: 500000 }` persiste.
  - `PUT escala` con un hueco (0–8000 y 9000–…) → 400.
  - `PATCH regimen` deja `editadoEn` cargado y `verificar: false`.
  - Sin `retenciones.config` → 403.
  - El Administrador nuevo tiene `op.anular`.
  - `PATCH /terceros/:id { inscriptoGanancias: false }` persiste.
- [ ] **Step 2:** `npx jest test/pagos-config` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** PASS; `pnpm --filter @gestion/api test` en verde.
- [ ] **Step 5: Commit** `feat(api): configuración de pagos y retenciones`

---

### Task 2: Padrones de IIBB (ARBA y AGIP)

**Files:**
- Modify: `schema.prisma` (`PadronIibb` y `PadronCarga`, globales; enum `EstadoCarga`)
- Create: `apps/api/src/pagos/padron/{parsers.ts,padron.service.ts,padron.controller.ts}`, `apps/api/test/fixtures/{padron-arba.txt,padron-agip.txt}` (5 filas cada uno, armadas según el formato de la spec §2, con una alícuota con coma decimal)
- Test: `apps/api/src/pagos/padron/parsers.spec.ts`, `apps/api/test/padron.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `type FilaPadron = { cuit: string; vigenciaDesde: Date; vigenciaHasta: Date; alicuotaRetencion: string | null; alicuotaPercepcion: string | null }`.
  - `parsearLineaArba(linea: string, nro: number): FilaPadron | null`: null en líneas vacías. Una fila `R` setea `alicuotaRetencion`; una `P`, `alicuotaPercepcion`. Si la línea es inválida lanza `Error('Línea <nro> inválida: <motivo>')`.
  - `parsearLineaAgip(linea: string, nro: number): FilaPadron | null`.
  - `PadronService.cargar(jurisdiccion: '901' | '902', nombreArchivo: string, contenido: Buffer, usuarioId: string): Promise<{ id: string }>`:
    - crea `PadronCarga` PROCESANDO y procesa en segundo plano (`setImmediate`);
    - lee el contenido como `latin1`, línea por línea;
    - fusiona por CUIT las filas R y P de ARBA;
    - inserta con `createMany` en lotes de 5000 dentro de una transacción que primero borra las filas de esa jurisdicción con la misma `vigenciaDesde`;
    - período = `YYYY-MM` de la `vigenciaDesde` de la primera fila;
    - si algo falla, la carga queda en ERROR con el mensaje y el padrón anterior no cambia.
  - `PadronService.alicuotaRetencion(jurisdiccion: string, cuit: string, fecha: Date): Promise<string | null>`: busca la fila con `vigenciaDesde ≤ fecha ≤ vigenciaHasta`.
  - REST:
    - `POST /api/padrones` (multipart: campos `jurisdiccion` y `archivo`; `padron.cargar` o superadmin) → 202 `{ id }`;
    - `GET /api/padrones` → cargas por `creadoEn` descendente;
    - `GET /api/padrones/:id`.
  - **Permisos:** el padrón es global, pero cualquier usuario con `padron.cargar` en alguna empresa puede cargarlo.

- [ ] **Step 1: Tests que fallan:**
  - `parsers.spec`:
    - ARBA `R;01102026;01112026;30112026;30700123452;D;N;N;1,75;0` → `{ cuit: '30700123452', alicuotaRetencion: '1.75', vigenciaDesde: 2026-11-01 }`;
    - línea con CUIT de 10 dígitos → error con "Línea 3 inválida";
    - AGIP con percepción 3,00 y retención 2,50 → ambas alícuotas;
    - línea vacía → null.
  - `padron.e2e`:
    - Cargar el fixture de ARBA → 202; polling a `GET /:id` hasta COMPLETA con `filas: 5`.
    - `alicuotaRetencion('902', cuit, 2026-11-15)` = '1.75'; con fecha 2026-12-01 → null.
    - Recargar el mismo período reemplaza las filas sin duplicar.
    - Un archivo con una línea inválida queda en ERROR y conserva las filas anteriores.
    - Sin permiso → 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar** (`FileInterceptor('archivo', { limits: { fileSize: 600 * 1024 * 1024 } })`).
- [ ] **Step 4:** PASS; suite en verde.
- [ ] **Step 5: Commit** `feat(api): carga de padrones de IIBB (ARBA y AGIP)`

---

### Task 3: Motor de retenciones

**Files:**
- Create: `packages/shared/src/pagos/{retenciones.ts,index.ts}` (exportar desde `src/index.ts`), `packages/shared/src/pagos/retenciones.test.ts`
- Create: `apps/api/src/pagos/retenciones/retenciones.service.ts`
- Test: `apps/api/test/pagos-retenciones.e2e-spec.ts`

**Interfaces:**
- Produces (shared):
  - `baseSujeta(importePesos: string, c: { netoGravado: string; noGravado: string; exento: string; total: string } | null): string`: con `null` (anticipo) devuelve el importe; si no, importe × (neto + noGravado + exento) / total, redondeado.
  - `retencionGanancias(e: { sujeto: boolean; inscripto: boolean; regimen: { minimoNoSujeto: string; alicuotaInscripto: string; alicuotaNoInscripto: string; usaEscala: boolean; minimoRetencion: string }; escala: { desde: string; hasta: string | null; fijo: string; porcentaje: string }[]; baseAcumuladaPrevia: string; basePago: string; retenidoPrevio: string }): { importe: string; acumulado: string; sujetoRetencion: string; impuestoDeterminado: string }`.
    - Con escala: usa la escala si `inscripto`; si no, la alícuota de no inscripto.
    - Si `basePago` ≤ 0, `importe` es '0.00'.
  - `alicuotaIibb(e: { exento: boolean; padron: string | null; ficha: string | null; usaPadron: boolean; sinPadron: 'NO_RETENER' | 'ALICUOTA_DEFECTO'; alicuotaDefecto: string }): string | null`.
  - `retencionIibb(base: string, alicuota: string, minimo: string): string`: '0.00' si el resultado es menor al mínimo o si la base es ≤ 0.
- Produces (API):
  - `type RetencionCalculada = { impuesto: 'GANANCIAS' | 'IIBB'; jurisdiccion: string | null; regimen: string | null; base: string; alicuota: string; importe: string; detalle: Record<string, string> }`.
  - `RetencionesService.calcular(tx: TxEmpresa, e: { terceroId: string; fechaPago: Date; bases: string[]; excluirOrdenPagoId?: string }): Promise<RetencionCalculada[]>`:
    - devuelve solo las filas con importe > 0;
    - `bases` son las bases por imputación (pueden ser negativas) y su suma es la base del pago;
    - para el acumulado previo suma las retenciones de Ganancias (`OrdenPagoRetencion` no anuladas) y sus bases (`detalle.basePago`) de OP **PAGADAS** del mismo proveedor y régimen con `fechaPago` en el mismo mes calendario;
    - cuando se escriba la Task 4, `excluirOrdenPagoId` deja fuera la OP actual.
  - **Contrato con la Task 4:** el acumulado se arma con `OrdenPagoRetencion` (`impuesto = 'GANANCIAS'`, `regimen`) y con `OrdenPago.fechaPago` y `estado`. Mientras no existan esos modelos, el servicio recibe una función `acumuladoGanancias(tx, terceroId, regimen, mes)`; la Task 4 la reemplaza por la consulta real.
  - **Ganancias:** `sujeto` = false si el tercero es MONOTRIBUTO, si `exentoGanancias` está vigente (`exencionHasta` null o ≥ `fechaPago`) o si no tiene `regimenGanancias` o el régimen no existe o está inactivo.
  - **IIBB:**
    - jurisdicciones de la empresa;
    - exento y ficha desde `TerceroIibb` de esa jurisdicción;
    - padrón con `PadronService.alicuotaRetencion` solo si `usaPadron`.
  - **Tope:** si el total de retenciones supera la base del pago, 400 "Las retenciones superan el importe a pagar".

- [ ] **Step 1: Tests que fallan** (shared, régimen de prueba: mínimo 100000, 2 %, no inscripto 28 %, mínimo de retención 240):
  - Previa 0 y pago 90000 → '0.00'.
  - Previa 80000 y pago 50000 → importe '600.00', acumulado '130000.00', sujeto '30000.00'.
  - Igual pero con retenido previo 500 → impuesto 600 − 500 = 100 < 240 → '0.00'.
  - No inscripto, previa 80000 y pago 50000 → '8400.00'.
  - Escala con mínimo 67170 y pago 100000 → excedente 32830, tramo 32000–48000: 3280 + 830 × 19 % = '3437.70'.
  - `sujeto: false` → '0.00'.
  - **(Review Focus 1)** basePago −1000 → '0.00'.
  - `alicuotaIibb`:
    - padrón '1.75' gana sobre ficha '3';
    - sin padrón usa ficha;
    - sin padrón ni ficha con NO_RETENER → null;
    - con ALICUOTA_DEFECTO '2.5' → '2.5';
    - exento → null.
  - `retencionIibb('10000', '1.75', '200')` → '0.00' (175 < 200); con mínimo 100 → '175.00'.
  - `baseSujeta('1210.00', { netoGravado: '1000', noGravado: '0', exento: '0', total: '1210' })` → '1000.00'; con null → '1210.00'.
- [ ] **Step 1b: Tests que fallan** (API, `pagos-retenciones.e2e`, con `RetencionesService` llamado en contexto CLS):
  - Un proveedor RI con régimen 94 y la empresa agente en 902; el padrón de prueba cargado con su CUIT a 1,75 vigente en noviembre; base 100000 el 2026-11-15:
    - Ganancias = (100000 − 67170) × 2 % = 656.60;
    - IIBB = 1750.00.
  - **(Review Focus 3)** Mismo cálculo con fecha 2026-12-10 (padrón no vigente, sin ficha, NO_RETENER) → solo Ganancias.
  - Monotributista → sin retenciones.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** PASS; suites en verde.
- [ ] **Step 5: Commit** `feat: motor de retenciones de Ganancias e IIBB`

---

### Task 4: Orden de pago: borrador, imputaciones y aprobación

**Files:**
- Modify: `schema.prisma`:
  - `OrdenPago`, `OrdenPagoImputacion`, `OrdenPagoAnticipo`, `OrdenPagoRetencion`;
  - enum `EstadoOP { BORRADOR PENDIENTE_APROBACION APROBADA PAGADA ANULADA }`;
  - en `MovimientoCuentaCorriente`, el `origenTipo` admite 'ANTICIPO' (es un String, sin cambio de esquema).
- Modify: `modelos-empresa.ts`
- Create: `apps/api/src/pagos/ordenes/{ordenes-pago.service.ts,ordenes-pago.controller.ts,dto.ts}`
- Modify: `RetencionesService`: implementa el acumulado real con `OrdenPagoRetencion`.
- Test: `apps/api/test/pagos-op.e2e-spec.ts`; helper `facturaPendiente(http, prisma, empresaId, { proveedorId, total, moneda?, cotizacion? })` en `test/helpers.ts`, que crea una factura directa A y devuelve el id de su movimiento de cuenta corriente.

**Interfaces:**
- Consumes: `RetencionesService.calcular`, `baseSujeta`, `ConfigPagosService.parametros`, `MonedasService.cotizacion`, y el patrón de transiciones y `errorTransicion` de `compras/comun.ts`.
- Produces:
  - Body de borrador:

    ```
    { terceroId, fecha, cotizacion?, observaciones?,
      imputaciones: [{ movimientoId uuid, importe ≠ 0 }],
      anticipo?: { monedaCodigo 'ARS'|'USD', importe > 0 } | null }
    ```

    Debe haber al menos una imputación o un anticipo: "La orden de pago no tiene importe a pagar".
  - **Cotización:** si viene en el body y es mayor a 0, se usa esa; si no, la vigente a la fecha cuando hay USD (si no hay, 400 con el mensaje de cotización). Si todo es en ARS, 1.
  - **Validaciones de imputación:**
    - movimiento del mismo tercero, no anulado;
    - signo del importe igual al del saldo: si no, 400 en `imputaciones.<i>.importe` "El importe debe tener el mismo signo que el saldo";
    - |importe| ≤ |saldo − comprometido|.
  - `comprometido(tx, movimientoId, excluirOpId?): Promise<Decimal>`: suma las imputaciones en OP con estado BORRADOR, PENDIENTE_APROBACION o APROBADA.
  - REST:
    - `GET /api/pagos/pendientes?terceroId` (`op.crear`) → `[{ movimientoId, comprobante, fecha, fechaVencimiento, monedaCodigo, saldo, comprometido, disponible }]`, solo los que tienen disponible ≠ 0;
    - `GET /api/pagos/ordenes` y `GET /:id` (`op.ver`). El detalle incluye imputaciones con descripción del comprobante, anticipo, retenciones, medios, certificados y asiento;
    - `POST`, `PATCH /:id` y `DELETE /:id` (`op.crear`, solo en BORRADOR, con la guarda `updateMany`/`deleteMany` por estado de la Entrega 2);
    - `POST /:id/confirmar { version }` (`op.crear`): número, retenciones de vista previa con `fecha` (guardadas en `OrdenPagoRetencion`), `totalRetenciones`, `netoPagar` y aprobación automática si `0 < totalCancelarPesos ≤ montoAprobacionOp`;
    - `POST /:id/aprobar { version }` y `POST /:id/rechazar { version, motivo }` (`op.aprobar`): misma regla de creador y único aprobador que la OC (con `op.aprobar`);
    - `POST /:id/anular { version, motivo }` (`op.anular`): para PENDIENTE_APROBACION o APROBADA; PAGADA en la Task 6.

- [ ] **Step 1: Tests que fallan:**
  - Una factura de 1210 → OP con imputación 1210 → `totalCancelarPesos: '1210'` y confirmar con límite 0 → `PENDIENTE_APROBACION` con número 1 y retenciones de vista previa.
  - Una factura USD de 100 (cotización de factura 1000) y una OP con cotización 1100 → `importePesos` 110000.
  - **(Review Focus 4)** Importe 0 → 400; importe −10 sobre saldo positivo → 400 con el mensaje de signo.
  - **Comprometido:** OP1 borrador de 1000 sobre 1210 → OP2 con 300 → 400 con "saldo disponible del comprobante (210"; con 210 → 201. `GET /pendientes` muestra `disponible: '0'`.
  - Solo un anticipo de 5000 ARS → total 5000.
  - Sin imputaciones ni anticipo → 400.
  - El creador no aprueba si hay otro aprobador → 403; el otro aprueba → APROBADA.
  - Aprobación automática con límite 1.000.000.
  - Rechazar sin motivo → 400.
  - Anular una aprobada → ANULADA y libera lo comprometido.
  - Otra empresa → 404.
  - Imputar un movimiento de otro proveedor → 400 "El comprobante no pertenece al proveedor".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** PASS; suite en verde.
- [ ] **Step 5: Commit** `feat(api): órdenes de pago con imputaciones y aprobación`

---

### Task 5: Pago de la orden: medios, cheques, tesorería, aplicaciones, certificados y asiento

**Files:**
- Modify: `schema.prisma` (`OrdenPagoMedio`, `ChequePropio`, `MovimientoTesoreria`, `AplicacionCuentaCorriente` y enums), `modelos-empresa.ts`
- Create: `apps/api/src/pagos/ordenes/pago.service.ts`; endpoint en el controller
- Test: `apps/api/test/pagos-pago.e2e-spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 y 4; `AsientosService.generar`; `NumeracionService.siguiente`; `ConfigComprasService.cuenta`; `bloquear` (se extiende a `'OrdenPago' | 'MovimientoCuentaCorriente' | 'Chequera'`).
- Produces:
  - Body del pago:

    ```
    { version, fechaPago,
      medios (min 1): [{ tipo 'TRANSFERENCIA'|'CHEQUE'|'EFECTIVO', monedaCodigo, importe > 0,
        cuentaBancariaId?, cajaId?, chequeraId?, chequeNumero?, chequeFechaPago?, referencia? }] }
    ```

    - TRANSFERENCIA exige `cuentaBancariaId`; EFECTIVO exige `cajaId`; CHEQUE exige `chequeraId` y `chequeFechaPago`.
    - En un cheque de chequera FISICA, si no viene `chequeNumero` se usa `proximoNumero`.
    - En e-cheq, `chequeNumero` es obligatorio.
  - `POST /api/pagos/ordenes/:id/pagar` (`pago.ejecutar`) → OP PAGADA con todo el detalle. Pasos y validaciones, en orden:
    1. `FOR UPDATE` sobre la OP y verificación de `version` y estado APROBADA.
    2. Recalcular las retenciones con `fechaPago`: reemplaza las de vista previa.
    3. Los medios en USD a pesos con la cotización de la OP. Σ medios + retenciones = total; si no, 400 con el mensaje de la spec, importes formateados `1.234,56`.
    4. **(Review Focus 5)** La moneda del medio debe coincidir con la de la cuenta bancaria, la caja o la cuenta de la chequera.
    5. `FOR UPDATE` sobre los movimientos imputados y revalidar el saldo.
    6. Cheque físico: número dentro de `[desde, hasta]` y no usado (400 "El número de cheque está fuera del rango de la chequera" / 409 "El cheque N ya fue emitido"); `proximoNumero` = max(actual, número + 1).
    7. Tesorería: EGRESO para transferencia, efectivo y cheques con `chequeFechaPago ≤ fechaPago`.
    8. Aplicaciones y saldos según la spec §4.5.
    9. Anticipo → `MovimientoCuentaCorriente` con `origenTipo 'ANTICIPO'` e importe, importePesos, saldo y saldoPesos negativos.
    10. Certificados: `certificadoNumero` por talonario `RET-GAN` / `RET-IIBB-<j>`.
    11. Asiento con `origenTipo 'PAGO'` según la spec §5. Las líneas de anticipos aplicados (imputaciones de movimientos ANTICIPO) van al haber de ANTICIPOS_PROVEEDORES por su importe histórico, y las de comprobantes al debe de PROVEEDORES con signo.
    12. Estado PAGADA, `fechaPago`, `pagadoPor` y auditoría `MODIFICAR { pago: true }`.

- [ ] **Step 1: Tests que fallan:**
  - **Pago combinado** (factura ARS 121000 neto 100000, proveedor régimen 94, empresa agente 902 sin padrón y con ficha IIBB al 2 %):
    - retenciones Ganancias 656.60 e IIBB 2000.00;
    - medios: transferencia ARS 100000 + cheque e-cheq diferido 18343.40;
    - resultado: PAGADA, saldo de la factura 0, dos certificados número 1;
    - el asiento debe Proveedores 121000 y haber Retenciones Ganancias 656.60, Retenciones IIBB 2000, Banco 100000 y Cheques diferidos 18343.40;
    - un solo `MovimientoTesoreria`.
  - **Diferencia de cambio:** factura USD 100 a cotización 1000 (saldoPesos 100000), OP con cotización 1100 pagada en efectivo USD 100 desde una caja USD con proveedor sin régimen ni IIBB:
    - saldo USD 0 y saldoPesos 0;
    - el asiento tiene debe Proveedores 100000 + Diferencia de cambio negativa 10000 y haber Caja 110000.
  - **Pago parcial en USD:** se pagan 40 de 100 → saldo 60 y saldoPesos 60000.
  - Medios + retenciones ≠ total → 400 con el mensaje.
  - **(Review Focus 5)** Transferencia USD desde una cuenta ARS → 400.
  - Cheque físico fuera de rango → 400; número repetido → 409; sin número toma `proximoNumero` y lo avanza.
  - **Pago concurrente:** dos `pagar` simultáneos con la misma versión → 200 y 409.
  - **(Review Focus 2)** Una OP con `fecha` 2026-10-31 pagada con `fechaPago` 2026-11-03: el acumulado de Ganancias toma los pagos de noviembre. Antes se paga otra OP de 50000 de base el 2026-11-02; la segunda, de 50000, retiene (100000 − 67170) × 2 % − 0 = 656.60 recién en la segunda.
  - **Anticipo:** una OP con anticipo de 5000 → movimiento −5000. Una OP posterior imputa la factura 1210 y el anticipo −1210 (total 0 + otro medio 0): 400 "La orden de pago no tiene importe a pagar". Con la factura de 6050 y el anticipo −5000: medios 1050 y el asiento tiene haber Anticipos 5000.
  - Pagar sin `pago.ejecutar` → 403; pagar en estado PENDIENTE → 400.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** PASS; suite en verde.
- [ ] **Step 5: Commit** `feat(api): pago de órdenes con medios, retenciones, certificados y asiento`

---

### Task 6: Anulación de una orden de pago pagada

**Files:**
- Create: `apps/api/src/pagos/ordenes/anulacion.service.ts`; modifica `anular` para delegar en este servicio cuando está PAGADA
- Test: `apps/api/test/pagos-anulacion.e2e-spec.ts`

**Interfaces:**
- Produces: al anular una OP PAGADA:
  - contraasiento con fecha `hoyEn(ZONA_ARGENTINA)`, guardado en `asientoAnulacionId`;
  - aplicaciones anuladas y saldos restaurados (saldo += importe; saldoPesos += importePesosHistorico);
  - anticipo anulado; si tenía aplicaciones, 400 "El anticipo de esta orden ya fue aplicado";
  - cheques ANULADO, `MovimientoTesoreria` anulados y retenciones `anulada = true`;
  - estado ANULADA y auditoría ANULAR.
- [ ] **Step 1: Tests que fallan:**
  - Anular la OP del pago combinado de la Task 5 → el saldo de la factura vuelve a 121000, los certificados quedan anulados, el contraasiento invierte las líneas y los cheques quedan ANULADO.
  - Después la factura vuelve a figurar en `GET /pagos/pendientes`.
  - Anular dos veces → 409.
  - Anticipo aplicado → 400.
  - Sin `op.anular` → 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** PASS; suite en verde.
- [ ] **Step 5: Commit** `feat(api): anulación de órdenes de pago pagadas`

---

### Task 7: Consultas y PDF de pagos

**Files:**
- Create: `apps/api/src/pagos/consultas/{consultas-pagos.service.ts,consultas-pagos.controller.ts,retenciones-xlsx.ts}`, `apps/api/src/pagos/ordenes/op-pdf.ts`, `apps/api/src/pagos/retenciones/certificado-pdf.ts`
- Modify: `ConsultasComprasService.cuentaCorriente`: los movimientos ANTICIPO se etiquetan "Anticipo OP 0001-…". Las OP pagadas aparecen como aplicaciones: cada movimiento muestra su `saldo` y se agrega la lista `aplicaciones` con fecha, OP e importe.
- Test: `apps/api/test/pagos-consultas.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `GET /api/pagos/pagos-a-realizar?fecha` (`op.ver`) → `{ comprobantes: [{ terceroId, razonSocial, movimientoId, comprobante, fechaVencimiento, monedaCodigo, saldo, saldoPesos, vencido: boolean }], ordenesAprobadas: [{ id, numero, razonSocial, netoPagar, fecha }] }`.
  - `GET /api/pagos/retenciones?desde&hasta&impuesto&jurisdiccion&incluirAnuladas` (`op.ver`) → filas `{ fechaPago, certificado, impuesto, jurisdiccion, regimen, razonSocial, cuit, base, alicuota, importe, ordenPagoNumero, anulada }`. Con `&formato=xlsx` devuelve `retenciones-<desde>-<hasta>.xlsx` con fila de totales. Fechas validadas con `fechaQuery`.
  - `GET /api/pagos/ordenes/:id/pdf` (`op.ver`): PDF de la OP. Si no está confirmada, 400 "La orden no está confirmada".
  - `GET /api/pagos/ordenes/:id/certificados/:retencionId/pdf` (`op.ver`): solo si la OP está PAGADA o ANULADA (en el PDF anulado se lee "ANULADO"). Si no, 400 "La retención todavía no tiene certificado".
- [ ] **Step 1: Tests que fallan:**
  - Pagos a realizar con una factura vencida → `vencido: true` y la OP aprobada en la lista.
  - Retenciones de noviembre con dos certificados → filas con certificado `'0001'` formateado `RET-GAN 00000001`, y el xlsx con fila "Totales".
  - El PDF de la OP y el del certificado empiezan con `%PDF`; certificado de una OP no pagada → 400.
  - Cuenta corriente: después del pago la factura figura con saldo 0 y una aplicación.
  - Otra empresa → 404 / vacío.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** PASS; suite en verde.
- [ ] **Step 5: Commit** `feat(api): consultas de pagos, retenciones practicadas y PDF`

---

### Task 8: Web: orden de pago y aprobación

**Files:**
- Create: `apps/web/src/pagos/{OrdenPagoPage.tsx,OrdenesPagoPage.tsx,DetalleOrdenPago.tsx,SelectorComprobantes.tsx,formato.ts}`
- Modify: `menu.ts` (rama **Pagos** en Registraciones y en Consultas, que reemplaza Próximamente donde haga falta), `rutas.tsx`, `RolesPage` (grupos `op`, `pago`, `retenciones`, `padron` → "Pagos")
- Test: `apps/web/src/pagos/SelectorComprobantes.test.tsx`

**Interfaces:**
- Consumes: endpoints de la Task 4; `formatoMoneda` y `formatoFecha` de `compras/formato.ts`.
- Produces:
  - `<SelectorComprobantes pendientes seleccion onChange cotizacion />`:
    - tabla de pendientes con checkbox e importe a cancelar editable (por defecto, el disponible);
    - el pie muestra el total a cancelar en pesos (ARS × 1, USD × cotización) con `formatoMoneda`;
    - un importe mayor al disponible pinta el campo en rojo con el texto "Supera el disponible".
  - **Páginas:**
    - Registraciones › Pagos › Orden de pago (`/pagos/op/nueva`, `/pagos/op/:id`, `op.crear`): proveedor, fecha, cotización, selector, anticipo opcional, botones Guardar borrador / Confirmar / Eliminar. Al confirmar muestra las retenciones de vista previa y el neto.
    - Registraciones › Pagos › Aprobación de OP (`/pagos/op/aprobacion`, `op.aprobar`).
    - Consultas › Pagos › Órdenes de pago (`/pagos/op`, `op.ver`): `DetalleOrdenPago` con imputaciones, retenciones (detalle de cálculo), medios, asiento, certificados (descarga) y acciones (Aprobar, Rechazar, Anular, PDF) según permiso y estado.
- [ ] **Step 1: Test que falla:**
  - Con dos pendientes (ARS 1210 disponible y USD 100 disponible) y cotización 1100, al tildar ambos el pie muestra "$ 111.210,00".
  - Escribir 2000 en el primero muestra "Supera el disponible".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** PASS; `build` sin errores; el test de rutas del menú en verde.
- [ ] **Step 5: Commit** `feat(web): órdenes de pago y aprobación`

---

### Task 9: Web: pago de OP, pagos a realizar y retenciones practicadas

**Files:**
- Create: `apps/web/src/pagos/{PagoOpPage.tsx,MediosPago.tsx,PagosARealizarPage.tsx,RetencionesPage.tsx}`
- Modify: `menu.ts`, `rutas.tsx`
- Test: `apps/web/src/pagos/MediosPago.test.tsx`

**Interfaces:**
- Produces:
  - `<MediosPago medios onChange cuentas cajas chequeras cotizacion totalACubrir />`:
    - filas de medio con tipo, moneda (filtra cuentas, cajas y chequeras compatibles), importe y datos según tipo;
    - el pie muestra "Cubierto: $ X / A cubrir: $ Y" y "Falta $ Z" en rojo si Z ≠ 0.
  - **Páginas:**
    - Registraciones › Pagos › Pago de OP (`/pagos/pago`, `pago.ejecutar`): bandeja de OP aprobadas. Al elegir una, muestra imputaciones, retenciones recalculadas en vivo (el confirmar previo de la API las devuelve; para recalcular con otra fecha se usa `GET /api/pagos/ordenes/:id/retenciones?fechaPago=`, que **se agrega en esta task** con `pago.ejecutar` y llama a `RetencionesService.calcular` sin persistir), fecha de pago y `MediosPago`. El botón Pagar se habilita con Falta = 0 y al terminar ofrece descargar los certificados.
    - Consultas › Pagos › Pagos a realizar (`op.ver`) y Retenciones practicadas (`op.ver`, con exportación a Excel).
- [ ] **Step 1: Tests que fallan:**
  - `MediosPago`: con total a cubrir 118343.40 y un medio de 100000, se lee "Falta $ 18.343,40"; al agregar 18343.40, "Falta" desaparece.
  - API: `GET /retenciones?fechaPago=2026-11-15` devuelve las mismas retenciones que el cálculo de la Task 5 (test en `pagos-pago.e2e-spec.ts`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** PASS; `build` sin errores.
- [ ] **Step 5: Commit** `feat(web): pago de órdenes, pagos a realizar y retenciones practicadas`

---

### Task 10: Web: configuración de retenciones, padrones y ficha del proveedor

**Files:**
- Create: `apps/web/src/pagos/{ConfigRetencionesPage.tsx,PadronesPage.tsx}`
- Modify: `menu.ts` (Administración › Retenciones (`retenciones.config`) y Padrones de IIBB (`padron.cargar`)), `rutas.tsx`, `paginas/TercerosPage.tsx` (campo "Inscripto en Ganancias" y régimen como Select de `/api/pagos/config/regimenes`), `compras/ConfigComprasPage.tsx` (etiquetas de los 6 conceptos nuevos), `api/cliente.ts` (`subirArchivo(ruta, campos, archivo)`)
- Test: `apps/web/src/pagos/ConfigRetencionesPage.test.tsx`

**Interfaces:**
- Produces:
  - **ConfigRetencionesPage**, con pestañas:
    - Ganancias: tabla de regímenes (`Maestro`) con el badge "Verificar valores vigentes" si `verificar` y el editor de escala;
    - IIBB: jurisdicciones con alícuota por defecto, mínimo, usa padrón y sin padrón;
    - General: monto límite de OP.
  - **PadronesPage:** selector de jurisdicción, archivo, botón Cargar y tabla de cargas con estado, filas y error (refresca cada 3 s mientras haya cargas PROCESANDO).
- [ ] **Step 1: Test que falla:** con un régimen `verificar: true`, la página muestra "Verificar valores vigentes".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** PASS; `build` sin errores.
- [ ] **Step 5: Commit** `feat(web): configuración de retenciones y carga de padrones`

---

### Task 11: Seed demo, e2e y README

**Files:**
- Modify: `src/seed/demo.ts` y `src/seed/demo-completo.ts`. Se agregan:
  - el usuario `tesorero@demo.com` / `tesorero1234` con rol Tesorero (`tercero.ver`, `op.ver`, `pago.ejecutar`, `tesoreria.maestros.editar`, `fc.ver`);
  - `op.ver`, `op.crear` al rol Comprador y `op.ver`, `op.aprobar` al Aprobador;
  - regímenes, escala y jurisdicciones (vía `cargarConfigPagos`);
  - régimen 94 en 3 proveedores;
  - un padrón 902 de ejemplo con 3 CUIT de proveedores demo vigente en el mes actual (insertado con `PadronService`);
  - una OP pagada (transferencia), una aprobada y una pendiente de aprobación.
- Modify: `test/seed.e2e-spec.ts`, `README.md`
- Create: `e2e/pagos.spec.ts`

**Interfaces:**
- Produces: `sembrarCompleto` sigue siendo idempotente.
- [ ] **Step 1: Tests que fallan:**
  - `seed.e2e-spec`: 3 OP (PAGADA, APROBADA, PENDIENTE_APROBACION), al menos 1 certificado, el usuario tesorero y todos los asientos balanceados.
  - `e2e/pagos.spec.ts`:
    1. `admin` carga una factura directa de un proveedor sin documentos previos.
    2. Arma la OP con esa factura y la confirma: queda pendiente si supera el límite. Para eso el seed define `montoAprobacionOp = 1.000.000` y la factura es de 1.815.000.
    3. `aprobador` aprueba.
    4. `tesorero` paga con transferencia por el neto menos lo cubierto y un cheque e-cheq por el resto, y ve "Pagada".
    5. En Retenciones practicadas aparece el certificado.
    6. En la cuenta corriente del proveedor el saldo es "$ 0,00".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `pnpm test` y `pnpm e2e` en verde (base e2e recreada).
- [ ] **Step 5: README:** sección "Órdenes de pago y retenciones", usuarios demo y la advertencia de verificar los valores de Ganancias.
- [ ] **Step 6: Commit** `feat: datos demo y prueba de punta a punta de pagos`

---

## Cobertura de la spec

| Spec | Task |
|---|---|
| §1 Configuración, conceptos, regímenes, escala, jurisdicciones y permisos | 1, 10 |
| §2 Padrones | 2, 10 |
| §3 Motor de retenciones | 3 |
| §4 OP (imputaciones, comprometido, aprobación) | 4, 8 |
| §4 Pagar (medios, cheques, tesorería, aplicaciones, anticipos, certificados) | 5, 9 |
| §4 Anular | 6 |
| §5 Asiento y diferencia de cambio | 5 |
| §6 Consultas y PDF | 7, 9 |
| §7 Web | 8, 9, 10 |
| §8 Concurrencia | 4, 5 |
| §9 Pruebas y seed | todas, 11 |

**Decisiones del plan que la spec no fijaba:**
- Se agrega `RegimenGanancias.editadoEn` para apagar la advertencia "verificar".
- Endpoint para recalcular retenciones con otra fecha de pago sin guardar.
- Los valores precargados de Ganancias y de la escala son los de la tabla de la Task 1 y requieren verificación del contador.
- Cualquier usuario con `padron.cargar` en alguna empresa puede cargar el padrón global.
