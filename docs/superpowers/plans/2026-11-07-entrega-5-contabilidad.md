# Entrega 5: Contabilidad general. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La contabilidad general completa:
- ejercicios y meses, con control de fechas en el motor de asientos;
- asientos manuales;
- cierre de mes con numeración definitiva cronológica;
- Diario, Mayor y sumas y saldos;
- cierre del ejercicio con refundición, cierre y apertura;
- estados contables en moneda histórica;
- libros legales foliados.

**Architecture:**
- Módulo Nest `contabilidad` con estas piezas, cada una con su servicio y controlador:
  - `periodos` (ejercicios y meses);
  - `asientos-manuales`;
  - `consultas` (Diario, Mayor, sumas y saldos);
  - `cierre-ejercicio`;
  - `estados`;
  - `libros`.
- El control de fechas vive en `AsientosService.generar`, que ya existe y usan todos los módulos. Así ningún asiento se graba fuera de un período abierto.
- Los saldos se calculan siempre con un solo helper (`saldosPorCuenta`), que suma los renglones de los asientos filtrando por ejercicio, fechas y tipos.

**Tech Stack:** la de las entregas anteriores (NestJS, Prisma, pdfkit, exceljs, React y Mantine). No hay dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-07-entrega-5-contabilidad-design.md`

## Global Constraints

- **Multi-empresa:** todo modelo nuevo lleva `empresaId`, va en `MODELOS_DE_EMPRESA` y se accede vía `TenantPrisma`.
- **Importes:** Decimal(18,2) y aritmética con Decimal. Debe y haber con 2 decimales.
- **Validación y mensajes:** auditoría en cada escritura, mensajes en castellano, zod con 400 `{ message, campos }`.
- **Permisos:**
  - nuevos: `asiento.registrar` (asientos manuales) y `contabilidad.cerrar` (meses, ejercicios y libros);
  - las consultas usan `plancuentas.ver`;
  - la migración agrega los dos nuevos al rol Administrador.
- **Mensajes exactos de fecha:**
  - "No hay un ejercicio contable para la fecha DD/MM/AAAA";
  - "El ejercicio N está cerrado";
  - "El período MM/AAAA está cerrado".
- **Concepto nuevo:** `RESULTADO_DEL_EJERCICIO`, con la cuenta 3.2.02 "Resultado del ejercicio" (patrimonio neto, imputable).
- **Rutas:** `/api/contabilidad/...`.
- **Orden de bloqueo:** el período se bloquea al final, dentro de `AsientosService.generar`, después de todo lo que bloquea el módulo llamador.

## Review Focus

1. **Asiento manual con un renglón que tiene debe y haber a la vez, o importe negativo o cero** → 400 con campo. Test en la Task 2.
2. **Fecha justo en el borde del ejercicio o del mes** (último día del mes, primer día del ejercicio siguiente, 29/02) → cae en el período correcto. Test en la Task 1, con un ejercicio que empieza en julio y una fecha 30/06 o 01/07.
3. **Mayor o sumas y saldos con un rango que cruza dos ejercicios** → 400 "El rango debe estar dentro de un mismo ejercicio". Test en la Task 4.
4. **Asiento cargado mientras otro usuario cierra el mismo mes** → nunca queda un asiento sin número definitivo en un mes cerrado. Test de concurrencia en la Task 3.
5. **Cerrar el ejercicio con cuentas con saldo en distintos centros de costo, o sin ningún resultado** → la refundición agrupa por cuenta y, si no hay resultados, no se genera, pero el cierre igual funciona. Test en la Task 5.

---

## Estructura de archivos

```
apps/api/src/contabilidad/
  periodos/        ejercicios.ts (fechas puras), periodos.service.ts, periodos.controller.ts
  asientos/        asientos.service.ts (modificado: control de fechas, tipo, ejercicio)
  manuales/        asientos-manuales.service.ts, asientos-manuales.controller.ts, dto.ts
  consultas/       saldos.ts (saldosPorCuenta), consultas.service.ts, consultas.controller.ts, exportar.ts
  cierre/          cierre-ejercicio.service.ts
  estados/         estados.service.ts
  libros/          libros.service.ts, pdf-libros.ts
  contabilidad.module.ts
apps/web/src/contabilidad/   AsientoManualPage, PeriodosPage, DiarioPage, MayorPage, SumasSaldosPage, SituacionPage, ResultadosPage, LibrosPage, DetalleAsiento, GrillaAsiento
```

---

### Task 1: Ejercicios, períodos y control de fechas

**Files:**
- Modify:
  - `schema.prisma`:
    - `Ejercicio` y `PeriodoContable` (spec §1);
    - enums `EstadoEjercicio { ABIERTO CERRADO }`, `EstadoPeriodo { ABIERTO CERRADO }` y `TipoAsiento { AUTOMATICO MANUAL REFUNDICION CIERRE APERTURA }`;
    - en `Asiento`: `tipo` (por defecto AUTOMATICO), `ejercicioId?`, `numeroDefinitivo Int?`, `version Int @default(0)`, `@@unique([empresaId, ejercicioId, numeroDefinitivo])`;
    - índice de `AsientoRenglon` por `[empresaId, cuentaContableId]`.
  - Migración con datos:
    - por cada empresa, crear los ejercicios necesarios desde el asiento más antiguo (o hoy) hasta el que contiene hoy, con sus 12 períodos abiertos;
    - asignar `ejercicioId` a los asientos;
    - agregar la cuenta 3.2.02 al plan y el concepto `RESULTADO_DEL_EJERCICIO`;
    - agregar los permisos nuevos al rol Administrador.
  - `plan-cuentas-modelo.ts` (3.2.02), `compras/config/conceptos.ts`, `permisos.ts`.
  - `EmpresasService.crear`: crea el primer ejercicio; `modificarActual` bloquea el cambio de `inicioEjercicioMes` si hay asientos.
  - `AsientosService.generar`: control de fechas, bloqueo del período, `ejercicioId` y `tipo`.
  - `test/helpers.ts`: `crearEmpresaYUsuario` crea el ejercicio de hoy.
  - Prueba unitaria `asientos.spec.ts`: su empresa necesita ejercicio.
  - `seed/demo.ts`: crea el ejercicio.
- Create: `contabilidad/periodos/{ejercicios.ts,periodos.service.ts,periodos.controller.ts}`, `contabilidad/contabilidad.module.ts`
- Test: `apps/api/src/contabilidad/periodos/ejercicios.spec.ts` y `apps/api/test/contabilidad-periodos.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `rangoEjercicio(inicioMes: number, fecha: Date): { desde: Date; hasta: Date }`, puro: el ejercicio que contiene la fecha. También `mesesDe(desde: Date): { anio, mes, desde, hasta }[]` (12 meses).
  - `crearEjercicio(tx: Prisma.TransactionClient, empresaId: string, desde: Date, numero: number): Promise<Ejercicio>`, que crea el ejercicio con sus 12 períodos.
  - `PeriodosService.paraFecha(tx, fecha): Promise<{ ejercicio: Ejercicio; periodo: PeriodoContable }>`:
    - bloquea el período con `bloquear(tx, 'PeriodoContable', …)` (se agregan `'PeriodoContable' | 'Ejercicio'` a la unión de `bloquear`);
    - lanza los tres 400 de las Global Constraints.
  - `DatosAsiento` acepta `tipo?: TipoAsiento`; `generar` guarda `ejercicioId` y `tipo`.
  - `GET /api/contabilidad/ejercicios` (`plancuentas.ver`) → `[{ ...ejercicio, periodos: [{ ...periodo, asientos: number }] }]`.
  - `POST /api/contabilidad/ejercicios/siguiente` (`contabilidad.cerrar`) → 201; si ya hay dos abiertos, 400 "Ya hay dos ejercicios abiertos: cierre el anterior primero".

- [ ] **Step 1: Tests que fallan**
  - **Unitarios:**
    - `rangoEjercicio(1, 2026-11-05)` → 2026-01-01 a 2026-12-31;
    - `rangoEjercicio(7, 2026-06-30)` → 2025-07-01 a 2026-06-30;
    - `rangoEjercicio(7, 2026-07-01)` → 2026-07-01 a 2027-06-30;
    - `mesesDe(2025-07-01)` tiene 12 meses, con febrero de 2028 de 29 días cuando corresponde. **(Review Focus 2)**
  - **e2e:**
    - una empresa nueva tiene el ejercicio 1, que contiene hoy, con 12 meses abiertos;
    - una factura con fecha 2025-12-10, fuera de todo ejercicio → 400 "No hay un ejercicio contable para la fecha 10/12/2025", sin dejar movimientos de cuenta corriente;
    - con el período de octubre cerrado (por prisma), una factura del 15/10 → 400 "El período 10/2026 está cerrado";
    - abrir el ejercicio siguiente → 201, número 2; una tercera vez → 400;
    - cambiar `inicioEjercicioMes` con asientos → 400;
    - otra empresa no ve los ejercicios.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS, más la suite completa en verde (los helpers crean ejercicios).
- [ ] **Step 5: Commit** `feat(api): ejercicios, períodos y control de fechas contables`

---

### Task 2: Asientos manuales

**Files:**
- Create: `contabilidad/manuales/{asientos-manuales.service.ts,asientos-manuales.controller.ts,dto.ts}`
- Modify: `AsientosService` (agrega `generarEnTx` que acepta `id` y `version`, o un método `reemplazar`)
- Test: `apps/api/test/contabilidad-manuales.e2e-spec.ts`

**Interfaces:**
- Produces (`asiento.registrar`):
  - `POST /api/contabilidad/asientos { fecha, descripcion, renglones: [{ cuentaContableId, centroCostoId?, debe?, haber?, detalle? }] }` → 201 con el asiento (tipo MANUAL; `origenTipo` 'MANUAL'; `origenId` igual a su id).
  - `PUT /api/contabilidad/asientos/:id { version, fecha, descripcion, renglones }`: reemplaza los renglones. La versión se incrementa; una versión vieja da 409.
  - `DELETE /api/contabilidad/asientos/:id`.
  - `POST /api/contabilidad/asientos/:id/anular { fecha, motivo }`: contraasiento MANUAL con `anulaAId`.
- Validación del DTO: cada renglón tiene exactamente un lado mayor que cero, con hasta 2 decimales, o 400 con el campo `renglones.N.debe`. Hay al menos 2 renglones.
- Un asiento no MANUAL en PUT, DELETE o anular → 400 "Los asientos automáticos se anulan desde su comprobante".

- [ ] **Step 1: Tests que fallan**
  - **Alta:** debe 5.2.01 1.000 y haber 1.1.01.001 1.000 → 201, tipo MANUAL, `numeroDefinitivo` null.
  - **Sin balance** → 400 "El asiento no balancea (debe 1000.00, haber 900.00)".
  - **(Review Focus 1)** Renglón con debe y haber, con −5 o con 0 → 400. Un solo renglón → 400.
  - **Cuenta no imputable** → 400.
  - **Modificar** con el mes abierto → 200, con renglones nuevos y versión + 1. Con una versión vieja → 409. Con su mes cerrado, o moviéndolo a un mes cerrado → 400 con el mensaje del período.
  - **Eliminar** → 200, y el asiento ya no existe.
  - **Anular** → contraasiento con debe y haber invertidos. Anular dos veces → 409.
  - **Asiento automático** (el de una factura): modificar, eliminar o anular → 400.
  - **Sin permiso** → 403.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): asientos manuales`

---

### Task 3: Cierre de mes y numeración definitiva

**Files:**
- Modify: `periodos.service.ts` y `periodos.controller.ts`
- Test: `apps/api/test/contabilidad-cierre-mes.e2e-spec.ts`

**Interfaces:**
- Produces (`contabilidad.cerrar`):
  - `POST /api/contabilidad/periodos/:id/cerrar` → 200 `{ ...periodo, numerados: n }`.
  - `POST /api/contabilidad/periodos/:id/reabrir { motivo }` → 200.
  - `numerarPeriodo(tx, periodo): Promise<number>`: asigna los números definitivos siguiendo el último del ejercicio, en el orden de la spec §4 (fecha; tipo APERTURA → AUTOMATICO, MANUAL → REFUNDICION → CIERRE; `creadoEn`; `numero`). La usa también la Task 5.

- [ ] **Step 1: Tests que fallan**
  - **Numeración cronológica:**
    - se cargan tres asientos manuales en enero, en este orden: 20/01, 05/01 y 05/01 (el último cargado después);
    - al cerrar enero quedan con números 1 (el primero del 05/01), 2 (el segundo del 05/01) y 3 (el del 20/01).
  - **Continuidad:** al cerrar febrero, con un asiento, recibe el 4.
  - **Fuera de orden:** cerrar marzo con febrero abierto → 400 "Cierre primero el período 02/2026".
  - **Reapertura:**
    - reabrir enero con febrero cerrado → 400;
    - reabrir febrero → números null;
    - volver a cerrar → 4 otra vez.
  - **Mes cerrado:** después de cerrar, un asiento manual en enero → 400 "El período 01/2026 está cerrado".
  - **(Review Focus 4)** Concurrencia: `Promise.all` de un asiento manual en marzo y el cierre de marzo → al final, ningún asiento de marzo tiene `numeroDefinitivo` null si marzo quedó CERRADO.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): cierre de meses y numeración definitiva`

---

### Task 4: Diario, Mayor y sumas y saldos

**Files:**
- Create: `contabilidad/consultas/{saldos.ts,consultas.service.ts,consultas.controller.ts,exportar.ts}`
- Test: `apps/api/test/contabilidad-consultas.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `saldosPorCuenta(tx, f: { ejercicioId: string; desde?: Date; hasta?: Date; excluirTipos?: TipoAsiento[]; centroCostoId?: string }): Promise<Map<string, { debe: Dec; haber: Dec }>>`, implementado con `groupBy` de `AsientoRenglon` por cuenta, con filtro por asiento. Lo usan las Tasks 5, 6 y 7.
  - `arbolSaldos(cuentas, saldos, nivel): FilaArbol[]` con `FilaArbol { cuentaId, codigo, nombre, nivel, imputable, tipo, debe, haber, saldoDeudor, saldoAcreedor }`. Incluye los rubros ascendentes con sus sumas.
  - `rutaOrigen(origenTipo, origenId): string | null`, con la tabla de la spec §5: `/compras/comprobantes?id=…`, `/pagos/op/:id`, `/tesoreria/ingreso`, `/tesoreria/deposito` y `/contabilidad/asientos/:id`.
  - REST (`plancuentas.ver`), todas con `formato=xlsx|pdf` opcional:
    - `GET /api/contabilidad/diario?desde&hasta&origenTipo&pagina` → `{ items: AsientoVista[], total, totales: { debe, haber } }`;
    - `GET /api/contabilidad/asientos/:id`;
    - `GET /api/contabilidad/mayor?cuentaContableId&desde&hasta&centroCostoId` → `{ cuenta, saldoInicial, movimientos: [{ fecha, asientoId, numero, descripcion, debe, haber, saldo }], saldoFinal }`;
    - `GET /api/contabilidad/sumas-saldos?ejercicioId&desde&hasta&nivel&incluirCierre` → `{ filas: FilaArbol[], totales: { debe, haber, saldoDeudor, saldoAcreedor } }`.
  - Validación: si `desde` y `hasta` caen en ejercicios distintos → 400 "El rango debe estar dentro de un mismo ejercicio".

- [ ] **Step 1: Tests que fallan**
  - **Escenario:**
    - asiento manual de aporte: 1.1.01.002 debe 1.000.000 contra 3.1.01;
    - factura de 1.210 (gasto 1.000 e IVA 210, al proveedor);
    - asiento manual de gasto de 500 con centro de costo ADM.
  - **Diario:** 3 asientos y totales iguales. La factura trae `origen.ruta`; el filtro `origenTipo=MANUAL` devuelve 2.
  - **Mayor de 5.2.01:**
    - movimientos 1.000 y 500, con saldo acumulado 1.000 y 1.500;
    - desde el día siguiente a la factura, `saldoInicial` 1.000;
    - con `centroCostoId=ADM`, solo los 500;
    - el Mayor del rubro 5.2 incluye 5.2.01.
  - **Sumas y saldos:**
    - debe total igual a haber total;
    - la fila del rubro 1.1 suma sus cuentas;
    - con `nivel=2`, no hay filas de nivel 3 o más.
  - **(Review Focus 3)** `desde=2026-12-15&hasta=2027-01-15` con dos ejercicios → 400.
  - **Exportación:** `formato=xlsx` y `formato=pdf` devuelven el tipo de archivo correcto.
  - **Otra empresa:** el asiento → 404.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): libro diario, mayor y balance de sumas y saldos`

---

### Task 5: Cierre del ejercicio

**Files:**
- Create: `contabilidad/cierre/cierre-ejercicio.service.ts` y endpoints en `periodos.controller.ts`
- Test: `apps/api/test/contabilidad-cierre-ejercicio.e2e-spec.ts`

**Interfaces:**
- Consumes: `saldosPorCuenta`, `numerarPeriodo` y `AsientosService.generar` con `tipo`.
- Produces (`contabilidad.cerrar`):
  - `GET /api/contabilidad/ejercicios/:id/cierre/previa` → `{ resultado: string, refundicion: Renglon[], cierre: Renglon[], faltantes: string[] }`. Los faltantes son, por ejemplo, "Cierre los períodos hasta 11/2026" o "Abra el ejercicio siguiente".
  - `POST /api/contabilidad/ejercicios/:id/cerrar` → 200. Con faltantes, 400 con el primer faltante.
  - `POST /api/contabilidad/ejercicios/:id/reabrir { motivo }` → 200.

- [ ] **Step 1: Tests que fallan**
  - **Escenario en el ejercicio 2026:**
    - aporte de capital: 1.1.01.002 contra 3.1.01, 1.000.000;
    - venta simulada por asiento manual: 1.1.02.001 contra 4.1.01, 300.000;
    - gasto: 5.2.01 contra 1.1.01.002, 100.000, en dos centros de costo (60.000 y 40.000). **(Review Focus 5)**
  - **Antes de cerrar:**
    - previa con faltantes;
    - cerrar → 400 "Cierre los períodos hasta 11/2026";
    - se cierran enero a noviembre y se abre el ejercicio siguiente.
  - **Refundición:** debe 4.1.01 300.000; haber 5.2.01 100.000, en un solo renglón; haber 3.2.02 200.000.
  - **Cierre:** todas las cuentas patrimoniales quedan en cero en el ejercicio 2026, con `incluirCierre`.
  - **Apertura (2027-01-01):**
    - debe 1.1.01.002 900.000 y 1.1.02.001 300.000;
    - haber 3.1.01 1.000.000 y 3.2.02 200.000.
  - **Estado:** el ejercicio 2026 queda CERRADO y diciembre también, con la refundición y el cierre numerados al final.
  - **Fechas:** un asiento con fecha de 2026 → 400 "El ejercicio 1 está cerrado".
  - **Reapertura:**
    - reabrir con enero de 2027 cerrado → 400;
    - reabrir → los tres asientos eliminados, diciembre abierto y el ejercicio ABIERTO.
  - **Sin resultados:** un ejercicio solo con el aporte no genera refundición, pero el cierre y la apertura sí.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): cierre del ejercicio con refundición, cierre y apertura`

---

### Task 6: Estados contables

**Files:**
- Create: `contabilidad/estados/estados.service.ts` y endpoints
- Test: `apps/api/test/contabilidad-estados.e2e-spec.ts`

**Interfaces:**
- Produces (`plancuentas.ver`, `formato=pdf` opcional):
  - `GET /api/contabilidad/estados/situacion?fecha&nivel` → `{ fecha, activo: Bloque, pasivo: Bloque, patrimonioNeto: Bloque, resultadoEnCurso: string | null, control: string, comparativo: { fecha, activo, pasivo, patrimonioNeto } | null }`. Cada `Bloque` es `{ total: string, filas: FilaEstado[] }` y cada `FilaEstado` es `{ codigo, nombre, nivel, importe, importeAnterior? }`.
  - `GET /api/contabilidad/estados/resultados?desde&hasta&nivel` → `{ positivos: Bloque, negativos: Bloque, resultado: string, comparativo: { positivos, negativos, resultado } | null }`.
  - Signos según la spec §7: el activo y los resultados negativos en positivo cuando son deudores; el pasivo, el patrimonio neto y los resultados positivos en positivo cuando son acreedores.

- [ ] **Step 1: Tests que fallan**
  - **Escenario de la Task 5, antes de cerrar:**
    - situación al 31/12/2026: activo 1.200.000; pasivo 0; patrimonio neto 1.000.000 más el resultado en curso 200.000; `control` "0";
    - resultados: positivos 300.000, negativos 100.000, resultado 200.000.
  - **Después del cierre:**
    - la situación al 31/12/2026 sigue igual (el cierre queda excluido), con 3.2.02 200.000 y `resultadoEnCurso` null;
    - la situación al 31/01/2027 tiene comparativo con el 31/12/2026.
  - **Con nivel 2:** solo rubros de hasta dos niveles.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): estados contables`

---

### Task 7: Libros legales

**Files:**
- Modify: `schema.prisma` (`EmisionLibro` y enum `LibroLegal { DIARIO INVENTARIOS }`)
- Create: `contabilidad/libros/{libros.service.ts,pdf-libros.ts,libros.controller.ts}`
- Test: `apps/api/test/contabilidad-libros.e2e-spec.ts`

**Interfaces:**
- Produces (`contabilidad.cerrar`):
  - `POST /api/contabilidad/libros/diario { desde, hasta, folioInicial? }` → PDF.
    - Headers: `X-Folio-Inicial`, `X-Folio-Final` y, si corresponde, `X-Advertencia`.
    - Un mes no cerrado → 400 "El período MM/AAAA no está cerrado".
  - `POST /api/contabilidad/libros/inventarios { ejercicioId, folioInicial? }` → PDF. Solo con el ejercicio CERRADO.
  - `GET /api/contabilidad/libros/emisiones`.
  - `pdfDiario(datos, folioInicial): Promise<{ pdf: Buffer; folioFinal: number }>`: cada página lleva encabezado y folio, con transporte al pie y "Viene de transporte" en la siguiente.

- [ ] **Step 1: Tests que fallan**
  - **Diario de enero con 80 asientos manuales:**
    - el PDF empieza con `%PDF`;
    - `X-Folio-Inicial` 1 y `X-Folio-Final` mayor que 1;
    - el texto del PDF, extraído con pdf-parse si está instalado o con `pdfkit` sin compresión (`compress: false`) y buscando el string, contiene "Folio 1", "Viene de transporte" y "Transporte".
  - **Segunda emisión** (febrero) sin folio → empieza en el `X-Folio-Final` anterior + 1.
  - **Reemitir enero** → con `X-Advertencia`.
  - **Diario de un mes abierto** → 400.
  - **Inventarios y Balances:** con el ejercicio abierto → 400; cerrado → PDF con "Estado de situación patrimonial".
  - **Historial:** `emisiones` tiene 3 registros.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(api): libros legales foliados`

---

### Task 8: Web

**Files:**
- Create: `apps/web/src/contabilidad/`
  - `GrillaAsiento.tsx`, con la función pura `totalesAsiento(renglones): { debe, haber, diferencia }` (en centavos) en `asiento.ts`;
  - `AsientoManualPage.tsx` (alta, y modificación si llega `?id=`);
  - `PeriodosPage.tsx`;
  - `DiarioPage.tsx`, `MayorPage.tsx` y `SumasSaldosPage.tsx`;
  - `SituacionPage.tsx` y `ResultadosPage.tsx`;
  - `LibrosPage.tsx`;
  - `DetalleAsiento.tsx` (modal).
- Modify:
  - `menu.ts`: reemplaza los "Próximamente" de Contabilidad General en Registraciones y Consultas;
  - `rutas.tsx` (`/contabilidad/asiento`, `/contabilidad/periodos`, `/contabilidad/diario`, `/contabilidad/mayor`, `/contabilidad/sumas-saldos`, `/contabilidad/situacion`, `/contabilidad/resultados`, `/contabilidad/libros` y `/contabilidad/asientos/:id`);
  - `RolesPage` (grupos `asiento` y `contabilidad`: 'Contabilidad').
- Test: `apps/web/src/contabilidad/asiento.test.ts` y `GrillaAsiento.test.tsx`

- [ ] **Step 1: Tests que fallan**
  - `totalesAsiento([{debe:'1000.10'},{haber:'1000.1'}])` → diferencia 0.
  - `GrillaAsiento`: con un debe de 100 y un haber de 90 muestra "Diferencia $ 10,00" y deja deshabilitado el botón "Registrar asiento". Al cambiar el haber a 100, se habilita.
- [ ] **Step 2–4:** PASS; `tsc` y `vite build` sin errores; el test de rutas en verde.
- [ ] **Step 5: Commit** `feat(web): contabilidad general`

---

### Task 9: Seed, e2e y README

**Files:**
- Modify:
  - `seed/demo.ts`: ejercicio; rol Contador con los permisos nuevos; usuario `contador@demo.com` / `contador1234`.
  - `seed/demo-completo.ts`: asiento manual de aporte de capital de 5.000.000 (1.1.01.002 contra 3.1.01) con fecha del inicio del ejercicio o del primer día del mes anterior, lo que sea posterior.
  - `test/seed.e2e-spec.ts`, `README.md`.
- Create: `e2e/contabilidad.spec.ts`. Corre en el proyecto `general`: cierra solo meses anteriores, que no afectan a las otras pruebas, porque estas usan la fecha de hoy.

- [ ] **Step 1: Tests que fallan**
  - **`seed.e2e-spec`:** existe el ejercicio con 12 meses, hay un asiento MANUAL de aporte y el usuario contador existe.
  - **`e2e/contabilidad.spec.ts`** (contador):
    1. Asiento manual con fecha del día 10 del mes anterior (debe "Gastos generales" 1.500, haber "Caja" 1.500).
    2. Lo encuentra en el Diario (por descripción única) y en el Mayor de 5.2.01.
    3. En Períodos cierra los meses del ejercicio hasta el mes anterior inclusive.
    4. El Diario muestra un número definitivo para el asiento.
    5. En Libros emite el Diario del mes anterior y se descarga un PDF.
    - Si el mes anterior cae en otro ejercicio (prueba corrida en enero), se usa el primer día del mes actual menos 1 día igualmente, y se abre antes el ejercicio siguiente si hace falta.
- [ ] **Step 2–4:** `pnpm test`, `vitest` y `pnpm e2e` en verde, con la base e2e recreada.
- [ ] **Step 5:** README: sección "Contabilidad general (Entrega 5)", con el usuario contador y el aviso de que no incluye ajuste por inflación.
- [ ] **Step 6: Commit** `feat: datos demo y prueba de punta a punta de contabilidad`

---

## Cobertura de la spec

| Spec | Task |
|---|---|
| §1 Ejercicios y períodos | 1, 8 |
| §2 Control de fechas | 1 |
| §3 Asientos manuales | 2, 8 |
| §4 Cierre de mes | 3, 8 |
| §5 Consultas | 4, 8 |
| §6 Cierre del ejercicio | 5, 8 |
| §7 Estados contables | 6, 8 |
| §8 Libros legales | 7, 8 |
| §9 Web | 8 |
| §10 Permisos y concurrencia | 1, 3 |
| §11 Pruebas y seed | todas, 9 |

**Decisiones del plan que la spec no fijaba:**
- La fecha del aporte de capital de la demo, para que el e2e tenga un mes anterior con movimientos.
- La extracción de texto del PDF en las pruebas se hace generando el PDF sin compresión en modo test (`compress: false` si `NODE_ENV=test`).
- En el Mayor, el saldo inicial se calcula siempre dentro del ejercicio de `desde`.
