# Entrega 6: Ventas básicas y factura electrónica ARCA. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la empresa:
- emita FC, NC y ND electrónicas con CAE de ARCA, en modo Simulado, Homologación o Producción;
- las cobre con recibos con valores y retenciones sufridas;
- aplique saldos a favor;
- lleve la cuenta corriente de clientes con asientos automáticos.

**Architecture:**
- **Dos módulos Nest nuevos:**
  - `arca`: configuración, certificados cifrados, WSAA/WSFE y simulador detrás de la interfaz `ClienteArca`;
  - `ventas`: comprobantes, emisión, PDF, aplicaciones, recibos y consultas.
- **Emisión en tres pasos:** reserva en transacción, llamada a ARCA fuera de la transacción, resultado en transacción. La cuenta corriente y el asiento se generan recién al autorizar.
- **Lógica pura en `packages/shared/src/ventas/`:** la letra, el cálculo de importes y los códigos ARCA, para que la web muestre lo mismo que el servidor.

**Tech Stack:**
- La de siempre: NestJS, Prisma, pdfkit, React y Mantine.
- Dependencias nuevas en `apps/api`:
  - `node-forge` y `@types/node-forge`, para la firma CMS;
  - `fast-xml-parser`, para leer el SOAP;
  - `qrcode` y `@types/qrcode`, para el QR del PDF.

**Spec:** `docs/superpowers/specs/2026-11-08-entrega-6-ventas-design.md`

## Global Constraints

- **Multi-empresa:** todo modelo nuevo lleva `empresaId`, va en `MODELOS_DE_EMPRESA` y se accede vía `TenantPrisma`.
  - Excepción: `TokenArca` y `ArcaSimuladoComprobante` también llevan `empresaId` y van en la lista.
- **Importes:** Decimal(18,2); cantidades y precios unitarios Decimal(18,4); cotización Decimal(18,6). Siempre aritmética con Decimal.
- **Validación y mensajes:** auditoría en cada escritura, mensajes en castellano, zod con 400 `{ message, campos }`.
- **Rutas:** `/api/ventas/...` y `/api/arca/...`.
- **Permisos nuevos:**
  - `venta.emitir`: 'Emitir comprobantes de venta';
  - `cobro.registrar`: 'Registrar recibos y aplicaciones';
  - `venta.ver`: 'Ver ventas y cuentas corrientes de clientes';
  - `arca.configurar`: 'Configurar factura electrónica ARCA'.

  Una migración se los da al rol Administrador.
- **Conceptos nuevos** (la cantidad de conceptos pasa de 20 a 26):
  - `VENTAS` 4.1.01;
  - `IVA_DEBITO_FISCAL` 2.1.02.001;
  - `RETENCION_SUFRIDA_IVA` 1.1.03.005;
  - `RETENCION_SUFRIDA_GANANCIAS` 1.1.03.006;
  - `RETENCION_SUFRIDA_IIBB` 1.1.03.007;
  - `RETENCION_SUFRIDA_SUSS` 1.1.03.008.
- **Mensajes exactos de la spec:** se copian tal cual, por ejemplo:
  - "Un comprobante autorizado no se anula: emita una nota de crédito";
  - "Hay otra emisión en curso para este punto de venta, reintente en unos segundos";
  - "No se pudo conectar con ARCA: el comprobante quedó pendiente de CAE";
  - "ARCA rechazó el comprobante: (código) texto".
- **ARCA fuera de transacción:** nunca se llama a ARCA dentro de `tenant.transaccion`.
- **Recuperación:** `numeroReservado` se conserva ante errores de red y se limpia ante un rechazo o una aprobación.
- **Bloqueo:**
  - comprobante → talonario ARCA, y movimientos de cuenta corriente en orden de id;
  - el período se bloquea último, dentro de `AsientosService.generar`, como en la Entrega 5.

## Review Focus

1. **ARCA autoriza pero la respuesta no llega, y luego otro comprobante del mismo talonario se emite antes del reintento** → el reintento adopta el CAE de su número reservado (≤ N) y no pide otro. Test en la Task 5.
2. **Un cobro de Tesorería o un recibo cuyo saldo ya se aplicó con la pantalla de Aplicación** → anular el ingreso o el recibo devuelve 400 y no deja una aplicación apuntando a un movimiento anulado. Test en las Tasks 7 y 8.
3. **Factura en USD cobrada en pesos en dos recibos parciales con distinta cotización** → el saldo en USD queda en 0, el saldo en pesos queda en 0 y la diferencia de cambio total es igual a (pesos cobrados − pesos facturados). Test en la Task 7.
4. **NC con un importe igual al saldo exacto de la factura después de un cobro parcial; NC por un centavo más** → la primera pasa y la segunda da 400 con el mensaje de saldo. Test en la Task 4.
5. **Factura con renglones de 21%, 10,5%, exento y no gravado, con precios de 4 decimales** → el IVA por alícuota redondeado sobre la base sumada, el total igual a la suma, el asiento balanceado y el simulador aceptándola. Test en la Task 1 (cálculo) y en la Task 5 (emisión).

---

## Estructura de archivos

```
packages/shared/src/ventas/
  letra.ts, calculo.ts, codigos-arca.ts, qr.ts (+ .test.ts de cada uno), index.ts
apps/api/src/arca/
  cifrado.ts        AES-256-GCM con ARCA_CLAVE_MAESTRA
  certificado.ts    leer PEM, sujeto, CUIT, vencimiento, verificar par
  wsaa.ts           TRA, firma CMS, parseo de loginCmsResponse
  wsfe.ts           armado de SOAP de FECompUltimoAutorizado / FECompConsultar / FECAESolicitar / FEDummy y parseo
  cliente-arca.ts   interfaz ClienteArca + tipos DatosCae / ResultadoCae / ErrorConexionArca
  arca-real.ts, arca-simulado.ts
  config-arca.service.ts, config-arca.controller.ts, arca.module.ts
apps/api/src/ventas/
  comprobantes/   dto.ts, comprobantes.service.ts (alta/edición/baja), comprobantes.controller.ts
  emision/        emision.service.ts, asiento-venta.ts
  pdf/            pdf-venta.ts
  aplicaciones/   aplicaciones.service.ts, aplicaciones.controller.ts
  recibos/        dto.ts, recibos.service.ts, recibos.controller.ts
  consultas/      consultas-ventas.service.ts, consultas-ventas.controller.ts
  ventas.module.ts
apps/web/src/ventas/
  ComprobanteVentaPage.tsx, ReciboPage.tsx, AplicacionPage.tsx, ConsultasVentasPages.tsx, ConfigArcaPage.tsx, comun.ts
e2e/ventas.spec.ts
```

---

### Task 1: Lógica compartida de ventas y permisos

**Files:**
- Create: `packages/shared/src/ventas/{letra,calculo,codigos-arca,qr,index}.ts` y sus `.test.ts`
- Modify: `packages/shared/src/index.ts` (`export * from './ventas'`), `packages/shared/src/permisos.ts` (los 4 permisos)

**Interfaces:**
- Produces:
  - `type Letra = 'A'|'B'|'C'`;
  - `letraVenta(empresa: CondicionIva, cliente: CondicionIva): Letra`. Lanza `Error('La condición de IVA de la empresa no permite emitir comprobantes')`.
  - `type TipoVenta = 'FACTURA'|'NOTA_DEBITO'|'NOTA_CREDITO'`;
  - `type AlicuotaVenta = AlicuotaIva | 'NO_GRAVADO' | 'EXENTO'`;
  - `interface RenglonCalculo { cantidad: string; precioUnitario: string; alicuota: AlicuotaVenta }`;
  - `calcularVenta(renglones: RenglonCalculo[], letra: Letra): { renglones: { neto: string; iva: string }[]; netoGravado: string; noGravado: string; exento: string; iva: string; total: string; ivas: { alicuota: AlicuotaIva; base: string; importe: string }[] }`. Usa decimal.js, la misma que ya usa shared/compras.
  - `cbteTipo(tipo: TipoVenta, letra: Letra): number`;
  - `condicionIvaReceptorArca(c: CondicionIva): number`;
  - `alicuotaArca(a: AlicuotaIva): number`;
  - `docTipoArca(t: 'CUIT'|'DNI'|'OTRO'): number`;
  - `monedaArca(codigo: 'ARS'|'USD'): 'PES'|'DOL'`;
  - `urlQrArca(d: { fecha: string; cuit: string; ptoVta: number; tipoCmp: number; nroCmp: number; importe: string; moneda: 'PES'|'DOL'; ctz: string; tipoDocRec: number; nroDocRec: string; cae: string }): string`.

- [ ] **Step 1: Write the failing tests**
  - `letra.test.ts`:
    - RI→RI = A, RI→MONOTRIBUTO = A;
    - RI→EXENTO, CONSUMIDOR_FINAL y NO_RESPONSABLE = B;
    - MONOTRIBUTO→cualquiera = C, EXENTO→RI = C;
    - empresa CONSUMIDOR_FINAL lanza el mensaje.
  - `calculo.test.ts`, caso mixto: renglones `{2, '100.1250', 21}`, `{1, '50', 21}`, `{3, '33.3333', 10.5}`, `{1, '10', 'EXENTO'}`, `{1, '5', 'NO_GRAVADO'}`.
    - Netos: `'200.25'`, `'50.00'`, `'100.00'`, `'10.00'`, `'5.00'`.
    - `ivas`: `[{21, base '250.25', importe '52.55'}, {10.5, base '100.00', importe '10.50'}]`.
    - `netoGravado '350.25'`, `exento '10.00'`, `noGravado '5.00'`, `iva '63.05'`, `total '428.30'`.
  - Letra C con los mismos renglones gravados: `iva '0.00'`, `ivas []`, `netoGravado` = total.
  - `codigos-arca.test.ts`: los valores de las tablas de la spec 3.2, por ejemplo `cbteTipo('NOTA_CREDITO','B') === 8` y `condicionIvaReceptorArca('NO_RESPONSABLE') === 15`.
  - `qr.test.ts`: decodificar el `p=` de la URL da `{ver:1, fecha:'2026-11-08', cuit:30712345671, ptoVta:2, tipoCmp:6, nroCmp:15, importe:1210, moneda:'PES', ctz:1, tipoDocRec:99, nroDocRec:0, tipoCodAut:'E', codAut:70417054367476}`. Los números van como números en el JSON.

- [ ] **Step 2: Run** `pnpm --filter @gestion/shared test`. Expected: FAIL (módulos inexistentes).
- [ ] **Step 3: Implement** los cinco archivos y los 4 permisos con los textos de Global Constraints.
- [ ] **Step 4: Run** `pnpm --filter @gestion/shared test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): letra, cálculo y códigos ARCA de ventas`.

### Task 2: Esquema, migración y datos maestros

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma`;
  - `apps/api/src/prisma/modelos-empresa.ts`;
  - `apps/api/src/compras/config/conceptos.ts`;
  - `apps/api/src/seed/plan-cuentas-modelo.ts`;
  - `apps/api/src/empresas/empresas.service.ts` (crea `ConfigArca` SIMULADO);
  - `apps/api/src/terceros/*` (dto y validación de `tipoDocumento`);
  - el maestro de puntos de venta (`electronico`, `sucursalId`);
  - `apps/api/test/pagos-config.e2e-spec.ts` (20 → 26).
- Create:
  - `apps/api/prisma/migrations/20261109090000_ventas/migration.sql`;
  - `apps/api/test/ventas-maestros.e2e-spec.ts`.

**Interfaces:**
- Produces:
  - **Enums Prisma:**
    - `TipoDocumento {CUIT DNI OTRO}`;
    - `AmbienteArca {SIMULADO HOMOLOGACION PRODUCCION}`;
    - `TipoComprobanteVenta {FACTURA NOTA_DEBITO NOTA_CREDITO}`;
    - `ConceptoVenta {PRODUCTOS SERVICIOS PRODUCTOS_Y_SERVICIOS}`;
    - `EstadoComprobanteVenta {PENDIENTE_CAE AUTORIZADO RECHAZADO}`;
    - `EstadoRecibo {CONFIRMADO ANULADO}`;
    - `TipoRetencionSufrida {IVA GANANCIAS IIBB SUSS}`.
  - **Modelos:**
    - `ConfigArca`, `TokenArca`, `ArcaSimuladoComprobante`;
    - `ComprobanteVenta`, `ComprobanteVentaRenglon`, `ComprobanteVentaIva`;
    - `Recibo`, `ReciboRetencion`, `AplicacionCobro`.

    Los campos son los de la spec 2.1, 3.1, 4.1 y 5.1, con los nombres de la spec. `ComprobanteVentaRenglon.alicuota` es String: `'21'`, `'10.5'`, `'NO_GRAVADO'`, etc. `ArcaSimuladoComprobante` tiene: ptoVta, cbteTipo, numero, cae, caeVencimiento, docNro, fecha, total, moneda, y el único (empresaId, ptoVta, cbteTipo, numero).
  - `Tercero.tipoDocumento TipoDocumento @default(CUIT)`;
  - `PuntoVenta.electronico Boolean @default(true)`, `PuntoVenta.sucursalId String? @db.Uuid`.

- [ ] **Step 1: Write the failing tests** (`ventas-maestros.e2e-spec.ts`):
  - `GET /api/compras/config` devuelve 26 cuentas e incluye `VENTAS` y `RETENCION_SUFRIDA_IIBB` (1.1.03.007);
  - una empresa creada por `POST /api/empresas` tiene `ConfigArca` con `ambiente 'SIMULADO'`;
  - cliente con `tipoDocumento 'DNI'` y `cuit '30123456'` → 201;
  - DNI `'123'` → 400 campo `cuit`;
  - `tipoDocumento 'OTRO'` con `cuit 'Consumidor final'` → 201;
  - CUIT inválido con tipo CUIT → 400, como antes;
  - el rol Administrador de una empresa nueva tiene `venta.emitir`.
- [ ] **Step 2: Run** `cd apps/api && npx jest test/ventas-maestros test/pagos-config`. Expected: FAIL.
- [ ] **Step 3: Implement** el esquema y la migración.
  - **SQL:** se genera con `prisma migrate diff --from-migrations … --to-schema-datamodel … --shadow-database-url …/gestion_shadow --script`.
  - **Datos que se agregan a mano al final del SQL:**
    - las 4 cuentas 1.1.03.005–008 bajo `1.1.03` en cada empresa que la tenga (activo, imputables);
    - los 6 `ConfigCuenta`, con `ON CONFLICT DO NOTHING`;
    - `ConfigArca` SIMULADO para cada empresa;
    - los 4 permisos para el rol `Administrador`.
  - **Al aplicarla:** `migrate deploy` en gestion y gestion_test, y verificar que el diff de drift quede vacío.
- [ ] **Step 4: Run** el mismo comando. Expected: PASS. Después correr `npx jest` completo.
- [ ] **Step 5: Commit** `feat(ventas): esquema, cuentas, conceptos y tipo de documento`.

### Task 3: Módulo ARCA (cifrado, certificado, WSAA, WSFE, simulador, configuración)

**Files:**
- Create: `apps/api/src/arca/*` (ver estructura).
- Tests: `apps/api/src/arca/{cifrado,certificado,wsaa,wsfe}.spec.ts`, `apps/api/test/arca-config.e2e-spec.ts`.
- Add fixtures: `apps/api/src/arca/fixtures/*.xml` (respuestas de ejemplo de loginCms, FECAESolicitar aprobada / rechazada / con observaciones, FECompUltimoAutorizado, FECompConsultar, error 600).
- Modify: `app.module.ts`, `apps/api/test/env.ts` (`ARCA_CLAVE_MAESTRA` de prueba).

**Interfaces:**
- Produces (`cliente-arca.ts`):
  - **`ClienteArca`:**
    ```ts
    interface ClienteArca {
      ultimoAutorizado(ptoVta: number, cbteTipo: number): Promise<number>;
      consultar(ptoVta: number, cbteTipo: number, numero: number): Promise<ComprobanteArca | null>;
      solicitarCae(d: DatosCae): Promise<ResultadoCae>;
      probar(): Promise<{ ok: boolean; detalle: string }>;
    }
    ```
  - **`DatosCae`:** `{ ptoVta, cbteTipo, numero, concepto: 1|2|3, docTipo, docNro: string, condicionIvaReceptor: number, fecha: string /*YYYYMMDD*/, impTotal, impTotConc, impNeto, impOpEx, impIva: string, monId: 'PES'|'DOL', monCotiz: string, fchServDesde?, fchServHasta?, fchVtoPago?: string, iva: { id: number; baseImp: string; importe: string }[], asociados: { tipo: number; ptoVta: number; nro: number; cuit: string; fecha: string }[] }`.
  - **`ResultadoCae`:**
    ```ts
    type ResultadoCae =
      | { resultado: 'A'; cae: string; caeVencimiento: string; observaciones: string[] }
      | { resultado: 'R'; errores: string[] };   // cada texto "(código) mensaje"
    ```
  - **`ComprobanteArca`:** `{ numero, docNro, fecha, impTotal, monId, cae, caeVencimiento }`.
  - **`class ErrorConexionArca extends Error`:** red, timeout, respuesta ilegible o falla de WSAA.
  - **Funciones:**
    - `ConfigArcaService.cliente(tx?): Promise<ClienteArca>`: valida certificado y vencimiento con los mensajes de la spec 2.1 y elige la implementación por ambiente;
    - `ConfigArcaService.obtener()`, `guardar({ ambiente })`, `cargarCertificado(crt: string, key: string)`, `probar()`.
    - `ArcaSimulado.forzarFalla(empresaId, falla: 'RECHAZO'|'SIN_CONEXION'|'AUTORIZA_SIN_RESPONDER'|null)`: estática, solo con NODE_ENV=test, y se consume una vez.
  - **Endpoints:**
    - `GET /api/arca/config` → `{ ambiente, certificadoSujeto, certificadoVence, tieneCertificado, venceProximo }`;
    - `PUT /api/arca/config`;
    - `POST /api/arca/certificado`, multipart con `certificado` y `clave`;
    - `POST /api/arca/probar`.

    Todos con permiso `arca.configurar`.

- [ ] **Step 1: Write the failing unit tests:**
  - **`cifrado.spec`:** ida y vuelta de un texto; sin `ARCA_CLAVE_MAESTRA` lanza "El servidor no tiene configurada la clave para guardar certificados"; un tag alterado lanza.
  - **`certificado.spec`:** se genera en la prueba con `node-forge` un par RSA 2048 y un certificado autofirmado con `serialNumber 'CUIT 30712345671'`.
    - `leerCertificado` devuelve el CUIT `'30712345671'` y el vencimiento;
    - `verificarPar(crt, keyAjena)` lanza "El certificado no corresponde a la clave privada".
  - **`wsaa.spec`:**
    - `armarTra('wsfe', ahora)` tiene `uniqueId` y `generationTime`/`expirationTime` a ±10 min;
    - `firmarTra(tra, crt, key)` produce un CMS base64 que `forge.pkcs7` vuelve a leer con el contenido igual al TRA y la firma verificable;
    - `leerLoginResponse(fixture)` → `{ token, sign, vence }`.
  - **`wsfe.spec`:**
    - `xmlSolicitarCae(auth, datos)` con NC B y un asociado contiene `<ar:CbteTipo>8</ar:CbteTipo>`, `<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>`, `<ar:CbtesAsoc>` y no contiene `<ar:Iva>` cuando `iva` está vacío;
    - `leerSolicitarCae(fixtureAprobada)` → `resultado 'A'` con CAE;
    - `leerSolicitarCae(fixtureRechazada)` → `errores ['(10016) …']`;
    - `fixtureError600` → lanza `ErrorConexionArca` con la marca `tokenInvalido: true`.
- [ ] **Step 2: Write the failing e2e** `arca-config.e2e-spec.ts`:
  - `GET config` → SIMULADO;
  - `PUT ambiente HOMOLOGACION` sin certificado y luego `POST probar` → 400 "La empresa no tiene certificado de ARCA cargado";
  - cargar crt y key autofirmados del CUIT de la empresa → 201 con sujeto y vencimiento;
  - cargar uno de otro CUIT → 400 "El certificado es de otro CUIT (20-…)";
  - el certificado guardado en la base no contiene `BEGIN CERTIFICATE`, porque está cifrado;
  - en SIMULADO, `probar` → `{ ok: true }`;
  - sin permiso → 403.
- [ ] **Step 3: Run** `npx jest src/arca test/arca-config`. Expected: FAIL.
- [ ] **Step 4: Implement:**
  - **`ArcaReal`:**
    - `fetch` con `AbortSignal.timeout(30000)` y endpoints por ambiente (spec 2.1);
    - token de `TokenArca` reutilizado si le quedan más de 10 minutos;
    - ante `tokenInvalido`, borra el token y reintenta una vez.
  - **`ArcaSimulado`:** con las reglas de la spec 3.8.
    - CAE = 14 dígitos derivados de (ptoVta, cbteTipo, numero), deterministas.
    - Errores exactos:
      - número no correlativo → `(10016) El numero de comprobante no es el proximo a autorizar`;
      - total distinto → `(10048) El campo ImpTotal no coincide con la suma de los importes`;
      - NC o ND sin asociado → `(10197) Debe informar comprobantes asociados`;
      - IVA → `(10018) La suma del IVA no coincide con ImpIVA`.
- [ ] **Step 5: Run** el mismo comando. Expected: PASS.
- [ ] **Step 6: Commit** `feat(arca): certificados cifrados, WSAA/WSFE y simulador`.

### Task 4: Comprobantes de venta: alta, edición y eliminación

**Files:**
- Create: `apps/api/src/ventas/comprobantes/{dto,comprobantes.service,comprobantes.controller}.ts`, `apps/api/src/ventas/ventas.module.ts`, `apps/api/test/helpers-ventas.ts`, `apps/api/test/ventas-comprobantes.e2e-spec.ts`.

**Interfaces:**
- Consumes: `calcularVenta`, `letraVenta` (Task 1); `NumeracionService.siguiente(tx, 'VENTA-INTERNO', 0)`; `periodoAbierto` no se usa aquí, se usa al emitir.
- Produces:
  - `POST /api/ventas/comprobantes` recibe `{ terceroId, puntoVentaId, tipo, concepto, fecha, fechaVencimiento, fechaServicioDesde?, fechaServicioHasta?, fechaVencimientoPago?, monedaCodigo, cotizacion?, comprobanteAsociadoId?, aplicarAAsociado?: boolean (default true), renglones: { articuloId?, descripcion, cantidad, precioUnitario, alicuota }[], emitir?: boolean }`;
  - `PUT /api/ventas/comprobantes/:id` (con `version`) y `DELETE /api/ventas/comprobantes/:id`;
  - `ComprobantesVentaService.saldoDisponibleNc(tx, asociadoId): Dec`: saldo del movimiento de cuenta corriente del asociado menos las NC autorizadas no aplicadas que lo referencian;
  - `helpers-ventas.ts`: `prepararVentas(app, prisma)` → `{ http, empresaId, puntoVenta, clienteRI, clienteCF, cuenta(codigo), factura(datos?) }`. El helper `factura` crea y emite una factura A por 1.000 neto al 21% y devuelve el body.
  - El controlador lleva `@RequierePermiso('venta.emitir')` en las escrituras.

- [ ] **Step 1: Write the failing tests:**
  - **Alta:** alta B a CF → 201 con `estado 'PENDIENTE_CAE'`, `numero null`, `letra 'B'`, `total` según `calcularVenta`, y **sin** movimiento de cuenta corriente ni asiento.
  - **Validaciones:**
    - factura A a un cliente `tipoDocumento 'DNI'` RI → 400 "El cliente no tiene CUIT válido para una factura A";
    - concepto SERVICIOS sin fechas → 400 con campo `fechaServicioDesde`;
    - punto de venta no electrónico → 400 "El punto de venta no es electrónico";
    - NC sin asociado → 400 campo `comprobanteAsociadoId`;
    - NC con asociado de otro cliente → 400 "El comprobante asociado es de otro cliente".
  - **Edición y baja:** edición con `version` vieja → 409; DELETE de pendiente → 200.
  - Lo que se prueba con comprobantes autorizados (Review Focus 4 y DELETE de un autorizado) queda en la Task 5, que es la que emite.
- [ ] **Step 2: Run** `npx jest test/ventas-comprobantes`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - las reglas de la spec 3.4;
  - el cálculo lo hace siempre `calcularVenta` del lado del servidor, y los importes que manda el cliente se ignoran;
  - la cuenta de cada renglón es `articulo.cuentaVentaId ?? cuenta('VENTAS')`;
  - en ARS la cotización es 1; en USD, `cotizacion ?? cotizacion(tx,'USD',fecha)`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ventas): alta y edición de comprobantes de venta`.

### Task 5: Emisión con CAE, cuenta corriente y asiento

**Files:**
- Create: `apps/api/src/ventas/emision/{emision.service,asiento-venta}.ts`, `apps/api/test/ventas-emision.e2e-spec.ts`.
- Modify: `comprobantes.controller.ts` (`POST :id/emitir`), `comprobantes.service.ts` (alta con `emitir: true` llama a `emitir`).

**Interfaces:**
- Consumes: `ConfigArcaService.cliente()`, `ClienteArca`, `ErrorConexionArca`, `ArcaSimulado.forzarFalla` (Task 3); `AsientosService.generar`; `periodoAbierto`.
- Produces:
  - `EmisionService.emitir(id: string): Promise<ComprobanteVenta & { advertencias: string[] }>`. Errores:
    - 409 si hay otra emisión en curso;
    - 400 si ARCA rechaza;
    - 502 si no hay conexión.
  - `asientoVenta(c, renglones, cuentas): RenglonAsiento[]`: función pura con el ajuste de redondeo al renglón mayor (spec 6.1);
  - un hook para la Task 7: `EmisionService` llama a `AplicacionesService.aplicarNcAlAutorizar(tx, comprobante)` si existe. En esta task se deja la llamada detrás de una interfaz opcional inyectada con `@Optional()`.

- [ ] **Step 1: Write the failing tests:**
  - **Emitir FC A:** `estado 'AUTORIZADO'`, `numero 1`, CAE de 14 dígitos.
    - Movimiento de cuenta corriente origenTipo `VENTA`, importe = total.
    - Asiento: DEUDORES_POR_VENTAS al debe por el total; VENTAS y IVA_DEBITO_FISCAL al haber; balanceado.
  - **Correlativos:** la segunda FC A da `numero 2`.
  - **USD:** factura en USD con cotización 1000 → `totalPesos` = total×1000, y el asiento en pesos.
  - **Review Focus 5:** los renglones del caso mixto de la Task 1, emitidos → `AUTORIZADO`, total 428.30, asiento balanceado.
  - **Rechazo:** `forzarFalla('RECHAZO')` → 400 "ARCA rechazó el comprobante: (…)", estado `RECHAZADO`, `numeroReservado null`. Después se edita y se emite → OK.
  - **Sin conexión:** `forzarFalla('SIN_CONEXION')` → 502 con el mensaje, estado `PENDIENTE_CAE`, `numeroReservado 1`. El reintento → `AUTORIZADO numero 1`.
  - **Review Focus 1:**
    1. `forzarFalla('AUTORIZA_SIN_RESPONDER')` en el comprobante X → 502, pero el simulador ya tiene el 1;
    2. se emite otro Y → `numero 2`;
    3. el reintento de X → `AUTORIZADO numero 1` con el CAE del simulador;
    4. el simulador tiene exactamente 2 comprobantes.
  - **Concurrencia:** 4 emisiones simultáneas de 4 comprobantes del mismo talonario, dentro de `Promise.all` y reintentando las 409 hasta 5 veces → números `[1,2,3,4]`, sin duplicados.
  - **Período cerrado:** con el mes de la fecha cerrado → 400 "El período MM/AAAA está cerrado", y no se llama a ARCA (el simulador no tiene comprobantes).
  - **Autorizado:** DELETE y PUT de un `AUTORIZADO` → 400 "Un comprobante autorizado no se anula: emita una nota de crédito".
  - **Review Focus 4:**
    - FC por 1.210 con un recibo parcial simulado (un movimiento de cobro aplicado manualmente con prisma a 210);
    - una NC de 1.000 → OK;
    - otra NC de 0,01 → 400 "La nota de crédito supera el saldo de la factura 0001-00000001".
- [ ] **Step 2: Run** `npx jest test/ventas-emision`. Expected: FAIL.
- [ ] **Step 3: Implement** los tres pasos de la spec 3.5, con el talonario ARCA de clave `ARCA-<cbteTipo>` en `Talonario.tipoComprobante` y el `puntoVenta` (bloqueado con `bloquear(tx,'Talonario',…)` después de crearlo si no existe).
  - **Recuperación:** se consulta `numeroReservado` cuando no es nulo y es ≤ N. La comparación es docNro, fecha, total y moneda.
  - **Período cerrado entre el paso 1 y el 3:** el asiento se fecha el primer día del primer período abierto siguiente, con una advertencia.
- [ ] **Step 4: Run.** Expected: PASS. Después correr `npx jest` completo.
- [ ] **Step 5: Commit** `feat(ventas): emisión con CAE, recuperación y asiento`.

### Task 6: PDF con QR

**Files:**
- Create: `apps/api/src/ventas/pdf/pdf-venta.ts`, `apps/api/test/ventas-pdf.e2e-spec.ts`.
- Modify: `comprobantes.controller.ts` (`GET :id/pdf`).

**Interfaces:**
- Consumes: `urlQrArca` (Task 1). Usa el mismo patrón que `exportar.ts` de la Entrega 5: sin `compress` en test.
- Produces: `GET /api/ventas/comprobantes/:id/pdf` → `application/pdf`. Un comprobante no autorizado da 400 "El comprobante no tiene CAE".

- [ ] **Step 1: Write the failing tests:**
  - el PDF de una FC A autorizada contiene, leyendo el texto con el helper de la Entrega 5:
    - "FACTURA", "A", "Cód. 01", el número `0001-00000001`;
    - "CAE" y el CAE, "IVA 21%";
    - "SIN VALIDEZ FISCAL", porque es SIMULADO;
  - contiene una imagen (`/Subtype /Image`);
  - el PDF de una B no contiene "IVA 21%";
  - un pendiente → 400.
- [ ] **Step 2: Run** `npx jest test/ventas-pdf`. Expected: FAIL.
- [ ] **Step 3: Implement** el diseño de la spec 3.7. El QR va como PNG de `qrcode.toBuffer(url)`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ventas): PDF del comprobante con QR`.

### Task 7: Aplicación de cobros y diferencia de cambio

**Files:**
- Create: `apps/api/src/ventas/aplicaciones/{aplicaciones.service,aplicaciones.controller}.ts`, `apps/api/test/ventas-aplicaciones.e2e-spec.ts`.
- Modify:
  - `emision.service.ts` (enchufar `aplicarNcAlAutorizar`);
  - `apps/api/src/tesoreria/operaciones/ingresos.service.ts` (`anular` también rechaza si hay `AplicacionCobro` no anulada sobre sus movimientos, con el mensaje "El cobro fue aplicado a comprobantes: deshaga primero la aplicación").

**Interfaces:**
- Produces:
  - `AplicacionesService.aplicarEnTx(tx, d: { terceroId: string; fecha: Date; origenTipo: 'RECIBO'|'APLICACION'|'VENTA'; origenId: string; items: { creditoMovId: string; debitoMovId: string; importe: Dec }[] }): Promise<{ aplicaciones: AplicacionCobro[]; diferenciaCambio: Dec }>`:
    - no genera asiento; devuelve la diferencia total;
    - el que llama la contabiliza (el recibo en su asiento, la aplicación en el suyo).
  - `AplicacionesService.revertirEnTx(tx, origenTipo, origenId)`: restituye saldos y marca anuladas;
  - `AplicacionesService.aplicarNcAlAutorizar(tx, nc)`;
  - **endpoints:**
    - `POST /api/ventas/aplicaciones` `{ terceroId, fecha, items }`, que genera el asiento `APLICACION_COBRO` solo si hay diferencia;
    - `POST /api/ventas/aplicaciones/:id/anular`, que deshace toda la operación con ese `origenId`;
    - `GET /api/ventas/clientes/:id/pendientes` → `{ creditos: Mov[], debitos: Mov[] }` con saldo distinto de 0;
  - permiso `cobro.registrar`.

- [ ] **Step 1: Write the failing tests:**
  - **NC:** una NC con `aplicarAAsociado` deja la factura con saldo = total − NC, y la NC con saldo 0.
  - **Cobro de Tesorería:** un ingreso CLIENTE de 4A por 500 se aplica a una factura de 1.210 → saldo 710.
    - **Review Focus 2:** después, anular ese ingreso desde Tesorería → 400 con el mensaje nuevo.
  - **Monedas:**
    - factura en USD 100 a cotización 1000 (pesos 100.000) y un crédito ARS de 105.000, aplicado por 100 USD con la cotización del día en 1050 → factura con saldo 0 en USD y 0 en pesos, diferencia de cambio +5.000 y asiento DEUDORES_POR_VENTAS 5.000 al debe contra DIFERENCIA_CAMBIO_POSITIVA al haber;
    - el mismo caso con la cotización en 950 → diferencia −5.000;
    - **Review Focus 3:** factura en USD 100 a 1000; dos aplicaciones de 50 USD, a 1100 y a 900 → saldo 0/0, y la diferencia total es +0 (5.000 − 5.000), con los dos asientos que suman cero;
    - débito ARS con crédito USD → 400 "La moneda del crédito no coincide con la del comprobante".
  - **Límites:** importe mayor al saldo → 400 "El importe supera el saldo disponible".
  - **Deshacer:** restituye los saldos exactos y genera el contraasiento de la diferencia.
- [ ] **Step 2: Run** `npx jest test/ventas-aplicaciones`. Expected: FAIL.
- [ ] **Step 3: Implement** la spec 5.2 y 5.3.
  - **Proporciones en pesos:** pesos del débito = importe × saldoPesos/saldo, redondeado a 2. Si el importe es igual a todo el saldo, se usa el saldoPesos completo, para no dejar centavos.
  - **Bloqueo:** `bloquear(tx,'MovimientoCuentaCorriente',…,ids)`.
- [ ] **Step 4: Run.** Expected: PASS. Después correr `npx jest test/tesoreria`.
- [ ] **Step 5: Commit** `feat(ventas): aplicación de cobros con diferencia de cambio`.

### Task 8: Recibos

**Files:**
- Create: `apps/api/src/ventas/recibos/{dto,recibos.service,recibos.controller}.ts`, `apps/api/test/ventas-recibos.e2e-spec.ts`.
- Modify: `ingresos.service.ts`: extraer `crearEnTx(tx, d: DatosIngreso, o?: { sinAsiento?: boolean; sinCuentaCorriente?: boolean }): Promise<{ ingreso: IngresoValores; renglones: RenglonAsiento[] }>` y `anularEnTx(tx, id, motivo, o?: { sinAsiento?: boolean })`.
  - `crear` y `anular` pasan a usarlos, con el mismo comportamiento de antes. Los tests de tesorería tienen que seguir verdes.
  - Los renglones devueltos son los del debe de los valores.

**Interfaces:**
- Consumes: `IngresosService.crearEnTx/anularEnTx`; `AplicacionesService.aplicarEnTx/revertirEnTx` (Task 7); `NumeracionService.siguiente(tx,'RECIBO',puntoVenta.numero)`.
- Produces:
  - `POST /api/ventas/recibos` `{ terceroId, fecha, puntoVentaId, cajaId, efectivo, cheques, transferencias, retenciones: { tipo, jurisdiccion?, numeroCertificado, fecha, importe }[], aplicaciones: { comprobanteId, importe }[] }`;
  - `POST /api/ventas/recibos/:id/anular` `{ motivo }`;
  - `GET /api/ventas/recibos/:id`;
  - permiso `cobro.registrar`.

- [ ] **Step 1: Write the failing tests:**
  - **Recibo completo:** efectivo 100, un cheque de 800, una transferencia de 200, retención IIBB 901 por 50 y retención Ganancias por 60 (total 1.210), aplicado 1.000 a una FC de 1.210:
    - factura con saldo 210;
    - movimiento del recibo con saldo −210;
    - el cheque está en cartera;
    - asiento: caja, valores a depositar y transferencias al debe; RETENCION_SUFRIDA_IIBB 50 y RETENCION_SUFRIDA_GANANCIAS 60 al debe; DEUDORES 1.210 al haber;
    - balanceado;
    - número de recibo 1 en ese punto de venta.
  - **Validaciones:**
    - aplicar más que el total → 400 "Lo aplicado supera el total del recibo";
    - total 0 → 400;
    - IIBB sin jurisdicción → 400 campo `retenciones.0.jurisdiccion`.
  - **Anulación:**
    - anular → factura con saldo 1.210, cheque fuera de cartera (anulado), contraasiento, estado ANULADO;
    - anular con el cheque ya depositado → 400 con el mensaje de 4A;
    - **Review Focus 2:** el saldo de −210 aplicado a otra factura con la pantalla de Aplicación, y luego anular el recibo → 400 "El saldo del recibo fue aplicado: deshaga primero la aplicación".
  - **Integración con Tesorería:** el ingreso de valores del recibo **no** tiene asiento propio ni movimiento de cuenta corriente propio.
- [ ] **Step 2: Run** `npx jest test/ventas-recibos`. Expected: FAIL.
- [ ] **Step 3: Implement** la spec 4.2 y 4.3. La diferencia de cambio de las aplicaciones va en el mismo asiento del recibo.
- [ ] **Step 4: Run.** Expected: PASS. Después correr `npx jest` completo.
- [ ] **Step 5: Commit** `feat(ventas): recibos con valores y retenciones sufridas`.

### Task 9: Consultas y origen en el Diario

**Files:**
- Create: `apps/api/src/ventas/consultas/*`, `apps/api/test/ventas-consultas.e2e-spec.ts`.
- Modify: `apps/api/src/contabilidad/consultas/consultas.service.ts` (`rutaOrigen`).

**Interfaces:**
- Produces:
  - `GET /api/ventas/comprobantes?terceroId&desde&hasta&tipo&estado&puntoVentaId&pagina` → `{ items, total }`, con `saldo` en cada ítem;
  - `GET /api/ventas/comprobantes/:id`;
  - `GET /api/ventas/recibos?…`;
  - `GET /api/ventas/clientes/:id/cuenta-corriente?desde&hasta` → `{ saldoAnterior, movimientos: { fecha, tipo, numero, debe, haber, saldo }[], pendientes: { comprobante, vence, diasVencido, saldo }[] }`;
  - `GET /api/ventas/saldos?fecha` → `{ filas: { terceroId, razonSocial, saldo, noVencido, d1a30, d31a60, d61a90, mas90 }[] }`;
  - permiso `venta.ver`.

- [ ] **Step 1: Write the failing tests:**
  - **Cuenta corriente:** con FC 1.210, recibo 1.000 y NC 100 → movimientos con el saldo acumulado 1.210, 210, 110; `pendientes[0].saldo '110'`.
  - **Antigüedad:** una factura vencida hace 45 días va en `d31a60`.
  - **Aislamiento:** un cliente de otra empresa → 404.
  - **Diario:** muestra `origen.ruta` `/ventas/comprobantes?id=…` en el asiento de la factura y `/ventas/recibos?id=…` en el del recibo.
- [ ] **Step 2: Run** `npx jest test/ventas-consultas`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ventas): consultas y cuenta corriente de clientes`.

### Task 10: Pantallas web

**Files:**
- Create: `apps/web/src/ventas/*` (ver estructura) y `apps/web/src/ventas/ComprobanteVentaPage.test.tsx`.
- Modify:
  - `apps/web/src/layout/menu.ts`: reemplazar los dos `proximamente('Ventas y Cuentas a Cobrar')` y agregar "Configuración ARCA" en Administración;
  - `apps/web/src/paginas/rutas.tsx`;
  - `apps/web/src/paginas/RolesPage.tsx` (grupo Ventas);
  - el maestro de terceros (tipo de documento) y el de puntos de venta (electrónico, sucursal).

**Interfaces:**
- Consumes: los endpoints de las Tasks 3 a 9; `letraVenta`, `calcularVenta` (Task 1); los componentes de valores de `IngresoValoresPage` y `SelectorCheques` de Tesorería.
- Produces las rutas:
  - `/ventas/comprobante`, `/ventas/recibo`, `/ventas/aplicacion`;
  - `/ventas/comprobantes`, `/ventas/recibos`, `/ventas/cuenta-corriente`, `/ventas/saldos`;
  - `/admin/arca`.

- [ ] **Step 1: Write the failing tests** (Vitest):
  - `ComprobanteVentaPage.test.tsx`:
    - elegir un cliente RI con la empresa RI muestra "Factura A";
    - cargar los renglones del caso mixto muestra el total "428,30";
    - una respuesta 502 del emitir muestra el mensaje y el botón "Reintentar".
  - `menu.test.ts`: con `venta.emitir`, Registraciones › Ventas y Cuentas a Cobrar tiene "Comprobante de venta".
- [ ] **Step 2: Run** `cd apps/web && npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement** las pantallas de la spec 8.
  - **Recibo:** "Aplicar automático" reparte el total entre los pendientes de la fecha de vencimiento más vieja a la más nueva.
  - **Configuración ARCA:** carga los dos archivos como texto y muestra un aviso naranja si `venceProximo`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit -p tsconfig.json`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): pantallas de ventas, recibos y configuración ARCA`.

### Task 11: Demo, punta a punta y documentación

**Files:**
- Modify: `apps/api/src/seed/*` (punto de venta 0002 electrónico, clientes, rol y usuario Facturación, factura A de servicios emitida en SIMULADO y cobrada parcialmente), `apps/api/test/seed.e2e-spec.ts`, `playwright.config.ts` (si hace falta), `README.md` (sección Entrega 6: modos ARCA, cómo cargar el certificado de homologación, `ARCA_CLAVE_MAESTRA`).
- Create: `e2e/ventas.spec.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `seed.e2e-spec`: la demo tiene una factura AUTORIZADA con CAE, un recibo y el usuario `facturacion@demo.com`.
  - `e2e/ventas.spec.ts`, como `facturacion@demo.com`:
    1. factura B a "Consumidor Final" por 1 renglón libre "Servicio de prueba" de 12.100 al 21%;
    2. Emitir → se ve "Autorizado" y el CAE;
    3. Descargar PDF → la descarga existe y empieza con `%PDF`;
    4. Recibo con un cheque de 12.000 y una retención IIBB 901 por 100, "Aplicar automático" y Confirmar;
    5. en la Cuenta corriente de Consumidor Final, el saldo es "0,00".
- [ ] **Step 2: Run** `cd apps/api && npx jest test/seed`. Después recrear gestion_e2e y correr `pnpm e2e -- --trace off`. Expected: FAIL.
- [ ] **Step 3: Implement** el seed y el README.
- [ ] **Step 4: Run** los mismos comandos más `npx jest` completo y `npx vitest run`. Expected: todo PASS.
- [ ] **Step 5: Commit** `feat(ventas): datos de demo, e2e y documentación`.
