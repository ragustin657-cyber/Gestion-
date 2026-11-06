# Entrega 4B: Conciliación bancaria. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conciliación bancaria por período:
- formatos de extracto configurables por cuenta;
- importación de CSV y XLSX con detección de duplicados;
- vínculos de muchos a muchos entre líneas del extracto y movimientos de tesorería;
- sugerencias automáticas en tres pasadas;
- registro desde el extracto, con reglas que proponen la cuenta contable;
- cierre con bloqueo, reapertura y reporte en PDF y XLSX.

**Architecture:**
- Un módulo Nest `conciliacion` con estas piezas:
  - un intérprete puro de archivos (`interprete.ts`, sin base de datos, con pruebas unitarias);
  - servicios de formatos, importaciones, conciliaciones (alta, resumen y vínculos), sugerencias (función pura sobre listas), reglas, registro, cierre y reporte.
- Lo que se concilia son los `MovimientoTesoreria` que ya existen: se les agrega `vinculoId`.
- Cuando la conciliación está cerrada, el bloqueo se aplica en un helper compartido que llaman las anulaciones de la 4A y `registrarMovimiento`.

**Tech Stack:** la de las entregas anteriores. Para XLSX se usa exceljs, que ya está instalado, y para el PDF pdfkit. No hay dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-06-entrega-4b-conciliacion-design.md`

## Global Constraints

- **Multi-empresa:** todo modelo nuevo lleva `empresaId`, va en `MODELOS_DE_EMPRESA` y se accede vía `TenantPrisma`.
- **Importes:** `Decimal(18,2)` con signo. En las líneas del extracto, positivo es crédito; en los movimientos del sistema, INGRESO es positivo y EGRESO negativo. Aritmética con Decimal.
- **Auditoría** en cada escritura; mensajes en castellano; validación zod con 400 `{ message, campos }`.
- **Permisos:**
  - `conciliacion.operar` (nuevo) para importar, conciliar, registrar, cerrar y las reglas;
  - `tesoreria.maestros.editar` para los formatos;
  - `tesoreria.anular` para reabrir.
- **Usuarios de sucursal:** reciben 404 en todo el módulo, porque no operan bancos.
- **Orden de bloqueo:** conciliación → movimientos de tesorería → líneas de extracto, cada grupo ordenado por id. `bloquear` acepta además `'Conciliacion' | 'MovimientoTesoreria' | 'LineaExtracto'`.
- **Rutas:** `/api/conciliacion/...`.
- **Archivos:** hasta 5 MB y 20.000 filas, por multer en memoria (`limits.fileSize = 5 * 1024 * 1024`).

## Review Focus

1. **Fila con fecha ilegible a mitad del archivo** (por ejemplo `31/02/2026` o texto) → el intérprete devuelve un error con su número de fila y no se guarda nada. Test en la Task 1 (`fila 3: fecha inválida`) y en la Task 2 (400 con `errores`).
2. **Importe con miles y decimales** (`1.234.567,89` con separador `,`, o `-1,234.50` con `.`, o débito/crédito vacíos) → el importe se interpreta exactamente. Test en la Task 1.
3. **Movimiento de una conciliación cerrada que se anula** (anular un depósito ya conciliado) → 400 con el mensaje del período, y no cambia nada. Test en la Task 6.
4. **Vincular una línea o un movimiento de otra cuenta bancaria o de fuera del período** → 400 "La línea no pertenece a esta conciliación". Test en la Task 3.
5. **Dos usuarios vinculando el mismo movimiento a la vez** → 201 y 409. Test en la Task 3.

---

## Estructura de archivos

```
apps/api/src/conciliacion/
  interprete.ts            parsearExtracto(buffer, formato) puro + parsers de fecha/importe
  modelos-formato.ts       MODELOS_FORMATO (Nación, Galicia, Santander, Macro, BBVA, Genérico)
  formatos.service.ts / formatos.controller.ts
  importaciones.service.ts / importaciones.controller.ts
  conciliaciones.service.ts / conciliaciones.controller.ts   alta, resumen, vínculos, ignorar
  sugerencias.ts           sugerir(lineas, movimientos, tolerancia) puro
  reglas.service.ts / reglas.controller.ts
  registro.service.ts      registrar desde el extracto
  bloqueo.ts               verificarNoConciliado, verificarFechaAbierta
  reporte.ts               pdf y xlsx
  dto.ts
  conciliacion.module.ts
apps/web/src/conciliacion/  ConciliacionesPage, ConciliacionPage, ImportarExtractoModal, SugerenciasModal, ReglasPage, FormatosTab
```

---

### Task 1: Formatos de extracto e intérprete

**Files:**
- Modify:
  - `schema.prisma`: enums `TipoArchivoExtracto { CSV XLSX }` y `ModoImporte { IMPORTE_CON_SIGNO DEBITO_CREDITO }`; modelo `FormatoExtracto` (campos de la spec §1, `cuentaBancariaId @unique`).
  - `modelos-empresa.ts` y `permisos.ts` (`conciliacion.operar: 'Conciliación bancaria'`).
  - Migración: además del esquema, agrega `conciliacion.operar` al rol Administrador.
- Create: `conciliacion/{interprete.ts,modelos-formato.ts,formatos.service.ts,formatos.controller.ts,dto.ts,conciliacion.module.ts}`
- Test: `apps/api/src/conciliacion/interprete.spec.ts` (unitario) y `apps/api/test/conciliacion-formatos.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `interface FormatoParseo { tipoArchivo; separador; hoja; filaInicio; formatoFecha: 'DD/MM/AAAA' | 'DD-MM-AAAA' | 'AAAA-MM-DD'; separadorDecimal: ',' | '.'; columnaFecha; columnaConcepto; columnaReferencia?; columnaSaldo?; modoImporte; columnaImporte?; columnaDebito?; columnaCredito? }`. Las columnas son strings: número `"3"` o letra `"C"`.
  - `async parsearExtracto(archivo: Buffer, f: FormatoParseo): Promise<{ lineas: LineaParseada[]; errores: { fila: number; mensaje: string }[]; advertencias: string[] }>` con `LineaParseada { fila, fecha: Date, concepto, referencia: string | null, importe: Dec, saldo: Dec | null }`.
  - `parsearImporte(texto, separadorDecimal): Dec | null` y `parsearFecha(texto, formato): Date | null`. El XLSX acepta además celdas Date y number nativas.
  - El débito se guarda negativo y el crédito positivo.
  - Advertencias: la de saldo "El saldo de la fila N no coincide: revise el formato" (solo la primera) y "Se omitieron N filas vacías o con importe cero".
  - `MODELOS_FORMATO: Record<string, Omit<FormatoParseo, never> & { nombre: string }>`.
  - REST:
    - `GET /api/conciliacion/formatos` (lista con cuenta) y `GET /api/conciliacion/formatos/modelos`;
    - `PUT /api/conciliacion/formatos/:cuentaBancariaId` (upsert, con `tesoreria.maestros.editar`).

- [ ] **Step 1: Tests que fallan**
  - **Unitarios, CSV:**
    - con `;` y decimal `,`: la fila `"05/10/2026;DEP EFECTIVO;0045;1.234.567,89;"` en modo IMPORTE_CON_SIGNO da importe `1234567.89`;
    - con `,`, decimal `.` y DEBITO_CREDITO: débito `"1,234.50"` da `-1234.50`;
    - crédito vacío y débito vacío en la misma fila: se omite;
    - un concepto con coma entre comillas se respeta.
  - **Unitarios, fechas:** los tres formatos. **(Review Focus 1)** `31/02/2026` en la fila 3 da `errores: [{ fila: 3, mensaje: 'Fecha inválida' }]`; un importe con texto da `'Importe inválido'`.
  - **Unitario, Latin-1:** un buffer con `0xD1` ("Ñ") se lee como "AÑO".
  - **Unitario, XLSX:** generado con exceljs, con celda Date y número nativos, `hoja: '1'` y `filaInicio: 2`.
  - **Unitario, saldo:** si el saldo de la fila 4 no es el anterior más el importe, aparece la advertencia de la fila 4.
  - **e2e:**
    - `PUT` del formato con modelo Nación → 200;
    - sin permiso → 403;
    - cuenta de otra empresa → 404;
    - DEBITO_CREDITO sin `columnaDebito` → 400 con campo;
    - usuario de sucursal → 404.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS (`npx jest src/conciliacion test/conciliacion-formatos`) y suite completa.
- [ ] **Step 5: Commit** `feat(api): formatos de extracto e intérprete de archivos`

---

### Task 2: Importación de extractos

**Files:**
- Modify: `schema.prisma` (`ImportacionExtracto`, `LineaExtracto`, enums `EstadoImportacion { ACTIVA DESHECHA }` y `EstadoLinea { PENDIENTE CONCILIADA IGNORADA }`; índice `[empresaId, cuentaBancariaId, fecha]`), `modelos-empresa.ts`
- Create: `conciliacion/{importaciones.service.ts,importaciones.controller.ts}`
- Test: `apps/api/test/conciliacion-importacion.e2e-spec.ts`; helper `prepararConciliacion(app, prisma)` en `test/helpers-conciliacion.ts`. El helper parte de `prepararTesoreria`, configura un formato CSV `;` en la cuenta ARS y devuelve `csv(filas: string[]): Buffer` e `importar(buf, http?)`.

**Interfaces:**
- Produces:
  - `POST /api/conciliacion/importaciones/previsualizar` (multipart `cuentaBancariaId`, `archivo`) → `{ lineas: LineaParseada[] (máx. 20), total, errores, advertencias, duplicadas }`.
  - `POST /api/conciliacion/importaciones` → 201 `{ id, lineas, duplicadas, advertencias }`, o 400 `{ message: 'El archivo tiene errores', errores }`.
  - `GET /api/conciliacion/importaciones?cuentaBancariaId`.
  - `POST /:id/deshacer` → 200.
  - Clave de duplicado: `fecha|importe|concepto|referencia` contra líneas existentes de la cuenta.

- [ ] **Step 1: Tests que fallan**
  - Importar 3 filas → 201 `{ lineas: 3, duplicadas: 0 }`; las líneas quedan PENDIENTE con importe con signo.
  - Volver a importar el mismo archivo más una fila nueva → `{ lineas: 1, duplicadas: 3 }`, con la advertencia "3 líneas ya estaban importadas".
  - Dos filas idénticas en un mismo archivo → se importan las 2.
  - **(Review Focus 1)** Fila 2 con fecha inválida → 400 con `errores[0].fila = 2` y 0 líneas guardadas.
  - Cuenta sin formato → 400 "La cuenta bancaria no tiene formato de extracto configurado". Un CSV cuando el formato pide XLSX → 400.
  - Previsualizar no guarda nada.
  - Deshacer → las líneas se eliminan y la importación queda DESHECHA. Deshacer con una línea conciliada → 400 (se prueba en la Task 3).
  - Sin `conciliacion.operar` → 403. Archivo de más de 5 MB → 413 o 400.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): importación de extractos bancarios`

---

### Task 3: Conciliación, resumen y vínculos manuales

**Files:**
- Modify:
  - `schema.prisma`: `Conciliacion`, `VinculoConciliacion`, enums `EstadoConciliacion { ABIERTA CERRADA }` y `TipoVinculo { AUTOMATICO MANUAL REGISTRO }`; `LineaExtracto.vinculoId?` y `conciliacionId?`; `MovimientoTesoreria.vinculoId?`; `Empresa.diasToleranciaConciliacion Int @default(5)`.
  - `compras/comun.ts` (tablas de `bloquear`).
- Create: `conciliacion/{conciliaciones.service.ts,conciliaciones.controller.ts}`
- Test: `apps/api/test/conciliacion-vinculos.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `POST /api/conciliacion/conciliaciones { cuentaBancariaId, desde, hasta, saldoInicial?, saldoFinal }`:
    - `saldoInicial` por defecto es el `saldoFinal` de la última conciliación cerrada, o 0;
    - 409 si hay otra abierta o si el período se superpone.
  - `GET /api/conciliacion/conciliaciones?cuentaBancariaId` y `GET /:id` → `{ ...conciliacion, resumen: { saldoSistema, pendientesSistema, pendientesExtracto, diferencia, advertencia?: string }, lineas: LineaVista[], movimientos: MovimientoVista[], vinculos: [{ id, tipo, lineas, movimientos }] }`.
    - `MovimientoVista { id, fecha, tipo, origenTipo, descripcion, referencia, importe (con signo) }`. La descripción y la referencia se arman igual que en la consulta de movimientos de la 4A; la referencia es el número de cheque, la boleta o la referencia de la transferencia.
  - `POST /:id/vinculos { lineas: [id], movimientos: [id] }` → 201 vínculo MANUAL. `POST /:id/vinculos/lote { vinculos: [{ lineas, movimientos }] }` → 201 `{ creados }` como AUTOMATICO.
  - `DELETE /:id/vinculos/:vinculoId` → 200.
  - `POST /:id/lineas/:lineaId/ignorar { motivo }` y `/restaurar`.
  - Exporta `vincular(tx, conciliacionId, lineas, movimientos, tipo): Promise<VinculoConciliacion>` para las Tasks 4 y 5.

- [ ] **Step 1: Tests que fallan**
  - **Conciliación con resumen:** cuenta ARS con un depósito de 53.000 (11/10) y un gasto de 1.200 (20/10) en el sistema; extracto con un depósito de 53.000 y un impuesto de −318. Conciliación de octubre con saldo inicial 0 y saldo final 52.682:
    - `saldoSistema` 51.800;
    - pendientes del sistema −1.200 y del extracto −318;
    - `diferencia` = 52.682 − (51.800 + 1.200 − 318) = 0.
  - **Vínculo manual** de la línea de 53.000 con el movimiento del depósito → 201; los dos desaparecen de pendientes y la línea queda CONCILIADA.
  - **Importes distintos** → 400 "Los importes no coinciden (extracto $ 53.000,00, sistema $ 1.200,00)".
  - **Varios con varios:** dos líneas (30.000 + 23.000) contra un movimiento de 53.000 → 201.
  - **(Review Focus 4)** Una línea de otra cuenta, o de fuera del período → 400 "La línea no pertenece a esta conciliación". Un movimiento posterior a `hasta` → 400.
  - Deshacer un vínculo → todo vuelve a pendiente. Ignorar una línea sin motivo → 400.
  - **Superposición:** segunda conciliación abierta → 409; período superpuesto → 409.
  - Deshacer la importación de una línea conciliada → 400.
  - **(Review Focus 5)** Dos vínculos simultáneos sobre el mismo movimiento → [201, 409], con el mensaje "El movimiento ya fue conciliado".
  - Otra empresa → 404.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): conciliaciones y vínculos`

---

### Task 4: Sugerencias automáticas

**Files:**
- Create: `conciliacion/sugerencias.ts` (puro), endpoint en `conciliaciones.controller.ts`
- Test: `apps/api/src/conciliacion/sugerencias.spec.ts` y un caso e2e en `conciliacion-vinculos.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `sugerir(lineas: { id, fecha, importe: Dec, referencia }[], movimientos: { id, fecha, importe: Dec, referencia }[], toleranciaDias: number): Sugerencia[]` con `Sugerencia { lineas: string[]; movimientos: string[]; nivel: 'EXACTA' | 'PROBABLE' | 'AGRUPADA'; preseleccionada: boolean }`.
  - Pasadas en orden y sin reutilizar elementos:
    - **EXACTA:** importe igual y (la referencia de la línea contiene la del movimiento, normalizadas sin ceros a la izquierda ni espacios, o la misma fecha); entre varios candidatos gana el más cercano en fecha.
    - **PROBABLE:** importe igual, |días| ≤ tolerancia y candidato único de cada lado.
    - **AGRUPADA:** una línea contra 2 a 10 movimientos de la misma fecha y el mismo signo que sumen exacto, o el caso inverso; búsqueda por subconjuntos con poda, limitada a 10 elementos.
  - `POST /api/conciliacion/conciliaciones/:id/sugerencias` → `Sugerencia[]`, que usa `empresa.diasToleranciaConciliacion`.

- [ ] **Step 1: Tests que fallan** (unitarios)
  - Línea "DEP 0045" de 53.000 contra un movimiento con referencia "45" y la misma fecha → EXACTA preseleccionada.
  - Mismo importe a 3 días → PROBABLE sin preseleccionar; a 8 días → nada.
  - Dos movimientos de 1.000 y una línea de 1.000 a 2 días → nada en PROBABLE, porque el candidato no es único.
  - Línea de −30.000 contra movimientos de −10.000, −15.000 y −5.000 de la misma fecha → AGRUPADA con los tres.
  - Un elemento usado en EXACTA no se reutiliza.
  - **e2e:** sugerencias sobre el escenario de la Task 3 y aplicación por lote → `creados: 1`, línea conciliada.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): sugerencias automáticas de conciliación`

---

### Task 5: Reglas y registro desde el extracto

**Files:**
- Modify:
  - `schema.prisma`: `ReglaConciliacion`, enum `SentidoRegla { DEBITO CREDITO AMBOS }`.
  - `plan-cuentas-modelo.ts`: `5.2.05 Impuesto a los débitos y créditos bancarios` y `4.2.02 Intereses ganados`.
  - Migración: agrega las cuentas y las reglas iniciales de la spec §5 a cada empresa existente.
  - `EmpresasService.crear`: carga las reglas iniciales.
- Create: `conciliacion/{reglas.service.ts,reglas.controller.ts,registro.service.ts,reglas-iniciales.ts}`
- Test: `apps/api/test/conciliacion-reglas.e2e-spec.ts`

**Interfaces:**
- Consumes: `BancosService.movimiento(d)` de la 4A, refactorizado para recibir `tx` opcional: `movimientoEnTx(tx, d)`. `vincular(...)` de la Task 3.
- Produces:
  - `REGLAS_INICIALES: { prioridad, texto, sentido, codigoCuenta }[]` con los valores de la spec §5; `cargarReglasIniciales(tx, empresaId)`.
  - `reglaPara(reglas, linea, cuentaBancariaId): ReglaConciliacion | null`: sin distinguir mayúsculas ni acentos (NFD) y por menor prioridad.
  - REST `GET/POST/PATCH /api/conciliacion/reglas` (validación de cuenta imputable). El GET de la conciliación agrega `reglaSugerida` a cada línea.
  - `POST /api/conciliacion/conciliaciones/:id/registrar { lineas: [{ lineaId, cuentaContableId, concepto }] }` → 201 `{ registradas }`.

- [ ] **Step 1: Tests que fallan**
  - **Una empresa nueva** tiene 10 reglas y las cuentas 5.2.05 y 4.2.02.
  - **La línea "IMP. LEY 25413 DEB"** de −318 trae `reglaSugerida.cuenta` "5.2.05 Impuesto a los débitos y créditos bancarios". La línea "PERCEP IVA RG 2408" sugiere 1.1.03.002 y no la regla "IVA", por prioridad.
  - **Registrar la línea del impuesto:**
    - crea un MovimientoBancario GASTO de 318;
    - genera el asiento debe 5.2.05 318, haber 1.1.01.002 318;
    - la línea queda CONCILIADA con un vínculo REGISTRO;
    - la diferencia del escenario de la Task 3 sigue en 0 y las pendientes del extracto pasan a 0.
  - **Línea de crédito "INTERESES"** de 150 → INGRESO, con debe banco y haber 4.2.02.
  - **Registrar una línea ya conciliada** → 409.
  - **Regla con cuenta no imputable** → 400.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): reglas y registro desde el extracto`

---

### Task 6: Cierre, bloqueo y reapertura

**Files:**
- Create: `conciliacion/bloqueo.ts`
- Modify:
  - `tesoreria/operaciones/tesoreria-comun.ts`: `registrarMovimiento` llama a `verificarFechaAbierta`.
  - Las anulaciones de la 4A llaman a `liberarOVerificar(tx, origenTipo, origenId)` antes de anular sus movimientos: `ingresos.service` (los movimientos de ingreso no tocan el banco, pero las transferencias acreditadas sí: origen `ACREDITACION_TRANSFERENCIA`), `depositos.service`, `anulacion.service` (OP) y `traslados.service` (solo caja, no aplica).
  - `conciliaciones.service.ts` (cerrar y reabrir).
- Test: `apps/api/test/conciliacion-cierre.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `liberarOVerificar(tx, origenTipo: string, origenId: string): Promise<void>`:
    - para cada `MovimientoTesoreria` del origen con vínculo: si el vínculo está en una conciliación CERRADA → 400 "El movimiento está conciliado en la conciliación del período DD/MM/AAAA–DD/MM/AAAA: reábrala para anularlo";
    - si está ABIERTA → elimina el vínculo (sus líneas vuelven a PENDIENTE).
  - `verificarFechaAbierta(tx, cuentaBancariaId, fecha)`: 400 "La cuenta está conciliada hasta DD/MM/AAAA" si `fecha ≤ hasta` de la última cerrada.
  - `POST /:id/cerrar { version }` → 200 (spec §6). `POST /:id/reabrir { motivo }` con `tesoreria.anular` → 200.

- [ ] **Step 1: Tests que fallan**
  - **Cerrar con diferencia** → 400 "La conciliación no cuadra: diferencia $ 318,00". Con una línea pendiente pero diferencia 0 por saldo (caso armado) → 400 "Hay 1 líneas del extracto sin conciliar".
  - **Ignorar y cerrar:** se ignora una línea y se cierra con diferencia 0 → CERRADA con `resumen` guardado.
  - **Partida pendiente:** el gasto de 1.200 sin conciliar aparece en la conciliación de noviembre.
  - **(Review Focus 3)** Anular el depósito conciliado (cerrada) → 400 con el mensaje del período, y el depósito sigue CONFIRMADO.
  - **Con la conciliación abierta**, anular el depósito → 200, y la línea vuelve a PENDIENTE.
  - **Fecha conciliada:** un movimiento bancario con fecha 15/10 tras cerrar octubre → 400 "La cuenta está conciliada hasta 31/10/2026".
  - **Reabrir:** reabrir octubre con noviembre abierta → 400; reabrir la última → ABIERTA, auditado. Sin `tesoreria.anular` → 403.
  - **Operar una cerrada** (vincular) → 400 "La conciliación está cerrada".
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): cierre, bloqueo y reapertura de conciliaciones`

---

### Task 7: Reporte

**Files:**
- Create: `conciliacion/reporte.ts`, endpoint en el controller
- Test: en `conciliacion-cierre.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `datosReporte(conciliacionId): Promise<{ encabezado, saldoExtracto, creditosNoAcreditados: Item[], debitosNoDebitados: Item[], lineasPendientes: Item[], saldoLibros, diferencia }>`;
  - `GET /:id/reporte?formato=pdf|xlsx` → `application/pdf` o xlsx con `Content-Disposition` `conciliacion-<numero cuenta>-<desde>.pdf`. Un formato inválido → 400.

- [ ] **Step 1: Tests que fallan**
  - **Datos** de la conciliación cerrada de la Task 6: `debitosNoDebitados` tiene el gasto de 1.200, `saldoExtracto` es 52.682 y `diferencia` es "0".
  - **El PDF** empieza con `%PDF`.
  - **El XLSX** abierto con exceljs tiene la fila "Saldo según extracto".
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): reporte de conciliación bancaria`

---

### Task 8: Web

**Files:**
- Create:
  - `apps/web/src/conciliacion/`: `ConciliacionesPage.tsx` (historial, nueva, importar), `ConciliacionPage.tsx` (resumen, dos tablas con selección, conciliar, registrar, ignorar, cerrar, pestaña Conciliado), `ImportarExtractoModal.tsx`, `SugerenciasModal.tsx`, `ReglasPage.tsx`, `FormatosExtracto.tsx`;
  - `seleccion.ts`, con la función pura `sumaSeleccion(items, ids): number` y `puedeConciliar(sumaLineas, sumaMovs): boolean`.
- Modify:
  - `menu.ts`: Registraciones › Tesorería › "Conciliación bancaria" (`/conciliacion`) y Administración › "Reglas de conciliación" (`/admin/reglas-conciliacion`);
  - `rutas.tsx` (más `/conciliacion/:id`);
  - `TesoreriaPage.tsx` (pestaña "Formatos de extracto");
  - `RolesPage` (grupo `conciliacion: 'Tesorería'`).
- Test: `apps/web/src/conciliacion/seleccion.test.ts` y `apps/web/src/conciliacion/ConciliacionPage.test.tsx`

**Interfaces:**
- Consumes: los endpoints de las Tasks 1 a 7.
- `data-testid`: `diferencia`, `suma-extracto` y `suma-sistema`.

- [ ] **Step 1: Tests que fallan**
  - `puedeConciliar(53000, 53000)` es true; `puedeConciliar(53000, 52999.99)` es false; `sumaSeleccion` con los importes 30000.10 y 22999.90 da 53000, sin errores de coma flotante (suma en centavos).
  - `ConciliacionPage` con datos simulados (mock de `api`): muestra "Diferencia $ 0,00" en verde y el botón "Cerrar conciliación" habilitado; con diferencia, muestra el importe en rojo y el botón deshabilitado.
- [ ] **Step 2–4:** PASS; `tsc` y `vite build` sin errores; el test de rutas del menú en verde.
- [ ] **Step 5: Commit** `feat(web): conciliación bancaria`

---

### Task 9: Seed, e2e y README

**Files:**
- Modify:
  - `seed/demo.ts`: rol Tesorero con `conciliacion.operar`; formato Nación en la cuenta demo; reglas iniciales.
  - `seed/demo-completo.ts`: al final escribe `apps/api/prisma/demo/extracto-demo-nacion.csv` con los `MovimientoTesoreria` no anulados de la cuenta Nación (fecha, descripción, referencia, importe con signo, saldo acumulado) más tres líneas del banco: "IMP. LEY 25413 DEB" (−0,6 % de los débitos, redondeado), "COMISION MANTENIMIENTO CTA" −8.500 y "IVA COMISION" −1.785, con fecha hoy.
  - `.gitignore`, `test/seed.e2e-spec.ts`, `README.md`.
- Create: `e2e/conciliacion.spec.ts`

- [ ] **Step 1: Tests que fallan**
  - **`seed.e2e-spec`:** existe el formato de la cuenta Nación; hay 10 reglas; el archivo de extracto existe y el intérprete lo lee sin errores con el formato Nación.
  - **`e2e/conciliacion.spec.ts`** (tesorero):
    1. En `/conciliacion`, importa `extracto-demo-nacion.csv` y ve "líneas importadas".
    2. Crea la conciliación del mes con el saldo final que dice el archivo; el test lo lee de la última línea.
    3. "Buscar coincidencias" → "Aplicar".
    4. "Registrar todas las que tienen regla".
    5. `diferencia` = "$ 0,00"; "Cerrar conciliación" deja el estado "Cerrada".
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `pnpm test`, `vitest` y `pnpm e2e` en verde, con la base e2e recreada.
- [ ] **Step 5:** README: sección "Conciliación bancaria (Entrega 4B)" con el aviso de verificar los formatos de cada banco.
- [ ] **Step 6: Commit** `feat: datos demo y prueba de punta a punta de conciliación`

---

## Cobertura de la spec

| Spec | Task |
|---|---|
| §1 Formatos | 1, 8 |
| §2 Importación | 2, 8 |
| §3 Conciliación | 3, 8 |
| §4 Sugerencias | 4, 8 |
| §5 Registro y reglas | 5, 8 |
| §6 Cierre, bloqueo y reapertura | 6, 8 |
| §7 Reporte | 7, 8 |
| §8 Web | 8 |
| §9 Concurrencia | 3, 6 |
| §10 Pruebas y seed | todas, 9 |

**Decisiones del plan que la spec no fijaba:**
- `BancosService.movimiento` se refactoriza para que pueda correr dentro de la transacción del registro.
- La comparación de referencias ignora ceros a la izquierda y espacios.
- La búsqueda agrupada se limita a subconjuntos de hasta 10 elementos de la misma fecha.
- Las sumas de la web se hacen en centavos.
