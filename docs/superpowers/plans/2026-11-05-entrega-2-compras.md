# Entrega 2: Circuito de compras. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Circuito completo OC → aprobación → informe de recepción → factura de proveedor, con control de 3 vías, cuenta corriente en ARS/USD, asientos automáticos y consultas (cuenta corriente, antigüedad, Libro IVA Compras, buscador), en API y web.

**Architecture:** Un módulo Nest `compras` con un servicio por comprobante (OC, IR, FC) y un servicio de consultas. Se suman dos módulos transversales: `contabilidad/asientos` (motor) y `compras/config`. Los cálculos de importes son funciones puras de `packages/shared` con `decimal.js`, usadas igual por la API y por la web. Cada transición de estado corre en una transacción `TenantPrisma.transaccion`, con bloqueo optimista por `version` y `FOR UPDATE` sobre los renglones.

**Tech Stack:** las librerías de la Entrega 1, más `decimal.js` (shared), `pdfkit` (PDF de OC, API) y `exceljs` (exportación del Libro IVA, API).

**Spec:** `docs/superpowers/specs/2026-11-05-entrega-2-compras-design.md` (más la spec general y la Entrega 1 ya implementada).

## Global Constraints

- Todo modelo nuevo de negocio, **incluidos los renglones**, lleva `empresaId`, se agrega a `MODELOS_DE_EMPRESA` y se accede solo por `TenantPrisma`.
- Montos `Decimal(18,2)`; cantidades y precios unitarios `Decimal(18,4)`; alícuotas, tolerancias y cotizaciones `Decimal(18,6)`. Toda aritmética usa `decimal.js`: nunca `number` para dinero, ni en la API ni en la web.
- Redondeo a 2 decimales con `ROUND_HALF_UP`.
- Toda escritura llama a `AuditoriaService.registrar(tx, …)` en la misma transacción. Acciones: `CREAR`, `MODIFICAR`, `APROBAR`, `ANULAR`.
- Bloqueo optimista: los endpoints de transición de OC reciben `version`; si no coincide, responden 409 "El comprobante fue modificado por otro usuario".
- Mensajes al usuario en castellano. Validación de body con `ZodValidationPipe`, que responde 400 `{ message, campos }`.
- Talonarios: `OC` (punto de venta 1), `IR` (1), `FC` (1, número interno) y `ASIENTO` (0).
- Permisos nuevos en `packages/shared/src/permisos.ts`: `compras.config`, `oc.ver`, `oc.anular`, `ir.ver`, `ir.anular`, `fc.ver`, `fc.anular`. Se agregan al rol Administrador de las empresas existentes por migración de datos.
- Prefijo de rutas: `/api/compras/...`.

## Review Focus

1. **Factura o OC en USD sin cotización cargada para la fecha:** 400 con el mensaje "No hay cotización de USD para el DD/MM/AAAA", nunca 500. Test en Tasks 4 y 6.
2. **Montos inválidos en renglones** (cantidad ≤ 0, precio < 0, bonificación > 100, alícuota inexistente) o **comprobante sin renglones:** 400 con campo. Test en Tasks 1, 4 y 6.
3. **Mezclar proveedores o empresas:** una recepción con renglones de una OC de otro proveedor (400) o de otra empresa (404); una factura con renglones de recepción de otro proveedor (400). Test en Tasks 5 y 6.
4. **Facturar dos veces lo mismo:** facturar un renglón de recepción ya facturado completo da diferencia de cantidad (422 en modo avisar, 400 en modo bloquear). Anular una factura ya anulada da 409. Test en Tasks 6 y 7.
5. **Asiento en USD con cotización que produce centavos de redondeo:** el asiento queda balanceado (debe = haber exacto). Test en Tasks 1 y 6.

---

## Estructura de archivos

```
packages/shared/src/compras/
  calculos.ts           importeRenglon, calcularTotales, ALICUOTAS
  letras.ts             letrasValidas
  asiento-pesos.ts      lineasEnPesos (conversión + ajuste de redondeo)
apps/api/src/
  compras/config/       config de compras + ConfigCuenta
  contabilidad/asientos/ AsientosService
  compras/ordenes/      OC: service, controller, dto, pdf
  compras/recepciones/  IR
  compras/comprobantes/ FC: service (confirmar), tres-vias.ts, anulacion
  compras/consultas/    cuenta corriente, antigüedad, libro IVA, buscador, pendientes
  compras/compras.module.ts
apps/web/src/compras/
  GrillaRenglones.tsx, OrdenCompraPage.tsx, AprobacionOcPage.tsx, OrdenesCompraPage.tsx,
  RecepcionPage.tsx, FacturaProveedorPage.tsx, ConfigComprasPage.tsx,
  consultas/*.tsx
```

---

### Task 1: Cálculos de compra en `shared`

**Files:**
- Create: `packages/shared/src/compras/{calculos.ts,letras.ts,asiento-pesos.ts}`, export desde `index.ts`
- Modify: `packages/shared/package.json` (dependencia `decimal.js@10`)
- Test: `packages/shared/src/compras/{calculos,letras,asiento-pesos}.test.ts`

**Interfaces:**
- Produces:
  - `type Letra = 'A' | 'B' | 'C' | 'M'`.
  - `importeRenglon(r: { cantidad: string | number; precioUnitario: string | number; bonificacionPct?: string | number }): string`. Calcula cantidad × precio × (1 − bonif/100) y redondea a 2 decimales con `ROUND_HALF_UP`. Lanza `Error('Cantidad inválida')` si cantidad ≤ 0, `'Precio inválido'` si precio < 0 y `'Bonificación inválida'` si la bonificación no está entre 0 y 100.
  - `calcularTotales(e: { discriminaIva: boolean; renglones: { importe: string; alicuotaIva: string | number }[]; percepcionIva?: string; percepcionesIibb?: string[]; impuestosInternos?: string; noGravado?: string; exento?: string })`. Devuelve `{ netoGravado: string; iva: string; ivaPorAlicuota: { alicuota: string; base: string; importe: string }[]; percepciones: string; total: string }`.
    - IVA redondeado por alícuota.
    - Si `discriminaIva` es false, el IVA es 0 y `ivaPorAlicuota` queda vacío.
    - `ivaPorAlicuota` se ordena por alícuota.
  - `letrasValidas(empresa: CondicionIva, proveedor: CondicionIva): Letra[]`, según la tabla de la spec §5. Las combinaciones sin fila en la tabla devuelven `[]`.
  - `discriminaIva(letra: Letra | null): boolean`: true solo para A y M.
  - `lineasEnPesos(lineas: { clave: string; lado: 'DEBE' | 'HABER'; importe: string }[], cotizacion: string): { clave: string; lado: 'DEBE' | 'HABER'; importe: string }[]`. Convierte cada importe y redondea. Si debe ≠ haber, ajusta la diferencia en la línea de mayor importe del lado de menor suma, de modo que el total de cada lado sea `round(Σ original × cotización)`.

- [ ] **Step 1: Tests que fallan**

```ts
// calculos.test.ts
it('importe con bonificación', () => expect(importeRenglon({ cantidad: 3, precioUnitario: '100.005', bonificacionPct: 10 })).toBe('270.01'));
it('rechaza cantidad 0, precio negativo, bonificación 101', () => {
  expect(() => importeRenglon({ cantidad: 0, precioUnitario: 1 })).toThrow('Cantidad inválida');
  expect(() => importeRenglon({ cantidad: 1, precioUnitario: -1 })).toThrow('Precio inválido');
  expect(() => importeRenglon({ cantidad: 1, precioUnitario: 1, bonificacionPct: 101 })).toThrow('Bonificación inválida');
});
it('totales factura A con dos alícuotas y percepciones', () => {
  const t = calcularTotales({ discriminaIva: true,
    renglones: [{ importe: '1000.00', alicuotaIva: 21 }, { importe: '500.00', alicuotaIva: 10.5 }, { importe: '333.33', alicuotaIva: 21 }],
    percepcionIva: '30.00', percepcionesIibb: ['15.50', '4.50'], impuestosInternos: '0', noGravado: '10', exento: '0' });
  expect(t.ivaPorAlicuota).toEqual([{ alicuota: '10.5', base: '500.00', importe: '52.50' }, { alicuota: '21', base: '1333.33', importe: '280.00' }]);
  expect(t).toMatchObject({ netoGravado: '1833.33', iva: '332.50', percepciones: '50.00', total: '2225.83' });
});
it('factura C no discrimina IVA', () => {
  const t = calcularTotales({ discriminaIva: false, renglones: [{ importe: '1210.00', alicuotaIva: 21 }] });
  expect(t).toMatchObject({ iva: '0.00', total: '1210.00', ivaPorAlicuota: [] });
});
// letras.test.ts
it.each([
  ['RESPONSABLE_INSCRIPTO', 'RESPONSABLE_INSCRIPTO', ['A', 'M']],
  ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', ['C']],
  ['RESPONSABLE_INSCRIPTO', 'EXENTO', ['B', 'C']],
  ['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO', ['B']],
  ['EXENTO', 'MONOTRIBUTO', ['C']],
])('%s recibe de %s: %j', (e, p, l) => expect(letrasValidas(e as CondicionIva, p as CondicionIva)).toEqual(l));
// asiento-pesos.test.ts
it('USD con redondeo queda balanceado', () => {
  const r = lineasEnPesos([
    { clave: 'gasto', lado: 'DEBE', importe: '100.33' }, { clave: 'iva', lado: 'DEBE', importe: '21.07' },
    { clave: 'prov', lado: 'HABER', importe: '121.40' }], '1450.333');
  const suma = (l: string) => r.filter((x) => x.lado === l).reduce((a, x) => a + Math.round(Number(x.importe) * 100), 0);
  expect(suma('DEBE')).toBe(suma('HABER'));
  expect(r.find((x) => x.clave === 'prov')!.importe).toBe('176070.43');
});
```

- [ ] **Step 2:** `pnpm --filter @gestion/shared test` → FAIL (módulos inexistentes).
- [ ] **Step 3: Implementar** con `Decimal` de `decimal.js` (`Decimal.set({ rounding: Decimal.ROUND_HALF_UP })` dentro del módulo; usar `toDecimalPlaces(2)` y devolver `toFixed(2)`). La alícuota se serializa como string sin ceros sobrantes (`'21'`, `'10.5'`).
- [ ] **Step 4:** `pnpm --filter @gestion/shared test` → PASS.
- [ ] **Step 5: Commit** `feat(shared): cálculos de comprobantes de compra`

---

### Task 2: Configuración de compras y cuentas por concepto

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (campos en `Empresa`, enum `ModoTresVias`, modelo `ConfigCuenta`); migración con datos (crea `ConfigCuenta` y agrega permisos nuevos al rol Administrador de las empresas existentes); `modelos-empresa.ts`; `packages/shared/src/permisos.ts`; `EmpresasService.crear` y `src/seed/demo.ts` (precargan `ConfigCuenta`)
- Create: `apps/api/src/compras/config/{config-compras.module.ts,config-compras.service.ts,config-compras.controller.ts}`, `apps/api/src/compras/config/conceptos.ts`
- Test: `apps/api/test/compras-config.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `Empresa` + `montoAprobacionOc Decimal(18,2) @default(0)`, `toleranciaPrecioPct Decimal(18,6) @default(2)`, `toleranciaCantidadPct Decimal(18,6) @default(0)`, `modoTresVias ModoTresVias @default(AVISAR)`.
  - `ConfigCuenta { id, empresaId, concepto String, cuentaContableId }`, único por `empresaId + concepto`.
  - `CONCEPTOS_CUENTA = { PROVEEDORES: '2.1.01.001', IVA_CREDITO_FISCAL: '1.1.03.001', PERCEPCION_IVA: '1.1.03.002', PERCEPCION_IIBB: '1.1.03.003', IMPUESTOS_INTERNOS: '5.2.01', GASTO_POR_DEFECTO: '5.2.01' } as const` y `type ConceptoCuenta = keyof typeof CONCEPTOS_CUENTA`.
  - `cargarConfigCuentas(tx: Prisma.TransactionClient, empresaId: string): Promise<void>`: busca cada cuenta por código; si no existe, no crea ese concepto.
  - `ConfigComprasService.cuenta(tx: TxEmpresa, concepto: ConceptoCuenta): Promise<string>`: devuelve el `cuentaContableId`. Si falta, responde 400 "Falta configurar la cuenta contable para <concepto>".
  - `ConfigComprasService.parametros(tx): Promise<{ montoAprobacionOc: Decimal; toleranciaPrecioPct: Decimal; toleranciaCantidadPct: Decimal; modoTresVias: 'AVISAR' | 'BLOQUEAR' }>`.
  - REST, todo con `compras.config`:
    - `GET /api/compras/config` → parámetros + `cuentas: { concepto, cuentaContableId }[]`.
    - `PATCH /api/compras/config` → parámetros. Montos y tolerancias ≥ 0.
    - `PUT /api/compras/config/cuentas` → `{ concepto, cuentaContableId }[]`. Las cuentas deben ser imputables (`verificarImputable`).

- [ ] **Step 1: Tests que fallan:**
  - Una empresa creada por `POST /api/empresas` tiene los 6 conceptos configurados y `GET /compras/config` los devuelve con `modoTresVias: 'AVISAR'`.
  - `PATCH` con `montoAprobacionOc: 500000` lo persiste.
  - `PUT /cuentas` con una cuenta no imputable → 400.
  - Sin `compras.config` → 403.
  - El rol Administrador de una empresa nueva incluye `oc.anular`.
- [ ] **Step 2:** `pnpm --filter @gestion/api test -- compras-config` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS; además `pnpm --filter @gestion/api test` completo en verde.
- [ ] **Step 5: Commit** `feat(api): configuración de compras y cuentas contables por concepto`

---

### Task 3: Motor de asientos

**Files:**
- Modify: `schema.prisma` (`Asiento`, `AsientoRenglon`), `modelos-empresa.ts`
- Create: `apps/api/src/contabilidad/asientos/{asientos.module.ts,asientos.service.ts}` (módulo global)
- Test: `apps/api/src/contabilidad/asientos/asientos.spec.ts` (contra la DB de test, con contexto CLS como en `numeracion.spec.ts`)

**Interfaces:**
- Produces:
  - `Asiento { id, empresaId, numero Int, fecha Date, descripcion, origenTipo String, origenId String, anulaAId String?, creadoPor String, creadoEn }` y `AsientoRenglon { id, empresaId, asientoId, cuentaContableId, centroCostoId?, debe Decimal(18,2), haber Decimal(18,2), detalle? }`.
  - `type RenglonAsiento = { cuentaContableId: string; centroCostoId?: string | null; debe?: string; haber?: string; detalle?: string }`.
  - `AsientosService.generar(tx: TxEmpresa, a: { fecha: Date; descripcion: string; origenTipo: string; origenId: string; renglones: RenglonAsiento[] }): Promise<{ id: string; numero: number }>`:
    - Agrupa por `cuentaContableId + centroCostoId`, neteando debe y haber dentro de cada grupo.
    - Descarta los renglones en 0.
    - Valida que la cuenta exista, sea imputable y esté activa: si no, 400 "La cuenta contable X no es imputable o está inactiva".
    - Si Σdebe ≠ Σhaber, 400 "El asiento no balancea (debe X, haber Y)".
    - Si no quedan renglones, 400.
  - `AsientosService.contraasiento(tx, asientoId: string, fecha: Date, descripcion: string): Promise<{ id: string; numero: number }>`: invierte debe y haber y setea `anulaAId`.

- [ ] **Step 1: Tests que fallan:**
  - Un asiento balanceado se crea con número 1 y con los renglones agrupados: dos renglones de la misma cuenta suman en uno.
  - Desbalanceado → error con "no balancea" y no deja filas.
  - Una cuenta no imputable → error.
  - El contraasiento invierte los importes y apunta al original.
  - Desde otra empresa no se ve el asiento.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(api): motor de asientos contables`

---

### Task 4: Orden de compra (API)

**Files:**
- Modify: `schema.prisma` (`OrdenCompra`, `OrdenCompraRenglon`, enum `EstadoOC`), `modelos-empresa.ts`
- Create: `apps/api/src/compras/compras.module.ts`, `apps/api/src/compras/ordenes/{ordenes.service.ts,ordenes.controller.ts,dto.ts}`
- Modify: `app.module.ts`
- Test: `apps/api/test/compras-oc.e2e-spec.ts`; helper `datosCompras(prisma, empresaId)` en `test/helpers.ts`, que crea un proveedor RI, un artículo al 21 % y una cotización USD de 1000 a la fecha `2026-11-01` y devuelve sus ids.

**Interfaces:**
- Consumes: `calcularTotales`, `importeRenglon` (Task 1); `ConfigComprasService.parametros` (Task 2); `MonedasService.cotizacion`; `NumeracionService.siguiente`; `AuditoriaService.registrar`.
- Produces:
  - Modelos según spec §3. Agregan `empresaId` en los renglones, `version Int @default(0)` y `numero Int?` (null en borrador).
  - Body de alta y modificación de borrador (`esquemaOC`):

    ```
    { terceroId, fecha 'YYYY-MM-DD', fechaEntrega?, depositoId?, monedaCodigo 'ARS'|'USD', diasPago?, observaciones?,
      renglones: [{ articuloId?, descripcion, cantidad > 0, precioUnitario >= 0, bonificacionPct 0..100 = 0,
                    alicuotaIva ∈ ALICUOTAS_IVA, centroCostoId? }] (min 1, 'La orden debe tener al menos un renglón') }
    ```

  - REST:
    - `GET /api/compras/ordenes?terceroId&estado&desde&hasta&pagina&porPagina` (`oc.ver`) → `{ items, total }`; cada item incluye `tercero.razonSocial`.
    - `GET /api/compras/ordenes/:id` (`oc.ver`) → OC con renglones (incluye `pendiente = cantidad − cantidadRecibida`), `recepciones` y `comprobantes` vinculados.
    - `POST /api/compras/ordenes` (`oc.crear`) → borrador.
    - `PATCH /api/compras/ordenes/:id` (`oc.crear`, solo en `BORRADOR`; reemplaza los renglones).
    - `DELETE /api/compras/ordenes/:id` (`oc.crear`, solo en `BORRADOR`).
    - `POST /:id/confirmar { version }` (`oc.crear`).
    - `POST /:id/aprobar { version }` (`oc.aprobar`).
    - `POST /:id/rechazar { version, motivo }` (`oc.aprobar`).
    - `POST /:id/anular { version, motivo }` (`oc.anular`).
    - `POST /:id/cerrar { version, motivo? }` (`oc.aprobar`).
    - Todas las transiciones devuelven la OC actualizada.
  - El tercero debe ser proveedor y estar activo: si no, 400 "El tercero no es un proveedor activo".
  - `OrdenesService.recalcularEstado(tx, ordenCompraId: string): Promise<void>`:
    - Si está `APROBADA` o `PARCIALMENTE_RECIBIDA` y todos los renglones tienen recibido ≥ pedido → `CUMPLIDA`.
    - Si alguno tiene recibido > 0 → `PARCIALMENTE_RECIBIDA`.
    - Si ninguno → `APROBADA`.
    - La usa la Task 5.
  - Transición con bloqueo optimista: `updateMany({ where: { id, version, estado: <esperado> }, data: { ..., version: { increment: 1 } } })`. Con count 0: si el registro existe, 409 "El comprobante fue modificado por otro usuario"; si no, 404.

- [ ] **Step 1: Tests que fallan:**
  - Alta de borrador: totales correctos (2 × 1000 al 21 % → neto 2000.00, IVA 420.00, total 2420.00) y `numero: null`.
  - Sin renglones → 400 "La orden debe tener al menos un renglón". Cantidad 0 → 400 con `campos['renglones.0.cantidad']`.
  - Confirmar con monto límite 0 → `PENDIENTE_APROBACION` y numero 1. Con límite 1.000.000 y total 2.420 → `APROBADA`, `aprobadoPor` null y auditoría `APROBAR` con `datos.automatica = true`.
  - OC en USD: `totalPesos = total × 1000`. En USD con fecha sin cotización → 400 "No hay cotización de USD para el …".
  - El creador no puede aprobar (403 "No puede aprobar una orden creada por usted") cuando existe otro usuario activo con `oc.aprobar`. Puede autoaprobar si es el único (auditoría con `datos.autoaprobacion = true`).
  - Rechazar sin motivo → 400; con motivo → `BORRADOR`.
  - **Concurrencia:** dos `aprobar` simultáneos con la misma `version` → uno 200 y otro 409.
  - Anular un borrador → 400 (los borradores se borran); anular una aprobada sin recepciones → `ANULADA`.
  - Desde otra empresa, `GET /:id` → 404.
  - `PATCH` sobre una OC confirmada → 400 "Solo se pueden modificar órdenes en borrador".
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar.** Para "otro usuario con `oc.aprobar`", contar en la transacción los `UsuarioEmpresa` activos de la empresa con un rol que incluya `oc.aprobar` (`rol: { permisos: { has: 'oc.aprobar' } }`) y un usuario activo distinto del actual; los superadmin cuentan.
- [ ] **Step 4:** → PASS; suite completa en verde.
- [ ] **Step 5: Commit** `feat(api): órdenes de compra con aprobación por monto`

---

### Task 5: Informe de recepción (API)

**Files:**
- Modify: `schema.prisma` (`InformeRecepcion`, `InformeRecepcionRenglon`), `modelos-empresa.ts`
- Create: `apps/api/src/compras/recepciones/{recepciones.service.ts,recepciones.controller.ts,dto.ts}`
- Test: `apps/api/test/compras-ir.e2e-spec.ts`

**Interfaces:**
- Consumes: `OrdenesService.recalcularEstado` (Task 4).
- Produces:
  - `remitoNumero` normalizado `NNNNN-NNNNNNNN`: acepta `1-1234` o `0001-00001234` y lo guarda con padding a 5-8. `normalizarNumeroComprobante(s: string): string | null` va en `packages/shared/src/compras/numero.ts`, con test.
  - `GET /api/compras/ordenes/pendientes-recibir?terceroId` (`ir.crear`) → `[{ ordenCompraRenglonId, ordenCompraId, ocNumero, fechaEntrega, articuloId, descripcion, cantidad, recibido, pendiente }]`, solo de OC `APROBADA` o `PARCIALMENTE_RECIBIDA`.
  - `POST /api/compras/recepciones` (`ir.crear`) con `{ terceroId, fecha, depositoId?, remitoNumero, observaciones?, renglones: [{ ordenCompraRenglonId, cantidad > 0 }] (min 1) }`. Devuelve el IR con número.
  - `GET /api/compras/recepciones?terceroId&desde&hasta&pagina` y `GET /:id` (`ir.ver`).
  - `POST /api/compras/recepciones/:id/anular { motivo }` (`ir.anular`).
  - `GET /api/compras/recepciones/pendientes-facturar?terceroId` (`fc.crear`) → `[{ informeRecepcionRenglonId, irNumero, remitoNumero, ordenCompraRenglonId, ocNumero, articuloId, descripcion, precioUnitario, bonificacionPct, alicuotaIva, centroCostoId, recibido, facturado, pendiente }]`.
  - Bloqueo: antes de validar los pendientes, `tx.$queryRaw` `SELECT id FROM "OrdenCompraRenglon" WHERE id = ANY(${ids}::uuid[]) AND "empresaId" = ${empresaId}::uuid FOR UPDATE`.

- [ ] **Step 1: Tests que fallan:**
  - Una OC de 10 unidades recibe 4 → `PARCIALMENTE_RECIBIDA` y pendiente 6; recibe 6 → `CUMPLIDA`.
  - Recibir 7 con pendiente 6 → 400 "La cantidad recibida (7) supera lo pendiente (6)".
  - Mismo remito y mismo proveedor dos veces → 409 "Ese remito ya fue registrado"; `1-1234` y `00001-00001234` se consideran iguales.
  - Renglón de una OC de otro proveedor → 400 "Todos los renglones deben ser del proveedor indicado"; de otra empresa → 404.
  - OC en `BORRADOR` o `PENDIENTE_APROBACION` → 400 "La orden de compra no está aprobada".
  - Anular el IR devuelve la OC a `APROBADA` con pendiente 10.
  - **Concurrencia:** dos recepciones simultáneas de 6 sobre un pendiente de 10 → una 201 y otra 400; el recibido total queda en 6.
  - `normalizarNumeroComprobante('1-1234') === '00001-00001234'`; `normalizarNumeroComprobante('abc') === null`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS; suite en verde.
- [ ] **Step 5: Commit** `feat(api): informes de recepción`

---

### Task 6: Factura de proveedor: confirmación (API)

**Files:**
- Modify: `schema.prisma` (`ComprobanteCompra`, `ComprobanteCompraRenglon`, `ComprobanteCompraIva`, `ComprobanteCompraPercepcionIibb`, `MovimientoCuentaCorriente`, enums), `modelos-empresa.ts`
- Create: `apps/api/src/compras/comprobantes/{comprobantes.service.ts,comprobantes.controller.ts,dto.ts,tres-vias.ts}`
- Test: `apps/api/test/compras-fc.e2e-spec.ts`; `apps/api/src/compras/comprobantes/tres-vias.spec.ts` (puro)

**Interfaces:**
- Consumes: Tasks 1 a 5.
- Produces:
  - Modelos según spec §5. `MovimientoCuentaCorriente { id, empresaId, terceroId, origenTipo, origenId, fecha, fechaVencimiento, monedaCodigo, importe Decimal(18,2), importePesos, saldo, saldoPesos, anulado Bool @default(false) }`.
  - Body (`esquemaComprobante`):

    ```
    { terceroId, tipo 'FACTURA'|'NOTA_DEBITO'|'NOTA_CREDITO'|'TICKET', letra 'A'|'B'|'C'|'M'|null, puntoVenta 1..99999,
      numero 1..99999999, fechaEmision, fechaContable, fechaVencimiento?, monedaCodigo, cotizacion?, totalDeclarado,
      comprobanteAsociadoId?, percepcionIva = 0, impuestosInternos = 0, noGravado = 0, exento = 0,
      percepcionesIibb: [{ jurisdiccion /^9\d\d$/, importe > 0 }] = [], aceptoDiferencias = false,
      renglones (min 1): [{ origen 'RECEPCION'|'ORDEN_COMPRA'|'DIRECTO', informeRecepcionRenglonId?, ordenCompraRenglonId?,
        articuloId?, descripcion, cantidad > 0, precioUnitario >= 0, bonificacionPct = 0, alicuotaIva, cuentaContableId?, centroCostoId? }] }
    ```

    - `RECEPCION` exige `informeRecepcionRenglonId`; `ORDEN_COMPRA` exige `ordenCompraRenglonId`; `DIRECTO` exige `cuentaContableId` (o toma `GASTO_POR_DEFECTO`).
    - En esta entrega, **las notas de crédito y de débito solo admiten renglones `DIRECTO`.**
    - La cuenta del renglón con origen RECEPCION u ORDEN_COMPRA es la `cuentaCompraId` del artículo, o `GASTO_POR_DEFECTO`.
  - `detectarDiferencias(renglones: { indice: number; precioFacturado: string; precioOc: string; cantidadFacturada: string; pendienteFacturar: string }[], tolerancias: { precioPct: string; cantidadPct: string }): { renglon: number; tipo: 'PRECIO' | 'CANTIDAD'; esperado: string; facturado: string; diferenciaPct: string }[]` en `tres-vias.ts` (función pura).
  - `POST /api/compras/comprobantes` (`fc.crear`) → 201 con el comprobante. Respuestas de error:
    - 422 `{ statusCode: 422, message: 'Hay diferencias con la orden de compra', diferencias }` en modo AVISAR sin aceptar.
    - 400 con el mismo mensaje y las `diferencias` en modo BLOQUEAR.
    - 409 "Este comprobante ya fue cargado".
    - 400 "La letra X no corresponde para este proveedor".
    - 400 "El total calculado ($X) no coincide con el total del comprobante ($Y)", con importes formateados `1.234,56`.
  - `GET /api/compras/comprobantes?terceroId&tipo&estado&desde&hasta&pagina` y `GET /:id` (`fc.ver`). El detalle incluye renglones, IVA, percepciones, el asiento con sus renglones y cuentas, y los vínculos a IR y OC.
  - Asiento: `origenTipo: 'COMPRA'`, descripción `"<Tipo> <letra> <pv-numero> - <razón social>"`, fecha = `fechaContable`. Las líneas se arman en moneda original y se convierten con `lineasEnPesos`.
  - Bloqueo `FOR UPDATE` sobre los renglones de IR y OC referenciados, como en la Task 5.

- [ ] **Step 1: Tests que fallan:**
  - `tres-vias.spec`: precio 1.030 contra OC 1.000 con tolerancia 2 → diferencia PRECIO de 3.00 %; con 1.015 no hay diferencia; cantidad 5 contra pendiente 4 con tolerancia 0 → diferencia CANTIDAD.
  - Factura A desde recepción (4 × 1.000, 21 %): total 4.840.
    - La cuenta corriente queda con saldo 4.840.
    - El asiento tiene debe Gastos 4.000 + IVA CF 840 y haber Proveedores 4.840.
    - `cantidadFacturada` = 4 en el renglón del IR y en el de la OC.
  - Factura directa con percepción IIBB 50 y no gravado 10 → el asiento incluye `PERCEPCION_IIBB` 50 y `GASTO_POR_DEFECTO` +10.
  - Precio 1.030 en modo AVISAR → 422 con `diferencias[0].tipo = 'PRECIO'`; reenviada con `aceptoDiferencias: true` → 201 y auditoría con `datos.diferencias`. En modo BLOQUEAR → 400.
  - **(Review Focus 4)** Facturar otra vez el mismo renglón de IR ya facturado completo → 422 con diferencia de CANTIDAD (pendiente 0).
  - El mismo número dos veces → 409.
  - Letra C de un proveedor RI → 400.
  - `totalDeclarado` distinto en 0,06 → 400; en 0,04 → 201.
  - **(Review Focus 5)** Factura en USD (100,33 + IVA 21,07 = 121,40) con cotización 1450,333 → el asiento balancea, `importePesos` = 176070.43 y la cuenta corriente guarda saldo 121,40 USD y saldoPesos 176070.43.
  - **(Review Focus 1)** USD sin cotización para la fecha → 400 con el mensaje de cotización.
  - **(Review Focus 3)** Renglón de IR de otro proveedor → 400.
  - Una NC directa de 1.210 → movimiento con importe −1.210 y asiento invertido (haber IVA CF, debe Proveedores). Una NC con renglón RECEPCION → 400 "Las notas de crédito y débito solo admiten renglones directos".
  - Sin renglones → 400.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS; suite en verde.
- [ ] **Step 5: Commit** `feat(api): carga de facturas de proveedor con control de 3 vías, cuenta corriente y asiento`

---

### Task 7: Anulación de factura de proveedor (API)

**Files:**
- Modify: `apps/api/src/compras/comprobantes/comprobantes.service.ts`, `comprobantes.controller.ts`
- Test: `apps/api/test/compras-fc-anulacion.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /api/compras/comprobantes/:id/anular { motivo }` (`fc.anular`). Al anular:
  - Si el movimiento tiene `saldo ≠ importe` → 400 "El comprobante tiene pagos aplicados". En esta entrega no se puede dar, pero el control queda escrito.
  - Contraasiento con fecha de hoy. Guarda `asientoAnulacionId`.
  - Pone el movimiento con `anulado = true`, `saldo = 0` y `saldoPesos = 0`.
  - Resta las cantidades facturadas de los renglones de IR y OC.
  - Estado `ANULADO` y auditoría `ANULAR`.
  - Si ya estaba anulado → 409 "El comprobante ya está anulado".

- [ ] **Step 1: Tests que fallan:**
  - Anular una factura desde recepción → contraasiento con renglones invertidos, saldo 0, `cantidadFacturada` 0 en el IR y la OC, y el IR vuelve a aparecer en `pendientes-facturar`.
  - Anular dos veces → 409.
  - Sin motivo → 400.
  - Sin `fc.anular` → 403.
  - Después de anular, volver a cargar el mismo número → 409 (la unicidad incluye anulados).
  - Anular un IR con renglones facturados → 400 "La recepción tiene renglones facturados"; tras anular la factura, el IR se puede anular. (Cubre la regla de la Task 5 que necesita facturas.)
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS; suite en verde.
- [ ] **Step 5: Commit** `feat(api): anulación de comprobantes de compra`

---

### Task 8: Consultas de compras (API)

**Files:**
- Create: `apps/api/src/compras/consultas/{consultas.service.ts,consultas.controller.ts,libro-iva-xlsx.ts}`
- Modify: `apps/api/package.json` (dependencia `exceljs@4`)
- Test: `apps/api/test/compras-consultas.e2e-spec.ts`

**Interfaces:**
- Produces (todos con `fc.ver`, salvo donde se indica):
  - `GET /api/compras/cuenta-corriente/:terceroId?desde&hasta` → `{ tercero, movimientos: [{ fecha, fechaVencimiento, comprobante: string, monedaCodigo, importe, importePesos, saldo, saldoPesos, acumuladoPesos }], saldos: { ARS: string, USD: string, pesos: string } }`. Excluye los anulados y ordena por fecha.
  - `GET /api/compras/antiguedad-deuda?fecha=YYYY-MM-DD` → `[{ terceroId, razonSocial, porVencer, d0a30, d31a60, d61a90, mas90, total }]`, en pesos según `saldoPesos`. Los días se cuentan como fecha − fechaVencimiento: ≤ 0 es por vencer; 1–30 es d0a30. Solo filas con total ≠ 0, ordenadas por total descendente.
  - `GET /api/compras/libro-iva?desde&hasta` → `{ filas: [{ fechaContable, tipo, letra, numero: '00001-00001234', razonSocial, cuit, netoPorAlicuota: Record<string,string>, ivaPorAlicuota: Record<string,string>, percepcionIva, percepcionesIibb, impuestosInternos, noGravado, exento, total }], totales }`.
    - Importes en pesos (× cotización, redondeados por campo).
    - Las NC en negativo. Excluye los anulados.
    - Con `&formato=xlsx` devuelve el archivo `libro-iva-compras-<desde>-<hasta>.xlsx`, con encabezados en castellano y una fila de totales.
  - `GET /api/compras/buscador?q&desde&hasta` (requiere al menos uno de `oc.ver`, `ir.ver`, `fc.ver`; con `@RequiereAlguno`) → `[{ tipo: 'OC'|'IR'|'FC', id, numero, fecha, razonSocial, estado, total? }]`, máximo 100, por fecha descendente.
    - `q` busca en razón social, CUIT, número de OC o IR, remito, o número de comprobante (`pv-numero` o solo número).
    - Incluye anulados. Cada tabla se consulta por `TenantPrisma` y se une en memoria.
- `fecha`, `desde` y `hasta` se validan con zod (`YYYY-MM-DD`). Inválidas → 400 "Fecha inválida".

- [ ] **Step 1: Tests que fallan:**
  - La cuenta corriente con factura de 4.840 y NC de −1.210 → saldo en pesos 3630.00 y `acumuladoPesos` progresivo.
  - Antigüedad con factura vencida hace 45 días → el importe cae en `d31a60`.
  - El Libro IVA de un período con factura A (21 % y 10,5 %) y NC → totales por alícuota correctos, y la NC resta.
  - `formato=xlsx` responde con content-type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` y el archivo se abre con exceljs y tiene la fila de totales.
  - El buscador encuentra la OC por número y la factura por `00001-00001234`.
  - Fecha `abc` → 400.
  - Otra empresa no ve nada.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS; suite en verde.
- [ ] **Step 5: Commit** `feat(api): consultas de compras y Libro IVA Compras`

---

### Task 9: Web: grilla de renglones, orden de compra, aprobación, PDF y configuración

**Files:**
- Create: `apps/api/src/compras/ordenes/oc-pdf.ts` + endpoint `GET /api/compras/ordenes/:id/pdf` (`oc.ver`; dependencia `pdfkit@0.15` + `@types/pdfkit`)
- Create: `apps/web/src/compras/{GrillaRenglones.tsx,OrdenCompraPage.tsx,OrdenesCompraPage.tsx,DetalleOrdenCompra.tsx,AprobacionOcPage.tsx,ConfigComprasPage.tsx,formato.ts}`
- Modify: `apps/web/src/layout/menu.ts`, `apps/web/src/paginas/rutas.tsx`, `apps/web/src/api/cliente.ts` (agregar `descargar(ruta, query, nombreArchivo)` para PDF y xlsx)
- Test: `apps/web/src/compras/GrillaRenglones.test.tsx`, `apps/web/src/compras/formato.test.ts`, `apps/api/test/compras-oc-pdf.e2e-spec.ts`

**Interfaces:**
- Consumes: endpoints de las Tasks 2 y 4; `calcularTotales`, `importeRenglon` y `discriminaIva` (Task 1).
- Produces:
  - `formatoMoneda(importe: string | number, moneda = 'ARS'): string` → `'$ 1.234,56'` o `'US$ 1.234,56'`; `formatoFecha('2026-11-05') → '05/11/2026'`; `formatoNumero(pv, n)` → `'00001-00001234'`.
  - `type RenglonEditable = { articuloId?: string | null; descripcion: string; cantidad: string; precioUnitario: string; bonificacionPct: string; alicuotaIva: string; centroCostoId?: string | null; cuentaContableId?: string | null; soloLectura?: ('cantidad' | 'precioUnitario' | 'articuloId')[]; origen?: unknown }`.
  - `<GrillaRenglones renglones onChange discriminaIva articulos centrosCosto cuentas? mostrarCuenta? />`:
    - Elegir un artículo completa la descripción y la alícuota.
    - Muestra el importe por renglón y un pie con neto, IVA por alícuota y total, usando las funciones de shared.
    - Los renglones con valores inválidos muestran el importe "—" y no rompen el render.
  - Páginas:
    - **Registraciones › Compras › Orden de compra** (`/compras/oc/nueva` y `/compras/oc/:id`): proveedor, fechas, moneda, depósito, grilla y los botones Guardar borrador, Confirmar y Eliminar borrador. Si la API devuelve 409, avisa y recarga.
    - **Registraciones › Compras › Aprobación de OC** (`/compras/oc/aprobacion`, `oc.aprobar`): lista de pendientes, detalle y los botones Aprobar y Rechazar (con motivo).
    - **Consultas › Compras › Órdenes de compra** (`/compras/oc`, `oc.ver`): filtros, tabla y detalle con pedido, recibido, facturado y pendiente; botones Anular, Cerrar y Descargar PDF según el permiso y el estado.
    - **Administración › Configuración de compras** (`/admin/compras`, `compras.config`): `FormAbm` de parámetros más la tabla de conceptos con selector de cuenta imputable.
  - Menú: "Compras y Cuentas a Pagar" deja de ser "Próximamente" en Registraciones y en Consultas. Cada hoja usa su permiso, y las hojas de las Tasks 10 y 11 se agregan en esas tasks.
  - PDF: encabezado con razón social y CUIT de la empresa, "ORDEN DE COMPRA N° 0001-00000001", proveedor y CUIT, fechas, tabla de renglones, totales y observaciones. Una OC en borrador → 400 "La orden no está confirmada".

- [ ] **Step 1: Tests que fallan:**
  - `formato.test`: `formatoMoneda('1234.5') === '$ 1.234,50'`; `formatoMoneda('10', 'USD') === 'US$ 10,00'`.
  - `GrillaRenglones.test`:
    - Con dos renglones (2 × 1000 al 21 % y 1 × 500 al 10,5 %) y `discriminaIva`, el pie muestra "$ 2.972,50".
    - Al editar la cantidad del primero a 3, `onChange` recibe la cantidad `'3'`.
    - Con cantidad `'abc'` muestra "—" sin lanzar error.
  - `compras-oc-pdf.e2e`: `GET /pdf` de una OC confirmada → 200, `application/pdf` y el body empieza con `%PDF`; de un borrador → 400.
  - `menu.test` (actualizar): con `oc.crear`, Registraciones › Compras incluye "Orden de compra".
- [ ] **Step 2:** `pnpm --filter @gestion/web test` y `pnpm --filter @gestion/api test -- compras-oc-pdf` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS; `pnpm --filter @gestion/web build` sin errores; suite completa en verde.
- [ ] **Step 5: Commit** `feat(web): órdenes de compra, aprobación, PDF y configuración de compras`

---

### Task 10: Web: informe de recepción y factura de proveedor

**Files:**
- Create: `apps/web/src/compras/{RecepcionPage.tsx,FacturaProveedorPage.tsx,DiferenciasModal.tsx,SelectorPendientes.tsx}`
- Modify: `menu.ts`, `rutas.tsx`
- Test: `apps/web/src/compras/FacturaProveedorPage.test.tsx`

**Interfaces:**
- Consumes: endpoints de las Tasks 5 y 6; `GrillaRenglones` y `formatoMoneda` (Task 9).
- Produces:
  - **Registraciones › Compras › Informe de recepción** (`/compras/recepcion`, `ir.crear`):
    - Proveedor, fecha, depósito y remito.
    - `SelectorPendientes` lista `pendientes-recibir` con checkbox y cantidad editable (por defecto, el pendiente).
    - Botón Confirmar. Si sale bien, muestra el número y limpia el formulario.
  - **Registraciones › Compras › Factura de proveedor** (`/compras/factura`, `fc.crear`):
    - Proveedor (al elegirlo, la letra se limita a `letrasValidas`).
    - Tipo, letra, punto de venta y número, fechas (fecha contable igual a la de emisión por defecto), moneda y cotización.
    - Botón "Agregar desde recepciones": abre `SelectorPendientes` con `pendientes-facturar`. Los renglones agregados tienen cantidad y precio editables y artículo de solo lectura.
    - Botón "Agregar desde OC" (pendientes de la OC) y renglones directos con cuenta contable.
    - Sección de percepciones e impuestos y el campo "Total del comprobante".
    - Muestra en vivo "Diferencia con el total calculado".
    - Al recibir 422, abre `DiferenciasModal` con la tabla de diferencias y los botones "Aceptar diferencias y guardar" (reenvía con `aceptoDiferencias: true`) y "Volver".
- [ ] **Step 1: Test que falla** (`FacturaProveedorPage.test`, con `fetch` simulado):
  - El submit recibe 422 con una diferencia de precio → se muestra el modal con "PRECIO" y "3,00 %".
  - Al hacer clic en "Aceptar diferencias y guardar", el segundo `fetch` lleva `aceptoDiferencias: true` en el body.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS; `build` sin errores.
- [ ] **Step 5: Commit** `feat(web): informe de recepción y carga de facturas de proveedor`

---

### Task 11: Web: consultas de compras

**Files:**
- Create: `apps/web/src/compras/consultas/{RecepcionesPage.tsx,ComprobantesCompraPage.tsx,DetalleComprobante.tsx,CuentaCorrientePage.tsx,AntiguedadDeudaPage.tsx,LibroIvaComprasPage.tsx,BuscadorComprobantesPage.tsx,PendientesPage.tsx}`
- Modify: `menu.ts`, `rutas.tsx`
- Test: `apps/web/src/compras/consultas/CuentaCorrientePage.test.tsx`

**Interfaces:**
- Consumes: endpoints de las Tasks 5 a 8.
- Produces: rama **Consultas › Compras y Cuentas a Pagar** con:
  - Órdenes de compra (Task 9) y Recepciones (`ir.ver`).
  - Comprobantes de compra (`fc.ver`, con anulación por `fc.anular`).
  - Cuenta corriente de proveedores y Antigüedad de deuda (`fc.ver`).
  - Libro IVA Compras (`fc.ver`, con botón "Exportar a Excel" que usa `descargar`).
  - Buscador de comprobantes y Pendientes (OC pendientes de recibir y recepciones pendientes de facturar).
  - `DetalleComprobante` muestra los renglones, el IVA y las percepciones, el asiento (cuenta, debe, haber) y los vínculos a IR y OC.
- [ ] **Step 1: Test que falla:** `CuentaCorrientePage` con una respuesta simulada de dos movimientos muestra el saldo "$ 3.630,00" y el acumulado por fila.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** → PASS; `build` sin errores; `menu.test` verifica que cada hoja de compras con ruta tenga su página (el test existente de rutas ya lo cubre).
- [ ] **Step 5: Commit** `feat(web): consultas de compras`

---

### Task 12: Seed demo, e2e y README

**Files:**
- Modify: `apps/api/src/seed/demo.ts` (agrega el usuario `aprobador@demo.com` / `aprobador1234` con un rol "Aprobador" con `oc.ver` y `oc.aprobar`; configura monto límite 1.000.000; crea comprobantes de ejemplo **llamando a los servicios** de las Tasks 4 a 6 dentro de un contexto CLS de la empresa demo), `apps/api/test/seed.e2e-spec.ts`, `README.md`
- Create: `e2e/compras.spec.ts`

**Interfaces:**
- Produces:
  - Datos demo:
    - una OC en borrador, una pendiente de aprobación, una aprobada, una parcialmente recibida y una cumplida;
    - dos recepciones;
    - una factura A en ARS desde recepción, una factura en USD directa y una NC.
  - Si la empresa demo ya existe, el seed no hace nada.
- [ ] **Step 1: Tests que fallan:**
  - `seed.e2e-spec`: después de sembrar, hay 5 OC con los 5 estados distintos, 3 comprobantes de compra y todos los asientos balancean (Σdebe = Σhaber por asiento).
  - `e2e/compras.spec.ts`:
    1. `admin@demo.com` crea una OC de 1 proveedor y 1 artículo por un total mayor a 1.000.000 → queda "Pendiente de aprobación".
    2. Se loguea `aprobador@demo.com`, aprueba y cierra sesión.
    3. `admin` recibe todo, carga la factura A desde la recepción con el total exacto y un número único.
    4. En Cuenta corriente de proveedores, ese proveedor muestra el saldo esperado.
- [ ] **Step 2:** `pnpm --filter @gestion/api test -- seed` y `pnpm e2e` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `pnpm test` y `pnpm e2e` → todo en verde.
- [ ] **Step 5: README:** sección "Circuito de compras" (qué hace, usuarios demo, configuración de compras) y reglas nuevas: asientos vía `AsientosService` y bloqueo optimista con `version`.
- [ ] **Step 6: Commit** `feat: datos demo y prueba de punta a punta del circuito de compras`

---

## Cobertura de la spec

| Spec | Task |
|---|---|
| §0 Aprobación un nivel, USD, asientos | 2, 4, 6 |
| §1 Configuración y ConfigCuenta, permisos | 2 |
| §2 Motor de asientos, redondeo | 1, 3 |
| §3 Orden de compra (estados, aprobación, versión, PDF) | 4, 9 |
| §4 Informe de recepción | 5 (anulación con facturas: 7) |
| §5 Factura: letra, cálculos, total declarado, 3 vías, cuenta corriente, asiento | 1, 6 |
| §5 Anulación | 7 |
| §6 Consultas | 8, 11 |
| §7 Web | 9, 10, 11 |
| §8 Errores y concurrencia | 4, 5, 6 |
| §9 Pruebas y seed | todas, 12 |

**Decisiones del plan que la spec no fijaba:**
- Se agrega el permiso `ir.anular`, que la spec no listaba.
- Las notas de crédito y de débito solo admiten renglones directos en esta entrega.
- La aprobación automática se audita como `APROBAR` con `datos.automatica = true`, y `aprobadoPor` queda null.
- Los renglones de comprobantes también llevan `empresaId`.
