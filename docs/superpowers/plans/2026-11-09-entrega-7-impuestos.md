# Entrega 7: Libros IVA, control con ARCA y presentaciones. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Libros IVA Ventas y Compras (pantalla, Excel y PDF); archivos del Libro IVA Digital, SICORE, ARBA A-122R y AGIP e-ARCIBA con historial y aviso de cambios; y control contra el CSV de "Mis Comprobantes".

**Architecture:**
- Módulo Nest `impuestos` con estas piezas:
  - un escritor de ancho fijo que recibe tablas de campos declarativas, una por diseño oficial (`formato/`);
  - recolectores por impuesto que leen Ventas, Compras y Pagos y devuelven registros (`libros-iva/`, `retenciones/`);
  - un servicio de presentaciones que genera, guarda el archivo con su huella sha256 y recalcula para avisar cambios;
  - el control con ARCA (`control-arca/`).
- Los diseños oficiales están en `docs/superpowers/specs/referencias/entrega-7/`, y cada tabla de campos se copia de ahí.

**Tech Stack:** la de siempre (NestJS, Prisma, exceljs, pdfkit, React y Mantine). Dependencia nueva en `apps/api`: `jszip` (ZIP del Libro IVA Digital y de ARBA; también se usa en las pruebas para leerlos).

**Spec:** `docs/superpowers/specs/2026-11-09-entrega-7-impuestos-design.md`

## Global Constraints

- **Multi-empresa:** los modelos nuevos llevan `empresaId`, van en `MODELOS_DE_EMPRESA` y se acceden vía `TenantPrisma`. Mensajes en castellano y auditoría en cada generación.
- **Permisos nuevos** en `packages/shared/src/permisos.ts`:
  - `impuestos.ver`: 'Ver libros IVA y presentaciones';
  - `impuestos.presentar`: 'Generar presentaciones impositivas y controlar con ARCA'.

  Una migración se los da al rol Administrador, y el seed también al rol Contador.
- **Rutas:** `/api/impuestos/...`. El endpoint actual `/api/compras/libro-iva` se conserva.
- **Archivos:** líneas con CRLF y CRLF final; codificación latin1; cada línea con el largo exacto de su diseño.
- **Largos por diseño:**

| Diseño | Largo |
|---|---|
| Ventas cabecera | 266 |
| Ventas alícuotas | 62 |
| Compras cabecera | 325 |
| Compras alícuotas | 84 |
| SICORE | 145 |
| ARBA alta | 67 |
| AGIP | 215 |

- **Mensajes exactos:**
  - "Complete la situación de Ingresos Brutos de: A, B";
  - "Al CSV le faltan las columnas: X, Y";
  - "No hay retenciones de Ganancias en MM/AAAA";
  - "Los datos del período cambiaron desde la generación del dd/mm/aaaa: corresponde rectificar";
  - aviso de ARBA: "ARBA emite el comprobante de retención al procesar el lote (RN 22/25): entregue al proveedor el de ARBA."
- **Configuración por defecto (`ConfigImpuestos`):**
  - `arbaActividad '6'`, `arbaSucursal 1`, `arbaPeriodicidad 'MENSUAL'`;
  - `agipCodigoNorma '029'`.

## Review Focus

1. **Razón social con ñ, tildes, comillas o más de 30 caracteres** → el archivo sale en latin1 sin acentos raros, el largo de la línea se mantiene y hay una advertencia de recorte. Test en la Task 1 (escritor) y en la Task 5 (AGIP con "Muñoz & Peña \"La Única\" Sociedad Anónima Comercial").
2. **NC de venta y de compra en el Libro IVA Digital** → importes positivos con el código 003/008; en el libro en pantalla restan. Test en las Tasks 3 y 4.
3. **Factura en USD en el Libro IVA Digital** → moneda `DOL`, tipo de cambio `0001000000` para 1000 y los importes en dólares. En el libro en pantalla, en pesos. Test en la Task 4.
4. **Período sin movimientos** → cada generación devuelve 201 con el archivo vacío (o con 0 líneas) y una advertencia, nunca 500. Test en las Tasks 4 y 5.
5. **CSV con BOM, columnas en otro orden e importes "1.234,56"; CSV que no es de Mis Comprobantes** → se lee bien; el segundo da 400 con las columnas faltantes. Test en la Task 6.

---

## Estructura de archivos

```
apps/api/src/impuestos/
  formato/        escritor.ts (+ .spec), campos.ts (tipos), formatos.ts (tablas de los 7 diseños, + .spec)
  codigos.ts      tablas de códigos ARCA para compras/ventas/alícuotas/documentos, CODIGO_OPERACION
  config/         config-impuestos.service.ts, config-impuestos.controller.ts
  libros-iva/     libro-ventas.service.ts, libros.controller.ts, libro-iva-digital.ts
  retenciones/    sicore.ts, arba.ts, agip.ts
  presentaciones/ presentaciones.service.ts, presentaciones.controller.ts
  control-arca/   lector-mis-comprobantes.ts (+ .spec), control-arca.service.ts, control-arca.controller.ts
  impuestos.module.ts
apps/web/src/impuestos/   LibrosIvaPages.tsx, PresentacionesPages.tsx, ControlArcaPage.tsx, ConfigImpuestosPage.tsx
e2e/impuestos.spec.ts
```

---

### Task 1: Escritor de ancho fijo y diseños oficiales

**Files:**
- Create: `apps/api/src/impuestos/formato/{campos,escritor,formatos}.ts`, `escritor.spec.ts`, `formatos.spec.ts`, `apps/api/src/impuestos/codigos.ts`.

**Interfaces:**
- Produces:
  - **`campos.ts`:**
    ```ts
    type Campo =
      | { nombre: string; largo: number; tipo: 'NUM' }
      | { nombre: string; largo: number; tipo: 'TXT' }
      | { nombre: string; largo: number; tipo: 'IMPORTE'; decimales?: number; separador: '' | ',' | '.' }
      | { nombre: string; largo: number; tipo: 'FECHA'; formato: 'AAAAMMDD' | 'DD/MM/AAAA' }
      | { nombre: string; largo: number; tipo: 'FIJO'; valor: string };
    ```
    Más `type Valor = string | number | Date | null | undefined`.
  - **`escritor.ts`:**
    - `class ErrorFormato extends Error`, con `campo` y `valor`;
    - `linea(campos: Campo[], valores: Record<string, Valor>, registro?: number): { texto: string; advertencias: string[] }`;
    - `archivo(lineas: string[]): Buffer` (latin1, CRLF entre líneas y al final; vacío si no hay líneas);
    - `sinAcentos(s: string): string`.
  - **`formatos.ts`:** las constantes `LIVA_VENTAS_CBTE`, `LIVA_VENTAS_ALICUOTAS`, `LIVA_COMPRAS_CBTE`, `LIVA_COMPRAS_ALICUOTAS`, `SICORE`, `ARBA_ALTA`, `AGIP_RETENCION`, todas de tipo `Campo[]`. Los campos y largos son los de la spec (secciones 4 y 6) y los de las referencias, en el mismo orden y con los mismos nombres en camelCase.
  - **`codigos.ts`:**
    - `codigoCompra(tipo: 'FACTURA'|'NOTA_DEBITO'|'NOTA_CREDITO'|'TICKET', letra: string): number`;
    - `ALICUOTA_LIVA: Record<string, string>` (`'0'→'0003'`, `'10.5'→'0004'`, `'21'→'0005'`, `'27'→'0006'`, `'5'→'0008'`, `'2.5'→'0009'`);
    - `documentoArca(tipoDocumento: 'CUIT'|'DNI'|'OTRO'): { codigo: number; numero: (doc: string) => string }`;
    - `codigoOperacion(gravado: boolean, exento: boolean, noGravado: boolean): ' ' | 'E' | 'N'`.

- [ ] **Step 1: Write the failing tests**
  - **`escritor.spec.ts`:**
    - **NUM:** `NUM` 5 con 42 → `'00042'`; 123456 en 5 lanza `ErrorFormato` con `campo`.
    - **TXT:** 6 con `'Peña'` → `'Pena  '`.
    - **TXT largo:** 4 con `'Sociedad'` recorta a `'Soci'` y devuelve la advertencia "El campo X (4) del registro 3 se recortó".
    - **IMPORTE:**
      - largo 15, separador `''`, con `'1234.5'` → `'000000000123450'`;
      - largo 16, separador `','`, con `'50'` → `'0000000000050,00'`;
      - largo 5, separador `'.'`, con `'3.5'` → `'03.50'`;
      - un negativo lanza.
    - **FECHA:** AAAAMMDD con `new Date('2026-11-05T00:00:00Z')` → `'20261105'`; DD/MM/AAAA nula → 10 espacios.
    - **`archivo`:** `archivo(['ab','cd'])` es `Buffer` latin1 `'ab\r\ncd\r\n'`.
  - **`formatos.spec.ts`:**
    - la suma de largos de cada diseño: 266, 62, 325, 84, 145, 67, 215;
    - cada nombre de campo es único dentro de su diseño;
    - la línea de AGIP para el registro de ejemplo: posiciones 1, 2-4, 5-14, 15-16, 17, 179-183 y 184-199 tienen `1`, `029`, `05/11/2026`, `03`, `' '`, `03,00` y `0000000000030,00`.
- [ ] **Step 2: Run** `cd apps/api && npx jest src/impuestos/formato`. Expected: FAIL (módulos inexistentes).
- [ ] **Step 3: Implement** los archivos.
  - En `sinAcentos` se usa `normalize('NFD')` y se quitan los diacríticos. Se reemplaza todo carácter fuera de 0x20 a 0x7E por un espacio. Las comillas dobles se conservan.
  - Los nombres de campo de los diseños son los de las tablas de la spec. Por ejemplo, en SICORE: `codigoComprobante`, `fechaComprobante`, `numeroComprobante`, `importeComprobante`, `codigoImpuesto`, `codigoRegimen`, `codigoOperacion`, `baseCalculo`, `fechaRetencion`, `codigoCondicion`, `suspendidos`, `importeRetencion`, `porcentajeExclusion`, `fechaBoletin`, `tipoDocumento`, `numeroDocumento`, `certificadoOriginal`.
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat(impuestos): escritor de ancho fijo y diseños oficiales`.

### Task 2: Esquema, configuración, datos de IIBB y permisos

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/src/prisma/modelos-empresa.ts`, `packages/shared/src/permisos.ts`, `apps/api/src/terceros/dto.ts`, `apps/api/src/app.module.ts`.
- Create: migración `20261110090000_impuestos`, `apps/api/src/impuestos/config/*`, `apps/api/src/impuestos/impuestos.module.ts`, `apps/api/test/impuestos-config.e2e-spec.ts`.
- Dependencia: `pnpm --filter @gestion/api add jszip`.

**Interfaces:**
- Produces:
  - **Enums Prisma:**
    - `SituacionIibb {LOCAL CONVENIO NO_INSCRIPTO SIMPLIFICADO}`;
    - `TipoPresentacion {LIBRO_IVA_DIGITAL SICORE ARBA AGIP}`;
    - `PeriodicidadArba {MENSUAL QUINCENAL}`.
  - **Tercero:** `situacionIibb SituacionIibb?`, `numeroIibb String?`.
  - **Modelos:**
    - `ConfigImpuestos {empresaId @unique, arbaActividad String @default("6"), arbaSucursal Int @default(1), arbaPeriodicidad @default(MENSUAL), agipCodigoNorma String @default("029")}`;
    - `Presentacion {id, empresaId, tipo, periodo String /*AAAAMM*/, quincena Int @default(0), nombreArchivo, contenido Bytes, registros Int, total Decimal(18,2), huella String, advertencias Json, generadoPor, generadoEn @default(now())}` con `@@index([empresaId, tipo, periodo])`.
  - **`ConfigImpuestosService`:**
    - `obtener(tx?)`: crea con valores por defecto si no existe;
    - `guardar(d)`.
  - **Endpoints:**
    - `GET /api/impuestos/config` (`impuestos.ver`);
    - `PUT /api/impuestos/config` (`impuestos.presentar`).

- [ ] **Step 1: Write the failing test** (`impuestos-config.e2e-spec.ts`):
  - `GET config` → `{ arbaActividad: '6', arbaSucursal: 1, arbaPeriodicidad: 'MENSUAL', agipCodigoNorma: '029' }`;
  - `PUT` con `arbaPeriodicidad: 'QUINCENAL'` → 200 y persiste;
  - sin `impuestos.presentar`, `PUT` da 403;
  - el rol Administrador de una empresa nueva tiene `impuestos.ver` e `impuestos.presentar`;
  - `PATCH /api/terceros/:id` con `{ situacionIibb: 'CONVENIO', numeroIibb: '9011234567' }` → 200, y el GET lo devuelve;
  - una `situacionIibb` inválida da 400.
- [ ] **Step 2: Run** `npx jest test/impuestos-config`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Migración:** se genera con `migrate diff` y se le agrega a mano la actualización de permisos del rol `Administrador`. Se aplica a gestion y gestion_test, y el diff de drift tiene que quedar vacío.
  - **DTO de terceros:** se agregan `situacionIibb: z.nativeEnum(SituacionIibb).nullish()` y `numeroIibb: z.string().trim().max(20).nullish()`.
- [ ] **Step 4: Run** el test y `npx jest test/terceros test/ventas-maestros`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(impuestos): configuración, datos de IIBB y permisos`.

### Task 3: Libros IVA Ventas y Compras

**Files:**
- Create: `apps/api/src/impuestos/libros-iva/{libro-ventas.service,libros.controller}.ts`, `apps/api/test/impuestos-libros.e2e-spec.ts`.

**Interfaces:**
- Consumes: `ConsultasComprasService.libroIva(desde, hasta)` (existente); `tablaXlsx` y `tablaPdf` de `contabilidad/consultas/exportar.ts`; `saldosPorCuenta` o una suma directa de `AsientoRenglon` por cuenta y rango.
- Produces:
  - `LibroVentasService.libro(desde: string, hasta: string): Promise<{ filas: FilaLibroVentas[]; totales: TotalesLibro; advertencias: string[] }>`. Cada fila tiene:
    `{ fecha, comprobante /*"Factura A 0001-00000001"*/, cliente, documento, condicionIva, netoPorAlicuota: Record<string,string>, ivaPorAlicuota: Record<string,string>, noGravado, exento, total }`.
    Todo en pesos con 2 decimales; las NC en negativo.
  - **Endpoints:**
    - `GET /api/impuestos/libro-iva-ventas?desde&hasta&formato` y `GET /api/impuestos/libro-iva-compras?desde&hasta&formato`;
    - `formato` es `json` (por defecto), `xlsx` o `pdf`;
    - la compra devuelve lo de Compras más `advertencias`;
    - permiso `impuestos.ver`.
  - `cuadreIva(tx, concepto: 'IVA_DEBITO_FISCAL'|'IVA_CREDITO_FISCAL', desde, hasta): Promise<Dec>`: el movimiento del período en la cuenta, con signo natural.

- [ ] **Step 1: Write the failing tests** (`prepararVentas` de `helpers-ventas` y `facturaPendiente` de `helpers`):
  - **Ventas:**
    - FC A con renglones al 21% (1.000) y al 10,5% (500), FC B a CF (1.000 al 21%), NC A por 100 exento, FC USD 100 exenta a cotización 1000 y una FC C → no aplica (la empresa es RI): se omite;
    - el libro de noviembre tiene 4 filas en orden;
    - `netoPorAlicuota['21']` total = `'1826.45'`. Sale de 1.000 + 1.000/1,21 = 826,45, porque la B informa el neto;
    - la NC tiene `total '-100.00'`;
    - la factura en USD tiene `exento '100000.00'`;
    - `advertencias` vacío, porque el IVA del libro es igual al del Mayor de 2.1.02.001.
  - **Compras:** con una factura de proveedor de neto 1.000, `GET libro-iva-compras` → `filas[0].ivaPorAlicuota['21'] === '210.00'`, sin advertencias.
  - **Excel y PDF:** `formato=xlsx` → `content-type` de spreadsheet; `formato=pdf` → empieza con `%PDF`.
  - **Cuadre:** con un asiento manual de 50 a la cuenta 2.1.02.001 en el período, el libro de ventas trae la advertencia "El IVA del libro (…) difiere del Mayor de la cuenta 2.1.02.001 (…)".
  - **Review Focus 2:** la NC resta en el libro en pantalla, ya cubierto arriba.
- [ ] **Step 2: Run** `npx jest test/impuestos-libros`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Pesos:** cada importe × cotización del comprobante, redondeado a 2. El total en pesos es `totalPesos`, para que coincida con el asiento.
  - **Columnas fijas del Excel y PDF:** 21, 10,5, 27, 5, 2,5 y 0, cada una con su neto e IVA, más no gravado, exento y total.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(impuestos): libros IVA ventas y compras`.

### Task 4: Presentaciones y Libro IVA Digital

**Files:**
- Create: `apps/api/src/impuestos/libros-iva/libro-iva-digital.ts`, `apps/api/src/impuestos/presentaciones/*`, `apps/api/test/impuestos-libro-digital.e2e-spec.ts`.

**Interfaces:**
- Consumes: `linea`, `archivo` y los formatos `LIVA_*` (Task 1); `codigoCompra`, `ALICUOTA_LIVA`, `documentoArca` y `codigoOperacion` (Task 1); `cbteTipo` y `docTipoArca` de `@gestion/shared`.
- Produces:
  - `type Generado = { nombreArchivo: string; contenido: Buffer; registros: number; total: Dec; huellaDe: Buffer; advertencias: string[] }`. `huellaDe` es el contenido que se compara: el TXT interno en ARBA, el ZIP completo en el resto.
  - `libroIvaDigital(tx, empresa, periodo: string): Promise<Generado>`. Arma un ZIP con jszip, con `VENTAS_CBTE.txt`, `VENTAS_ALICUOTAS.txt`, `COMPRAS_CBTE.txt` y `COMPRAS_ALICUOTAS.txt`, y lo genera con `date` fija (`new Date('2000-01-01')`) para que la huella sea estable.
  - `PresentacionesService`:
    - `generar(d: { tipo; periodo: string; quincena?: number })`;
    - `listar(f: { tipo?; periodo? })`: cada fila con `cambiaron: boolean` en la generación más reciente de su (tipo, período, quincena);
    - `archivo(id)`.

    Los generadores se registran en un mapa `tipo → (tx, ctx) => Generado`; las Tasks 5 y 6 agregan los suyos.
  - **Endpoints:**
    - `POST /api/impuestos/presentaciones` (`impuestos.presentar`): devuelve `{ id, nombreArchivo, registros, total, advertencias }`;
    - `GET /api/impuestos/presentaciones` y `GET /:id/archivo` (`impuestos.ver`).
  - Validación del período: `/^\d{6}$/`; mes de 01 a 12; quincena 1 o 2 solo en SICORE y en ARBA.

- [ ] **Step 1: Write the failing tests:**
  - **El ZIP:** generar el LIBRO_IVA_DIGITAL de 202611 con los comprobantes de la Task 3 y una compra A.
    - Leer el ZIP con jszip: hay 4 archivos;
    - todas las líneas de `VENTAS_CBTE.txt` miden 266, las de `VENTAS_ALICUOTAS.txt` 62, las de `COMPRAS_CBTE.txt` 325 y las de `COMPRAS_ALICUOTAS.txt` 84;
    - hay 4 cabeceras de venta;
    - las líneas terminan en `\r\n`.
  - **Primera venta** (FC A): `slice(0,8)` = `'20261102'`, `slice(8,11)` = `'001'`, `slice(241,242)` (cantidad de alícuotas) = `'2'`.
  - **Review Focus 2:** la cabecera de la NC tiene tipo `'003'` y el importe total `slice(108,123)` = `'000000000010000'`, positivo.
  - **Review Focus 3:** la cabecera de la factura en USD tiene `slice(228,231)` = `'DOL'`, `slice(231,241)` = `'0001000000'` y el total `'000000000010000'`. La exenta tiene código de operación `slice(242,243)` = `'E'` y un registro de alícuota `0003` con neto 0.
  - **Totales:** la suma de los totales de las cabeceras de compras, leída de vuelta, coincide con el total del libro de compras.
  - **Review Focus 4:** el LIBRO_IVA_DIGITAL de 202602 (sin movimientos) → 201, `registros: 0`, archivos vacíos y la advertencia "No hay comprobantes en 02/2026".
  - **Historial:**
    - `GET presentaciones` → `cambiaron: false`;
    - se carga otra compra en noviembre → `cambiaron: true`;
    - `GET /:id/archivo` devuelve exactamente los bytes originales (misma sha256).
  - **Permisos:** sin `impuestos.presentar`, `POST` → 403.
- [ ] **Step 2: Run** `npx jest test/impuestos-libro-digital`. Expected: FAIL.
- [ ] **Step 3: Implement** la spec, sección 4 y sección 7.
  - El nombre del ZIP es `LIBRO_IVA_DIGITAL_<CUIT>_<AAAAMM>.zip`.
  - El total de la presentación es la suma de los totales de las cabeceras de ventas más las de compras, en moneda de origen. Es solo un dato de control.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(impuestos): Libro IVA Digital e historial de presentaciones`.

### Task 5: SICORE, ARBA y AGIP

**Files:**
- Create: `apps/api/src/impuestos/retenciones/{sicore,arba,agip}.ts`, `apps/api/test/impuestos-retenciones.e2e-spec.ts`.
- Modify: `presentaciones.service.ts` (registra los 3 generadores).

**Interfaces:**
- Consumes: `linea`, `archivo`, `SICORE`, `ARBA_ALTA` y `AGIP_RETENCION` (Task 1); `ConfigImpuestosService.obtener` (Task 2); `Generado` y el registro de generadores (Task 4); `NumeracionService.siguiente(tx, 'ARBA-LOTE', 0)`.
- Produces:
  - `sicore(tx, empresa, periodo, quincena: 0|1): Promise<Generado>`;
  - `arba(tx, empresa, config, periodo, quincena: 0|1|2): Promise<Generado>`. El nombre es `ER-<CUIT>-<AAAAMMQ>-<actividad>-LOTE<nnnnn>.zip` con el TXT del mismo nombre adentro. `nnnnn` lo da el talonario y se toma solo al guardar; el recálculo del historial usa el mismo nombre que ya está guardado.
  - `agip(tx, empresa, config, periodo): Promise<Generado>`.
  - En los tres:
    - entran las retenciones de OP en estado `PAGADA`, no anuladas, con `certificadoNumero` no nulo y `fechaPago` en el período (o la quincena);
    - SICORE: `impuesto 'GANANCIAS'`;
    - ARBA: `IIBB` con jurisdicción `'902'`;
    - AGIP: `IIBB` con jurisdicción `'901'`.

- [ ] **Step 1: Write the failing tests** (con `helpers-pagos`, una OP pagada con retención de Ganancias régimen 78 y otra con IIBB 902 y 901, más una OP anulada):
  - **SICORE:**
    - 145 posiciones;
    - `slice(0,2)` = `'06'`, `slice(44,48)` = `'0217'`, `slice(48,51)` = `'078'`, `slice(51,52)` = `'1'`;
    - `slice(111,131).trimEnd()` = CUIT del proveedor;
    - el importe de retención `slice(79,93)` = el de la base, con coma, por ejemplo `'00000000123,45'`;
    - la anulada no aparece.
  - **SICORE por quincena:** con quincena 1, solo las retenciones de los días 1 a 15.
  - **SICORE vacío:** sin retenciones, 201 con la advertencia "No hay retenciones de Ganancias en 10/2026".
  - **ARBA:**
    - el nombre coincide con `/^ER-\d{11}-2026110-6-LOTE00001\.zip$/`;
    - adentro, una línea de 67;
    - `slice(0,20)` es el certificado con ceros;
    - `slice(46,51)` es la alícuota con punto;
    - una segunda generación usa `LOTE00002`.
  - **AGIP:**
    - con el proveedor sin situación de IIBB → 400 "Complete la situación de Ingresos Brutos de: <razón social>";
    - completada (CONVENIO, 9011234567) → 215 posiciones; `slice(87,88)` = `'2'`; `slice(88,99)` = `'09011234567'`.
  - **Review Focus 1:** la razón social del proveedor es `'Muñoz & Peña "La Única" Sociedad Anónima Comercial'`. `slice(100,130)` = `'Munoz & Pena "La Unica" Socied'`, la línea sigue midiendo 215 y la respuesta trae una advertencia de recorte.
- [ ] **Step 2: Run** `npx jest test/impuestos-retenciones`. Expected: FAIL.
- [ ] **Step 3: Implement** la spec, sección 6.
  - **SICORE:** `fechaComprobante` = `op.fecha`; `numeroComprobante` = `op.numero`; `importeComprobante` = `op.totalCancelarPesos`; condición `01` o `02` según `tercero.inscriptoGanancias`.
  - **AGIP:** situación de IVA según la condición: RESPONSABLE_INSCRIPTO→1, EXENTO→3, MONOTRIBUTO→4; cualquier otra da 400.
- [ ] **Step 4: Run.** Expected: PASS. Después correr `npx jest test/pagos`.
- [ ] **Step 5: Commit** `feat(impuestos): SICORE, ARBA A-122R y AGIP e-ARCIBA`.

### Task 6: Control con "Mis Comprobantes"

**Files:**
- Create: `apps/api/src/impuestos/control-arca/{lector-mis-comprobantes,control-arca.service,control-arca.controller}.ts`, `lector-mis-comprobantes.spec.ts`, `apps/api/test/impuestos-control-arca.e2e-spec.ts`.

**Interfaces:**
- Produces:
  - `leerMisComprobantes(buf: Buffer): { filas: FilaArca[] }`, donde
    `FilaArca = { fecha: string /*YYYY-MM-DD*/; tipo: number; puntoVenta: number; numero: number; documento: string; netoGravado: string; iva: string; total: string; moneda: string; tipoCambio: string }`.

    Lanza `BadRequestException("Al CSV le faltan las columnas: …")`. Acepta UTF-8 con BOM o latin1 (si el texto no es UTF-8 válido, se decodifica como latin1).
  - `ControlArcaService.controlar(d: { sentido: 'RECIBIDOS'|'EMITIDOS'; desde; hasta; archivo: Buffer }): { soloArca; soloSistema; diferencias; coinciden: number }`.
  - `POST /api/impuestos/control-arca` (multipart `archivo` más campos; con `?formato=xlsx` devuelve Excel) (`impuestos.presentar`).

- [ ] **Step 1: Write the failing tests:**
  - **Lector** (`lector-mis-comprobantes.spec.ts`):
    - **Básico:** encabezados `Fecha;Tipo;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Emisor;Nro. Doc. Emisor;Denominación Emisor;Tipo Cambio;Moneda;Imp. Neto Gravado;Imp. Neto No Gravado;Imp. Op. Exentas;IVA;Imp. Total` y una fila `05/11/2026;1 - Factura A;2;1532;1532;…;80;30711223343;Papelera;1;$;650.000,00;0;0;136.500,00;786.500,00`:
      - `tipo 1`, `numero 1532`, `total '786500.00'`, `fecha '2026-11-05'`.
    - **Variantes:** con BOM, separador `,` y columnas en otro orden (`"Imp. Total","Fecha de Emisión",...`, con comillas) → la misma fila.
    - **Faltantes (Review Focus 5):** un CSV con columnas `a;b;c` → lanza "Al CSV le faltan las columnas: Fecha, Tipo, Punto de Venta, Número Desde, Nro. Doc., Imp. Total". Los nombres canónicos van en ese orden; neto, IVA, moneda y tipo de cambio son opcionales.
  - **E2E** (`impuestos-control-arca.e2e-spec.ts`), con 3 facturas de proveedor cargadas (A 1532, A 1533 y A 1534):
    - un CSV de RECIBIDOS con 1532 igual, 1533 con total distinto y 1599, que no existe;
    - resultado: `coinciden 1`, `diferencias.length 1` (con los dos totales), `soloArca` = [1599], `soloSistema` = [1534];
    - con `formato=xlsx` → spreadsheet.
- [ ] **Step 2: Run** `npx jest src/impuestos/control-arca test/impuestos-control-arca`. Expected: FAIL.
- [ ] **Step 3: Implement** la spec, sección 5.
  - **Normalización de encabezados:** minúsculas, sin acentos, sin puntos y con los espacios colapsados.
  - **Tipo:** se toma el número inicial de `"1 - Factura A"`.
  - **Importes:** se aceptan `1.234,56`, `1234,56` y `1234.56`. La regla: si hay coma, el punto es separador de miles.
  - **Clave:**
    - recibidos: `documento|tipo|pv|numero`, con el CUIT del proveedor y `codigoCompra(tipo, letra)`;
    - emitidos: `tipo|pv|numero`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(impuestos): control contra Mis Comprobantes de ARCA`.

### Task 7: Pantallas web

**Files:**
- Create: `apps/web/src/impuestos/*` (ver estructura), `apps/web/src/impuestos/presentaciones.test.tsx`.
- Modify:
  - `layout/menu.ts`: rama "Impuestos" en Registraciones y en Consultas, y "Configuración de impuestos" en Administración;
  - `paginas/rutas.tsx`;
  - `paginas/RolesPage.tsx` (grupo `impuestos: 'Impuestos'`);
  - `paginas/TercerosPage.tsx` (Situación IIBB y Número IIBB en la pestaña de impuestos);
  - `api/cliente.ts`: `descargarPost(ruta, body, nombre)` si no existe. Hay uno en `contabilidad/comun.ts`: se reutiliza.

**Interfaces:**
- Produces las rutas:
  - `/impuestos/libro-iva-ventas`, `/impuestos/libro-iva-compras`, `/impuestos/presentaciones`;
  - `/impuestos/generar`, `/impuestos/control-arca`;
  - `/admin/impuestos`.

- [ ] **Step 1: Write the failing tests:**
  - `presentaciones.test.tsx`: `<TablaPresentaciones filas=[{…, cambiaron: true, generadoEn: '2026-11-05T…'}] />` muestra "Los datos del período cambiaron desde la generación del 05/11/2026: corresponde rectificar" y un botón "Descargar".
  - `menu.test.ts`: con `impuestos.presentar`, Registraciones › Impuestos tiene "Generar presentación" y "Control con ARCA".
- [ ] **Step 2: Run** `cd apps/web && npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Generar presentación:**
    - Select de impuesto, mes y año, y quincena (solo en SICORE y en ARBA quincenal);
    - al generar, muestra registros, total y advertencias, y descarga con `descargar('/impuestos/presentaciones/:id/archivo', …)`;
    - en ARBA, `Alert` con el aviso de la RN 22/25.
  - **Libros:** desde y hasta, tabla con columnas por alícuota, advertencias y botones Excel y PDF.
  - **Control con ARCA:** tres tablas con contadores y Excel.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit -p tsconfig.json`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): libros IVA, presentaciones y control con ARCA`.

### Task 8: Demo, punta a punta y documentación

**Files:**
- Modify:
  - `apps/api/src/seed/demo.ts`: el rol Contador con `impuestos.ver` e `impuestos.presentar`; los proveedores con régimen de IIBB, o todos los RI, con `situacionIibb` y `numeroIibb`;
  - `apps/api/test/seed.e2e-spec.ts`;
  - `README.md`: sección Entrega 7, con los archivos, la nota normativa (RG 5707, RG 5921, RN 22/25), "verificar la primera importación en cada aplicativo" y los valores a confirmar (actividad de ARBA, norma de AGIP, código de operación).
- Create: `e2e/impuestos.spec.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `seed.e2e-spec`: el rol Contador incluye `impuestos.presentar`, y todo proveedor RI tiene `situacionIibb`.
  - `e2e/impuestos.spec.ts`, como `contador@demo.com`:
    1. `/impuestos/generar`, impuesto "Libro IVA Digital", mes actual → Generar;
    2. se ve "registros" y la descarga es un `.zip`;
    3. luego "SICORE" → descarga un `.txt`;
    4. `/impuestos/presentaciones` muestra 2 filas.
- [ ] **Step 2: Run** `npx jest test/seed`. Después recrear gestion_e2e y correr `pnpm e2e -- --trace off`. Expected: FAIL.
- [ ] **Step 3: Implement** el seed y el README.
- [ ] **Step 4: Run** los mismos comandos, más `npx jest` completo y `npx vitest run`. Expected: todo PASS.
- [ ] **Step 5: Commit** `feat(impuestos): demo, e2e y documentación`.
