# Entrega 50 — Factura de crédito electrónica MiPyME Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Emitir FCE MiPyME por WSFEv1, consultar obligación y estados en el registro (`wsfecred`), y aceptar o rechazar las FCE recibidas.

**Architecture:** Marca `fce` en comprobantes de venta y compra (numeración y códigos 201…213 propios); un cliente nuevo `ClienteFce` (real por SOAP con su ticket WSAA `wsfecred`, y simulado) detrás de `ConfigArcaService.clienteFce()`; módulo `ventas/fce` con la obligación del cliente, el registro `FceRegistro` (emitidas y recibidas) y sus pantallas.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest/supertest; React 19 + Mantine 7 + Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-entrega-50-fce-mipyme-design.md`

## Global Constraints
- Mensajes exactos de la spec (se repiten en cada tarea).
- Enums y valores nuevos de enum en su propia migración; desplegar en gestion, gestion_test y gestion_mig.
- Pruebas con el ARCA simulado; nada llama a ARCA real en las pruebas (los XML reales se prueban con fixtures en pruebas unitarias).
- Un solo jest a la vez; nunca en paralelo con la e2e.

## Review Focus
1. Factura común a un cliente no obligado (o empresa no MiPyME): emite exactamente como antes (mismo código, misma numeración, sin consultar `wsfecred` si la empresa no es MiPyME).
2. FCE en dólares: el mínimo se compara con el total en pesos.
3. Numeración: una FCE A y una factura A del mismo punto de venta numeran por separado y el reintento de CAE (consultar/último autorizado) usa el código FCE.
4. Compras existentes sin marca: siguen únicas y en el Libro IVA con 1…13.
5. ARCA sin respuesta al consultar obligación con consulta previa de otro ambiente: no se usa (cae a la marca manual).

---

### Task 1: FCE en la emisión (WSFEv1, numeración, PDF, Libro IVA ventas)
**Files:**
- `packages/shared/src/ventas/codigos-arca.ts`: `cbteTipo(tipo, letra, fce = false)` → +200 con `fce`.
- `prisma/schema.prisma` + migración: `ComprobanteVenta.fce Boolean @default(false)`, unicidad `[empresaId, ambiente, puntoVenta, tipo, letra, fce, numero]`, `ComprobanteVenta.transferenciaFce String?` (`SCA`/`ADC`), `ComprobanteVenta.anulacionFce Boolean?`; `ConfigArca.mipyme Boolean @default(false)`, `ConfigArca.cuentaBancariaFceId String? @db.Uuid`, `ConfigArca.transferenciaFce String @default("SCA")`.
- `arca/cliente-arca.ts`: `DatosCae.opcionales?: { id: string; valor: string }[]`; `arca/wsfe.ts`: `<ar:Opcionales>` en `xmlSolicitarCae`; `arca/arca-simulado.ts`: los NC/ND 202,203,207,208,212,213 exigen asociado; las FCE 201/206/211 exigen `fchVtoPago` y opcionales 2101 y 27.
- `ventas/comprobantes/dto.ts` y `comprobantes.service.ts`: campos `fce`, `transferenciaFce`, `anulacionFce`; con `fce`, `fechaVencimientoPago = fechaVencimiento`.
- `ventas/emision/emision.service.ts`: `cbteTipo(…, c.fce)` en todos los usos (reserva de número, búsqueda de otras en curso, `ocupado`, asociados); opcionales: factura → `2101` = CBU de la cuenta configurada, `27` = transferencia; nota → `22` = `S`/`N`; `fchVtoPago` siempre en factura FCE.
- `ventas/pdf/pdf-venta.ts`: título «FACTURA DE CRÉDITO ELECTRÓNICA MiPyMEs (FCE)» / «NOTA DE DÉBITO…» / «NOTA DE CRÉDITO…», CBU, transferencia y vencimiento del pago.
- `impuestos/libros-iva/libro-iva-digital.ts`: ventas con `cbteTipo(c.tipo, c.letra, c.fce)`.
- `arca/config-arca.controller.ts`/`.service.ts`: `GET/PUT /api/arca/config` con `mipyme`, `cuentaBancariaFceId`, `transferenciaFce`.
- **Test:** `apps/api/test/fce-emision.e2e-spec.ts`; `packages/shared` test de `cbteTipo`; `arca/wsfe.spec.ts` (opcionales en el XML).

**Interfaces — Produces:** `cbteTipo(tipo, letra, fce?)`; campos de modelo arriba; `DatosCae.opcionales`.

**Validaciones al emitir (mensajes exactos):**
- FCE sin `ConfigArca.mipyme` → 400 `La empresa no está marcada como MiPyME: no puede emitir factura de crédito`.
- FCE sin cuenta con CBU → 400 `Configure la cuenta bancaria (CBU) para la factura de crédito`.
- Nota con `fce` distinto del asociado → 400 `La nota tiene que ser de la misma clase que la factura: factura de crédito MiPyME o común`.
- FCE con vencimiento anterior a la fecha → 400 `La fecha de vencimiento del pago no puede ser anterior a la fecha del comprobante`.

- [ ] Pruebas que fallan: `cbteTipo('FACTURA','A',true) === 201`, `('NOTA_CREDITO','B',true) === 208`, `('NOTA_DEBITO','C',true) === 212`; XML con `<ar:Opcionales><ar:Opcional><ar:Id>2101</ar:Id><ar:Valor>…</ar:Valor>`; e2e: empresa MiPyME con cuenta CBU, FCE A a un RI → autorizada con tipo 201, número 1 aunque ya exista factura A número 1 del mismo punto de venta, el simulado recibió `fchVtoPago` = vencimiento y opcionales 2101/27; NC FCE asociada con anulación S → código 203 y opcional 22=`S`; los cuatro errores de arriba; Libro IVA Digital de ventas con `201`; PDF contiene «FACTURA DE CRÉDITO ELECTRÓNICA» (texto con `pdf-parse` si ya se usa, si no buscar en el buffer sin compresión en test).
- [ ] `npx jest --runInBand test/fce-emision test/ventas-comprobantes src/arca` y vitest de shared → PASS. Commit `feat(ventas): emisión de factura de crédito MiPyME`.

### Task 2: Cliente del registro de FCE (`wsfecred`)
**Files:**
- Create `arca/cliente-fce.ts`:
  ```ts
  export interface ObligacionFce { obligado: boolean; montoMinimo: string | null }
  export type EstadoFce = 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'ACEPTADA_TACITA';
  export interface FceArca { cuitEmisor: string; cuitReceptor: string; cbteTipo: number; ptoVta: number; numero: number; fecha: string; importe: string; moneda: string;
    fechaVencimientoPago: string | null; estado: EstadoFce; fechaRecepcion: string | null; fechaLimite: string | null; motivosRechazo: string[] }
  export interface ClienteFce {
    consultarObligacion(cuit: string, fecha: string): Promise<ObligacionFce>;
    consultarComprobantes(rol: 'EMISOR' | 'RECEPTOR', desde: string, hasta: string): Promise<FceArca[]>;
    aceptar(f: Pick<FceArca, 'cuitEmisor' | 'cbteTipo' | 'ptoVta' | 'numero' | 'importe'>): Promise<void>;
    rechazar(f: Pick<FceArca, 'cuitEmisor' | 'cbteTipo' | 'ptoVta' | 'numero'>, motivos: string[], texto: string): Promise<void>;
    motivosRechazo(): Promise<{ codigo: string; descripcion: string }[]>;
  }
  ```
- Create `arca/wsfecred.ts`: armado y lectura de XML (namespace y operaciones según el WSDL de ARCA; nombres de operación `consultarMontoObligadoRecepcion`, `consultarComprobantes`, `aceptarFECred`, `rechazarFECred`, `consultarTiposMotivosRechazo`), con `ErrorServicioArca` para errores del servicio. Fixtures en `arca/fixtures/wsfecred-*.xml`.
- `arca/arca-real.ts`: `auth(servicio)` con el ticket del servicio (`armarTra(servicio, …)`, almacén por servicio); `ArcaRealFce implements ClienteFce` (o métodos en la misma clase) con endpoints `wsfecred` de homologación y producción.
- Create `arca/arca-simulado-fce.ts`: `ArcaSimuladoFce implements ClienteFce`. Emitidas: las FCE autorizadas en `ArcaSimuladoComprobante` (tipos 201/206/211) de la empresa, estado PENDIENTE con plazo de 30 días desde la fecha salvo lo forzado. Recibidas y obligados: en memoria por empresa, solo pruebas: `static obligar(empresaId, cuit, montoMinimo | null)`, `static recibir(empresaId, f: FceArca)`, `static fijarEstado(empresaId, clave, estado)`, `static forzarSinConexion(empresaId)`; fuera de pruebas: nadie obligado, sin recibidas. Motivos simulados: `[{ codigo: '1', descripcion: 'Mercadería no entregada' }, { codigo: '2', descripcion: 'Diferencias de precio o cantidad' }, { codigo: '3', descripcion: 'Mercadería dañada' }]`.
- `arca/config-arca.service.ts`: `clienteFce(): Promise<ClienteFce>` y `ambiente(): Promise<AmbienteArca>`.
- **Test:** `apps/api/src/arca/wsfecred.spec.ts` (XML con fixtures), `apps/api/src/arca/arca-simulado-fce.spec.ts`.

**Interfaces — Produces:** `ClienteFce`, `FceArca`, `EstadoFce`, `ObligacionFce`, `ConfigArcaService.clienteFce()`, estáticos del simulado.

- [ ] Pruebas que fallan: el XML de `consultarMontoObligadoRecepcion` lleva el CUIT y la fecha; la lectura de la respuesta fixture da `{ obligado: true, montoMinimo: '<fixture>' }`; la lectura de `consultarComprobantes` da estados mapeados; un `faultstring` da `ErrorServicioArca`; el ticket de `wsfecred` se guarda con `servicio: 'wsfecred'` sin pisar el de `wsfe`; simulado: `obligar` y consulta, recibidas, aceptar cambia el estado a ACEPTADA, rechazar a RECHAZADA con motivos.
- [ ] `npx jest src/arca` → PASS. Commit `feat(arca): cliente del registro de facturas de crédito MiPyME`.

### Task 3: ¿Corresponde FCE? (obligación del cliente)
**Files:**
- `prisma/schema.prisma` + migración: `Tercero.fceObligado Boolean?`, `fceMontoMinimo Decimal? @db.Decimal(18,2)`, `fceConsultadoEn DateTime?`, `fceConsultadoAmbiente AmbienteArca?`, `fceObligadoManual Boolean @default(false)` (editable en la ficha del tercero).
- Create `ventas/fce/obligacion.service.ts`: `obligacion(terceroId: string, fecha: string, totalPesos?: string): Promise<{ obligado: boolean; montoMinimo: string | null; corresponde: boolean; aviso: string | null; consultadoEn: string | null }>` — consulta ARCA si no hay consulta del día y del ambiente actual; si `ErrorConexionArca`: última consulta del mismo ambiente con aviso `No se pudo consultar ARCA: se usa la consulta del <dd/mm/aaaa>`, si no hay, la marca manual (aviso `No se pudo consultar ARCA: se usa la marca manual del cliente`). Si la empresa no es MiPyME: `{ obligado: false, corresponde: false }` sin consultar.
- `ventas/fce/fce.controller.ts`: `GET /api/ventas/fce/obligacion?terceroId=&fecha=&total=` (`venta.emitir`).
- `ventas/emision/emision.service.ts` (antes de pedir CAE, solo facturas): común y `corresponde` → 400 `El cliente está obligado a recibir factura de crédito MiPyME desde $ <mínimo formateado es-AR>: emita una factura de crédito`; FCE y no obligado → 400 `El cliente no está obligado a recibir factura de crédito MiPyME`. Condición de receptor: CUIT y condición IVA RI o EXENTO.
- **Test:** `apps/api/test/fce-obligacion.e2e-spec.ts`.

**Interfaces — Consumes:** Task 2 (`clienteFce`, `ArcaSimuladoFce.obligar/forzarSinConexion`). **Produces:** `ObligacionFceService.obligacion(...)`.

- [ ] Pruebas que fallan: cliente obligado con mínimo 1.000.000 y factura común de 2.000.000 → 400 con `$ 1.000.000,00`; de 500.000 → se emite común; FCE a no obligado → 400; FCE voluntaria a obligado por 500.000 → se emite; factura en USD 1.000 × 1.500 = 1.500.000 → corresponde; dos consultas el mismo día → una sola llamada al simulado; sin conexión con consulta de ayer → usa ayer con aviso; sin conexión sin consulta y marca manual → corresponde según la marca; consulta de otro ambiente ignorada; empresa no MiPyME → no consulta y emite común (Review Focus 1); consumidor final → no corresponde.
- [ ] `npx jest --runInBand test/fce-obligacion test/fce-emision test/ventas-comprobantes` → PASS. Commit `feat(ventas): obligación de recibir factura de crédito MiPyME`.

### Task 4: Registro y FCE emitidas
**Files:**
- `prisma/schema.prisma` + migraciones (enums en la suya): `enum RolFce { EMISOR RECEPTOR }`, `enum EstadoFceRegistro { PENDIENTE ACEPTADA RECHAZADA ACEPTADA_TACITA }`; `model FceRegistro { id, empresaId, ambiente AmbienteArca, rol RolFce, cuitContraparte String, cbteTipo Int, puntoVenta Int, numero Int, fecha Date, importe Decimal(18,2), moneda String, fechaVencimientoPago Date?, estado EstadoFceRegistro, fechaRecepcion Date?, fechaLimite Date?, motivosRechazo String[], textoRechazo String?, consultadoEn DateTime, comprobanteVentaId Uuid?, comprobanteCompraId Uuid?; @@unique([empresaId, ambiente, rol, cuitContraparte, cbteTipo, puntoVenta, numero]) }` (agregar a `MODELOS_DE_EMPRESA`).
- Create `ventas/fce/registro.service.ts`: `actualizar(rol): Promise<{ actualizadas: number }>` (consulta los últimos 90 días, upsert por la clave, empareja con la venta por ambiente/punto de venta/código/número o con la compra por CUIT/código base/punto/número con `fce` primero); `listar(rol, estado?)` (actualiza antes si la última consulta del rol tiene más de una hora o no hay; devuelve filas con `diasRestantes` y `notas` asociadas para emitidas, `compraCargada` para recibidas); `ErrorConexionArca` → 400 `No se pudo consultar ARCA: <detalle>` en el botón, y en el listado automático devuelve lo guardado con `aviso`.
- `ventas/fce/fce.controller.ts`: `GET /api/ventas/fce?estado=` (`venta.ver`), `POST /api/ventas/fce/actualizar` (`venta.ver`).
- `ventas/emision/emision.service.ts`: nota FCE con anulación `S` sobre una FCE cuyo registro está `ACEPTADA` o `ACEPTADA_TACITA` → 400 `La factura de crédito está aceptada: no se puede anular`.
- **Test:** `apps/api/test/fce-emitidas.e2e-spec.ts`.

**Interfaces — Consumes:** Task 1, Task 2. **Produces:** `FceRegistroService.actualizar(rol)`, `listar(rol, estado?)`, modelo `FceRegistro`.

- [ ] Pruebas que fallan: emitir FCE, actualizar → fila PENDIENTE emparejada con la venta, fecha límite = fecha + 30; `fijarEstado` RECHAZADA → la lista la muestra rechazada con motivos; nota de anulación S sobre aceptada → 400; sobre rechazada → emite 203; sin conexión al actualizar → 400 `No se pudo consultar ARCA: …`; listado con consulta reciente no vuelve a consultar; filas de SIMULADO no aparecen al cambiar de ambiente.
- [ ] `npx jest --runInBand test/fce-emitidas test/fce-emision` → PASS. Commit `feat(ventas): estado de las facturas de crédito emitidas`.

### Task 5: FCE recibidas y compras
**Files:**
- `prisma/schema.prisma` + migración: `ComprobanteCompra.fce Boolean @default(false)`; unicidad del comprobante de compra con `fce`.
- `compras/comprobantes` (dto y service): campo `fce` (solo FACTURA/NOTA_DEBITO/NOTA_CREDITO con letra A/B/C).
- `impuestos/codigos.ts`: `codigoCompra(tipo, letra, fce = false)` → +200; usos en `libro-iva-digital.ts` y `control-arca.service.ts`.
- `impuestos/control-arca/control-arca.service.ts`: emparejar fila 201…213 primero con compra `fce`, si no con la común; en ese caso aviso `La compra es una factura de crédito MiPyME`.
- `compras/fce/fce-recibidas.controller.ts` (en el módulo de compras o en `ventas/fce` con ruta `compras/fce`): `GET /api/compras/fce?estado=` (`fc.ver`), `POST /api/compras/fce/actualizar` (`fc.ver`), `GET /api/compras/fce/motivos` (`fc.ver`), `POST /api/compras/fce/:id/aceptar` (`fc.crear`), `POST /api/compras/fce/:id/rechazar` `{ motivos: string[] (≥1), texto: string ≤ 250 }` (`fc.crear`).
- `ventas/fce/registro.service.ts`: `aceptar(id)` / `rechazar(id, motivos, texto)`: solo `PENDIENTE` (si no 400 `La factura de crédito no está pendiente`); fecha límite pasada → 400 `El plazo para aceptar o rechazar venció el <dd/mm/aaaa>`; llama al cliente, actualiza la fila, auditoría `FceRegistro` `APROBAR` / `ANULAR`; respuesta con `aviso`: sin compra cargada `La compra no está cargada`; rechazo con compra `La compra está cargada: anúlela o registre la nota de crédito del proveedor`; al emparejar, la compra queda con `fce = true`.
- **Test:** `apps/api/test/fce-recibidas.e2e-spec.ts`.

**Interfaces — Consumes:** Tasks 2 y 4.

- [ ] Pruebas que fallan: `recibir` una FCE A 0001-123 de un proveedor con la factura común A 0001-123 ya cargada y otra compra FCE A 0001-123 → ambas compras conviven (unicidad), el registro empareja con la FCE; aceptar → ACEPTADA, auditoría; aceptar sin compra → aviso; rechazar sin motivos → 400; rechazar con compra → aviso; plazo vencido → 400 con la fecha; ya aceptada → 400; Libro IVA de compras con `201` para la marcada y `001` para la común (Review Focus 4); control Mis Comprobantes con aviso; permisos (`fc.ver` sin `fc.crear` → 403 al aceptar).
- [ ] `npx jest --runInBand test/fce-recibidas test/impuestos-control-arca test/compras` → PASS (usar los nombres reales de las pruebas de compras y libros). Commit `feat(compras): facturas de crédito MiPyME recibidas`.

### Task 6: Pantallas y e2e
**Files:**
- `apps/web/src/ventas/ConfigArcaPage.tsx`: «La empresa es MiPyME», «Cuenta bancaria para la factura de crédito» (cuentas con CBU), «Transferencia por defecto» (SCA/ADC).
- Ficha del tercero (`paginas/TercerosPage.tsx`): «Obligado a recibir factura de crédito MiPyME (marca manual)» y el texto de la última consulta (`Según ARCA al <fecha>: obligado desde $ <mínimo>` / `no obligado`).
- `ventas/ComprobanteVentaPage.tsx`: casilla «Factura de crédito MiPyME (FCE)» propuesta con `GET /ventas/fce/obligacion` al elegir cliente/fecha y al cambiar el total (aviso `Corresponde factura de crédito: el cliente está obligado desde $ <mínimo>`); transferencia (SCA/ADC) en la factura; «Anulación (rechazo de la factura)» en notas FCE; sin fecha de vencimiento del pago aparte en FCE.
- `compras/FacturaProveedorPage.tsx`: casilla «Factura de crédito MiPyME (FCE)».
- Create `ventas/FacturasCreditoPage.tsx`: `FceEmitidasPage` (*Ventas › Facturas de crédito MiPyME*) y `FceRecibidasPage` (*Compras › Facturas de crédito MiPyME recibidas*) con filtro por estado, *Actualizar desde ARCA*, plazo resaltado con ≤ 5 días, *Emitir nota de crédito de anulación* (navega al comprobante de venta con tipo NC, FCE, asociado y anulación) y *Aceptar* / *Rechazar* (modal con motivos MultiSelect y texto).
- Menú y rutas: permisos `venta.ver` y `fc.ver`.
- `e2e/tests/fce.spec.ts` (proyecto `fce`, encadenado al último): configurar MiPyME y CBU, marcar cliente obligado (simulado vía API de prueba o marca manual con el simulado sin obligados), emitir una FCE y verla en la lista de emitidas.
- `docs/pendientes.md`: ítem 13 hecho (entrega 50); §2 los datos a verificar de la spec §11; §3 quitar el menor de «Mis Comprobantes» con FCE.
- **Test:** `apps/web/src/ventas/fce.test.tsx`.

- [ ] Pruebas que fallan (vitest): la configuración muestra los tres campos; el comprobante marca FCE solo cuando la consulta dice `corresponde` y muestra el aviso; la nota FCE muestra «Anulación»; la lista de recibidas resalta la de 3 días y no la de 10; rechazar exige un motivo; el menú muestra las dos pantallas con sus permisos.
- [ ] vitest completo, `pnpm build`, e2e del proyecto `fce` → PASS. Commit `feat(web): pantallas de factura de crédito MiPyME`.

Al final: suite completa de la API (dos shards), web y e2e sola sobre base nueva; revisión final.
