# Entrega 19: Sueldos parte 2 (contribuciones, asiento, pagos y F.931). Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una liquidación cerrada genere su asiento con contribuciones patronales, se pague desde Tesorería (netos y cargas sociales) y produzca el archivo F.931 de SICOSS.

**Architecture:**
- **Cálculo y F.931:** funciones puras en `apps/api/src/sueldos/` (`calculo.ts` para las contribuciones y `f931-diseno.ts` para la tabla de campos y la línea).
- **Servicios nuevos:**
  - `contribuciones.service.ts`: maestros de contribuciones, parámetros y configuración;
  - `contabilizacion.service.ts`: asiento al cerrar, reabrir y contabilizar;
  - `pagos.service.ts`: pagos de sueldos y de cargas sociales;
  - `f931.service.ts`.
- **Reutiliza:** `AsientosService.generar/contraasiento`, `registrarMovimiento/anularMovimientos` de Tesorería y `NumeracionService`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-entrega-19-sueldos-contabilidad-f931-design.md`; las decisiones de §9 son vinculantes.

## Global Constraints

- **Mensajes:** los mensajes exactos del spec (§3, §4, §5, §9).
- **Importes:** Decimal y redondeo half-up a 2 decimales.
- **Pruebas:** reloj congelado en 2026-11-06; empresa y ejercicio de `sesionConPlan` (`test/helpers.ts`); escenario de sueldos con `prepararSueldos` (`test/helpers-sueldos.ts`).
- **Modelos nuevos:** van todos en `MODELOS_DE_EMPRESA` (`src/prisma/modelos-empresa.ts`).
- **Migración:** `apps/api/prisma/migrations/20261118090000_sueldos_contabilidad/migration.sql`, generada con `prisma migrate diff` más SQL de datos. Se aplica a `gestion` y a `gestion_test`.
- **F.931:**
  - 60 campos y 499 caracteres por línea, CRLF, latin1;
  - formatos:
    - **N:** ceros a la izquierda;
    - **C:** alineado a la izquierda con espacios;
    - **I:** 2 decimales con coma, sin miles, alineado a la derecha con espacios.

## Review Focus

1. **Empleado sin días trabajados en el mes** (egreso anterior conservado por un recibo numerado, o ingreso posterior) → sin contribuciones, sin fijos, y el asiento sigue balanceando. Prueba en Task 1.
2. **Detracción mayor que la remuneración** (ingreso el último día del mes, remuneración muy baja) → la base queda en 0, nunca negativa. Prueba en Task 1.
3. **Cerrar con el mes contable cerrado** → 400, la liquidación sigue en borrador y no se consume ningún número de recibo. Prueba en Task 4.
4. **Dos pagos simultáneos del mismo recibo** → uno 201 y el otro 400 `El recibo del legajo N ya está pagado`, sin doble egreso. Prueba en Task 5.
5. **Nombre con ñ, tildes o de más de 30 caracteres, y obra social sin código** → el campo se recorta y se normaliza, la línea mide 499 y la liquidación avisa por la obra social. Prueba en Task 6.

---

### Task 1: Cálculo de contribuciones y tope de aportes

**Files:** Modify `apps/api/src/sueldos/calculo.ts`, `apps/api/src/sueldos/calculo.spec.ts`.

**Interfaces:**
- **Produces** `interface ContribucionCalc { codigo: string; nombre: string; destino: 'SEGURIDAD_SOCIAL' | 'OBRA_SOCIAL' | 'ART' | 'SEGURO_VIDA'; alicuota: Dec; importeFijo: Dec; aplicaDetraccion: boolean; cuentaContableId: string }`.
- **Produces** `calcularContribuciones(remunerativo: Dec, diasTrabajados: number, tipo: 'MENSUAL' | 'SAC', contribuciones: ContribucionCalc[], detraccion: Dec): { codigo; nombre; destino; base: Dec; alicuota: Dec; importe: Dec; cuentaContableId }[]`.
  - Omite importes 0.
  - Con días 0 en el mensual devuelve `[]`.
- **Produces** `liquidarMes`/`liquidarSac` con un parámetro final opcional `baseMaxima?: Dec | null`. Los `DESCUENTO_LEY` con `parametros.tope === 'BASE_MAXIMA'` limitan la base con `baseMaxima`; en `liquidarSac`, con `baseMaxima / 2`. `null` significa sin tope.
- **Produces** `validarConcepto` admite `tope: 'BASE_MAXIMA'` además de un número.

- [ ] **Step 1: Tests que fallan.**
  - `it('contribuciones del ejemplo')`:
    - con remunerativo 1.168.965,00, 30 días, MENSUAL, detracción 7.003,68 y la precarga del spec §2;
    - resultado: SIPA `125143.23`, PAMI `18475.18`, FNE `10922.44`, AAFF `54612.18`, OS `70137.90`, ART `30724.13`, SCVO `1000.00`;
    - suma `311015.06`; base de SIPA `1161961.32`.
  - `it('mes parcial y SAC')`:
    - 15 días → detracción 3.501,84 y fijos enteros (ART incluye 1.500 y SCVO es 1.000);
    - SAC de 584.482,50 → detracción 3.501,84, sin fijos (SCVO ausente, ART solo con el 2,5 %).
  - `it('sin días y detracción mayor que la base')` (Review Focus 1 y 2):
    - 0 días → `[]`;
    - remunerativo 5.000 con 30 días → base SS `0` e importes SS ausentes; OS `300.00`.
  - `it('tope BASE_MAXIMA')`:
    - remunerativo 1.168.965 con baseMaxima 1.000.000 y jubilación `{ pct: 11, tope: 'BASE_MAXIMA' }` → `110000.00`;
    - en el SAC (584.482,50 con baseMaxima 1.000.000) → la base es 500.000 y el importe `55000.00`;
    - con `null` → sin tope.
  - `validarConcepto('DESCUENTO_LEY', 'DESCUENTO', { pct: 11, tope: 'BASE_MAXIMA' })` → `null`; `tope: 'OTRO'` → `Parámetro tope inválido`.
- [ ] **Step 2:** `npx jest src/sueldos/calculo` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS, con los 7 casos de la Entrega 18 intactos.
- [ ] **Step 5:** Commit `feat(sueldos): cálculo de contribuciones patronales y tope de aportes`.

### Task 2: Diseño de registro F.931

**Files:** Create `apps/api/src/sueldos/f931-diseno.ts`, `apps/api/src/sueldos/f931-diseno.spec.ts`.

**Interfaces:**
- **Produces** `interface DatosF931`. Lleva un campo por cada origen de la tabla del spec §5:
  - **del empleado:** `cuil`, `apellidoNombre`, `conyuge`, `cantidadHijos`, `codigoSituacion`, `codigoCondicion`, `codigoActividad`, `codigoZona`, `codigoModalidad`, `codigoObraSocial`, `adherentes`, `codigoSiniestrado`, `regimen`, `diaInicioRevista`, `convencionado`;
  - **de la empresa:** `localidad`, `tipoEmpresa`, `scvo: boolean`;
  - **importes (`Dec`):** `remuneracionTotal`, `imponible1`, `imponible2`, `imponible3`, `imponible4`, `imponible5`, `imponible8`, `imponible9`, `imponible11`, `sueldoAdicionales`, `sac`, `horasExtrasImporte`, `noRemunerativo`, `detraccion`;
  - **cantidades (`number`):** `diasTrabajados`, `horasExtras`.
- **Produces** `CAMPOS_F931: { numero: number; nombre: string; largo: number; tipo: 'N' | 'C' | 'I'; valor: (d: DatosF931) => string | number | Dec }[]` (los 60 del spec, en orden).
- **Produces** `lineaF931(d: DatosF931, legajo: number): string`. Lanza `El importe de <campo> del legajo N excede el largo del archivo`.
- **Produces** `normalizarTexto(s: string): string` (mayúsculas, sin tildes, Ñ → N, solo ASCII imprimible).

- [ ] **Step 1: Tests que fallan.**
  - `it('tabla')`:
    - 60 campos, suma de largos 499;
    - posición inicial de cónyuge 42, hijos 43, situación 45;
    - campo 37 (SAC) largo 12.
  - `it('línea del ejemplo')`:
    - largo 499;
    - `slice(0, 11)` = `'20172543597'`;
    - `slice(11, 41)` = `'PEREZ JUAN'.padEnd(30)`;
    - campo 13 = `'  1168965,00'`;
    - campo 11 = `'125000'`;
    - campos de valor 0 tipo I = `'        0,00'` (largo 12).
  - `it('normaliza y recorta')` (Review Focus 5): `'Muñoz Peña, María José de los Ángeles Etcheverry'` → 30 caracteres sin tildes, que empiezan con `'MUNOZ PENA'`.
  - `it('importe que no entra')`: un imponible1 de `1e12` → lanza el mensaje.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Las posiciones se calculan sumando largos, no se escriben a mano.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(sueldos): diseño de registro del F.931`.

### Task 3: Modelo, migración y maestros de contribuciones

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma`;
  - migración `20261118090000_sueldos_contabilidad`;
  - `apps/api/src/sueldos/{modelo.ts,dto.ts,maestros.service.ts,sueldos.module.ts}`;
  - `apps/api/src/seed/plan-cuentas-modelo.ts` (cuentas nuevas);
  - `src/prisma/modelos-empresa.ts`.
- Create `apps/api/src/sueldos/{contribuciones.service.ts,contribuciones.controller.ts}`.
- Test `apps/api/test/sueldos-contribuciones.e2e-spec.ts`.

**Interfaces:**
- **Schema:**
  - **Modelos nuevos:** `ContribucionPatronal`, `ParametroPrevisional`, `ConfiguracionSueldos`, `ReciboSueldoContribucion`, `PagoSueldos`, `PagoSueldosRecibo`, `PagoCargasSociales` (campos del spec §2 a §4).
  - **Enums nuevos:** `DestinoContribucion` y `DestinoDescuento` (`SEGURIDAD_SOCIAL | OBRA_SOCIAL | SINDICAL | OTRO`).
  - **Cambios en modelos existentes:**
    - `Concepto`: `destino DestinoDescuento @default(OTRO)` y `cuentaContableId String? @db.Uuid`;
    - `ReciboSueldo`: `centroCostoId String? @db.Uuid`;
    - `Liquidacion`: `asientoId String? @db.Uuid`;
    - `Empleado`: los campos F.931 del spec §5 con sus defaults;
    - `Empresa`: `codigoZonaSicoss Int @default(0)` y `tipoEmpresaSicoss Int @default(1)`.
- **Datos de la migración** (para cada empresa existente):
  - cuentas `2.1.03`, `2.1.03.001`, `2.1.03.002`, `2.1.03.003`, `5.2.09` y `5.2.10`, si el código está libre;
  - `ConfiguracionSueldos`;
  - las 7 contribuciones desde 01/2026;
  - el parámetro 01/2026 (3.500.000 y 7.003,68);
  - conceptos 500 y 510 → `SEGURIDAD_SOCIAL`, 520 → `OBRA_SOCIAL`, 530 y 540 → `SINDICAL`;
  - 500, 510 y 520 con `tope: 'BASE_MAXIMA'` si no tienen tope;
  - `ReciboSueldo.centroCostoId` desde el empleado.
- **Precarga de empresas nuevas:** `cargarSueldosModelo(tx, empresaId)` hace lo mismo, después de que el plan de cuentas existe.
- **Produces** `ContribucionesService`:
  - `vigentes(tx, anio, mes): Promise<ContribucionCalc[]>`;
  - `parametros(tx, anio, mes): Promise<{ baseMaxima: Dec | null; detraccion: Dec; aviso?: string }>`;
  - `configuracion(tx): Promise<ConfiguracionSueldos>`. Lanza `Configure las cuentas de sueldos` si falta alguna.
- **Endpoints:**
  - `GET/POST /api/sueldos/contribuciones` (POST crea una vigencia: `{ codigo, nombre, destino, alicuota, importeFijo, aplicaDetraccion, cuentaContableId, desdeAnio, desdeMes }`);
  - `PUT /api/sueldos/contribuciones/:id`;
  - `GET/PUT /api/sueldos/parametros?anio&mes`;
  - `GET/PUT /api/sueldos/configuracion`;
  - empleados y conceptos aceptan los campos nuevos.
  - Permisos: `sueldos.ver` para GET y `sueldos.liquidar` para escribir.

- [ ] **Step 1: Tests que fallan** (`sueldos-contribuciones.e2e-spec.ts`):
  - `it('empresa nueva trae contribuciones, parámetros, cuentas y configuración')`: 7 contribuciones; parámetro 01/2026; configuración con las cuentas `5.2.09`, `5.2.10`, `2.1.03.001`, `2.1.03.002` y `2.1.03.003`; concepto 540 `destino: 'SINDICAL'`.
  - `it('vigencias')`: nueva SIPA 12,35 desde 12/2026 → `vigentes(11/2026)` usa 10,77 y `vigentes(12/2026)` 12,35.
  - `it('parámetros por mes')`: sin fila de 11/2026 → se usa la de 01/2026; PUT 11/2026 → se usa la nueva.
  - `it('empleado con datos F.931')`: POST con `codigoObraSocial: '125000'`, `conyuge: true`, `cantidadHijos: 2` → GET los devuelve; los defaults son `codigoSituacion 1` y `codigoModalidad 8`.
  - `it('permisos')`: sin `sueldos.liquidar`, el POST de contribuciones da 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar. Correr migrate diff, deploy y `prisma generate`.
- [ ] **Step 4:** PASS; `test/sueldos*` en verde.
- [ ] **Step 5:** Commit `feat(sueldos): contribuciones patronales, parámetros previsionales y datos F.931`.

### Task 4: Asiento al cerrar, reabrir y contabilizar

**Files:**
- Create `apps/api/src/sueldos/contabilizacion.service.ts`.
- Modify `apps/api/src/sueldos/{liquidaciones.service.ts,liquidaciones.controller.ts,sueldos.module.ts}` (importa `ContabilidadModule` o el módulo que exporta `AsientosService`).
- Test `apps/api/test/sueldos-asiento.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** Task 1 `calcularContribuciones` y `baseMaxima`; Task 3 `ContribucionesService`.
- **Produces** `ContabilizacionService.contabilizar(tx, l: Liquidacion): Promise<{ id: string; numero: number }>`:
  - graba `ReciboSueldoContribucion` y genera el asiento del spec §3 (`origenTipo 'LIQUIDACION_SUELDO'`, `origenId` = liquidación);
  - fija `Liquidacion.asientoId`.
- **Produces** `ContabilizacionService.anular(tx, l)`: contraasiento con la fecha del asiento; borra las contribuciones; `asientoId = null`.
- **Cambios en `liquidaciones.service.ts`:**
  - `calcular` guarda `centroCostoId` en el recibo y pasa `baseMaxima`;
  - `cerrar` llama a `contabilizar` en la misma transacción;
  - `reabrir` valida pagos de sueldos y de cargas del mes (los mensajes del spec §3 y §9.1) y llama a `anular`;
  - `obtener` agrega `asiento`, `contribuciones` (en borrador, calculadas sin grabar), `pagos`, `pendientePago` y `pagado` por recibo, y el aviso de parámetros o de obra social faltante.
- **Nuevo endpoint:** `POST :id/contabilizar`.

- [ ] **Step 1: Tests que fallan:**
  - `it('asiento del ejemplo')`:
    - escenario de la Entrega 18 (Vendedor B 1.000.000, 11/2026, 4 h al 50 %), cerrar;
    - renglones por código de cuenta: `5.2.09` debe `1168965.00`, `5.2.10` debe `311015.06`, `2.1.03.001` haber `941016.82`, `2.1.03.002` haber `509739.11`, `2.1.03.003` haber `29224.13`;
    - fecha `2026-11-30`; `GET` → `asiento.numero` y `contribuciones.total '311015.06'`.
  - `it('centros de costo')`: dos empleados en Rosario y Córdoba → `5.2.09` y `5.2.10` con un renglón por centro; los pasivos sin centro; el debe y el haber balancean.
  - `it('cerrar con mes contable cerrado')` (Review Focus 3): con el período de 11/2026 cerrado (con el mecanismo de cierre de período que use el servicio de asientos) → 400, estado `BORRADOR` y `numero` de recibo `null`.
  - `it('reabrir')`:
    - cerrar y reabrir → existe el contraasiento (`anulaAId`), `asiento null` y sin contribuciones grabadas;
    - volver a cerrar → asiento nuevo.
  - `it('contabilizar cerradas sin asiento')`:
    - una liquidación cerrada con `asientoId` puesto en null por prisma → `POST contabilizar` 201;
    - otra vez → 400 `La liquidación ya está contabilizada`.
  - `it('SAC')`: SAC de diciembre (mensuales de 07 a 12 cerradas, con escala) → asiento del 2026-12-31 con contribuciones sin fijos.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS; `test/sueldos*` en verde.
- [ ] **Step 5:** Commit `feat(sueldos): asiento de la liquidación con contribuciones patronales`.

### Task 5: Pagos de sueldos y de cargas sociales

**Files:**
- Create `apps/api/src/sueldos/{pagos.service.ts,pagos.controller.ts}`.
- Modify `sueldos.module.ts`.
- Test `apps/api/test/sueldos-pagos.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** Task 4 (liquidación cerrada con `asientoId`); `registrarMovimiento` y `anularMovimientos` de `src/tesoreria/operaciones/tesoreria-comun.ts`; las cuentas contables de `CuentaBancaria` y `Caja` (`cuentaContableId`); talonarios `PAGO_SUELDOS` y `PAGO_CARGAS`.
- **Produces** `PagosSueldosService`:
  - `pagar(liquidacionId, { fecha, cuentaBancariaId?, cajaId?, reciboIds? })`;
  - `anular(pagoId)`;
  - `cargasSociales(anio, mes)`: `[{ cuentaContableId, codigo, nombre, devengado, pagado, pendiente, detalle?: { aportesSS, aportesOS, contribucionesSS, contribucionesOS, art, scvo } }]`;
  - `pagarCargas({ anio, mes, cuentaContableDeudaId, importe, fecha, cuentaBancariaId?, cajaId?, detalle? })`;
  - `anularCargas(id)`.
- **Endpoints** (spec §4):
  - `POST /api/sueldos/liquidaciones/:id/pagos`;
  - `POST /api/sueldos/pagos/:id/anular`;
  - `GET /api/sueldos/cargas-sociales?anio&mes`;
  - `POST /api/sueldos/cargas-sociales/pagos`;
  - `POST /api/sueldos/cargas-sociales/pagos/:id/anular`.
- **Doble pago:** para evitarlo, la transacción toma `SELECT … FOR UPDATE` sobre la liquidación antes de verificar los recibos ya pagados.

- [ ] **Step 1: Tests que fallan:**
  - `it('pagar todos')`:
    - cuenta bancaria de la empresa → 201;
    - `pendientePago '0.00'`; movimiento EGRESO de `941016.82`;
    - asiento con debe `2.1.03.001`, haber la cuenta contable del banco.
  - `it('pagar algunos y luego el resto')`: con dos empleados; pagar uno y después sin `reciboIds` → paga solo el que faltaba.
  - `it('no paga dos veces')` (Review Focus 4):
    - `Promise.all` de dos pagos del mismo recibo → un 201 y un 400 `El recibo del legajo 1 ya está pagado`;
    - un solo movimiento.
  - `it('requisitos')`: borrador → 400 `La liquidación no está cerrada`.
  - `it('anular y reabrir')`:
    - reabrir con pago → 400 `La liquidación tiene pagos: anúlelos antes de reabrir`;
    - anular → movimiento anulado y contraasiento; reabrir → 201.
  - `it('cargas sociales')`:
    - `GET 2026/11` → `2.1.03.002` con devengado `509739.11`, pendiente igual y detalle `{ aportesSS: '163655.10', aportesOS: '35068.95', contribucionesSS: '209153.03', contribucionesOS: '70137.90', art: '30724.13', scvo: '1000.00' }`;
    - `2.1.03.003` con `29224.13`;
    - pagar `509739.11` → pendiente `0.00`;
    - pagar de más → 400 `El importe supera lo pendiente (pendiente $ 0,00)`;
    - reabrir con cargas pagadas → 400 `Hay pagos de cargas sociales de 11/2026: anúlelos antes de reabrir`;
    - anular el pago de cargas → pendiente otra vez.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. Correr la suite API completa (dos mitades con `--shard`, sin otras pruebas en paralelo).
- [ ] **Step 5:** Commit `feat(sueldos): pagos de sueldos y de cargas sociales`.

### Task 6: Archivo F.931

**Files:**
- Create `apps/api/src/sueldos/{f931.service.ts,f931.controller.ts}`.
- Test `apps/api/test/sueldos-f931.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** Task 2 `lineaF931`, `DatosF931`; recibos, renglones y novedades de las liquidaciones cerradas del mes; parámetros de Task 3.
- **Produces** `GET /api/sueldos/f931?anio&mes` (`sueldos.ver`):
  - `text/plain; charset=windows-1252`, adjunto `F931-AAAAMM.txt`;
  - líneas ordenadas por CUIL, separadas por `\r\n`;
  - errores 400 del spec §5 y §9.3.
- **Mapeo:**
  - remunerativo con tope = `min(remunerativo, baseMaxima)` por liquidación (en el SAC, `baseMaxima / 2`), sumados;
  - `imponible11` = remunerativo − detracción aplicada (sin bajar de 0);
  - `diaInicioRevista` = día de ingreso si ingresó en el mes, si no 1;
  - `scvo` = existe la contribución SCVO activa con fijo > 0.

- [ ] **Step 1: Tests que fallan:**
  - `it('archivo del ejemplo')`:
    - cerrar noviembre → 1 línea de 499 caracteres;
    - CUIL; total `'  1168965,00'`;
    - campo 50 (horas) `'004'`; campo 41 (días) `'    30,00'`, según el tipo I de 9 del diseño;
    - campo 58 `'     7003,68'`;
    - nombre de archivo `F931-202611.txt`.
  - `it('nombre con tildes y obra social faltante')` (Review Focus 5):
    - empleado `Muñoz Peña` sin `codigoObraSocial` → línea de 499 con `MUNOZ PENA`;
    - `GET` de la liquidación con aviso `Falta el código de obra social de 1`.
  - `it('mensual y SAC de diciembre')`:
    - con base máxima 1.000.000 en 12/2026: imponible1 = 1.000.000 (mensual) + 500.000 (SAC) = `'  1500000,00'`;
    - campo 37 con el SAC.
  - `it('SAC cerrado sin mensual')` → 400 `La liquidación mensual de 12/2026 no está cerrada`.
  - `it('sin liquidaciones')` → 400 `No hay liquidaciones cerradas de 10/2026`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS; `test/sueldos*` en verde.
- [ ] **Step 5:** Commit `feat(sueldos): archivo F.931 para SICOSS`.

### Task 7: Web

**Files:**
- Create:
  - `apps/web/src/sueldos/{ContribucionesPage.tsx,CargasSocialesPage.tsx,PanelPagos.tsx,contribuciones.test.tsx}`.
- Modify:
  - `apps/web/src/sueldos/{comun.ts,EmpleadosPage.tsx,ConceptosPage.tsx,LiquidacionPage.tsx}`;
  - `apps/web/src/layout/menu.ts` (Contribuciones y Cargas sociales en Sueldos);
  - `apps/web/src/paginas/rutas.tsx` (`/sueldos/contribuciones` y `/sueldos/cargas-sociales`).

**Interfaces:** exportados para las pruebas:
- `TablaContribuciones({ filas })`;
- `PanelPagos({ recibos, onPagar })`, donde `onPagar(reciboIds: string[])` y los recibos tienen `pagado: boolean`;
- `TablaCargasSociales({ filas, onPagar })`.

- [ ] **Step 1: Tests que fallan:**
  - `TablaContribuciones` con SIPA 10,77 desde 01/2026 y 12,35 desde 12/2026 → dos filas con `01/2026` y `12/2026`, y la alícuota en formato `10,77 %`.
  - `PanelPagos` con dos recibos, uno pagado:
    - el pagado aparece marcado "Pagado" y sin checkbox;
    - "Pagar seleccionados" con el otro tildado llama a `onPagar(['r2'])`.
  - `TablaCargasSociales` con pendiente `509739.11` → `$ 509.739,11` y el botón Pagar; pendiente 0 → sin botón.
  - Menú: con `sueldos.ver` aparece "Cargas sociales".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar:
  - ficha del empleado con la sección "Datos para el F.931";
  - conceptos de descuento con destino y cuenta;
  - liquidación con tarjeta de contribuciones, enlace al asiento, "Contabilizar", `PanelPagos` y "Descargar F.931".
- [ ] **Step 4:** PASS; suite web y build en verde.
- [ ] **Step 5:** Commit `feat(web): contribuciones, pagos, cargas sociales y F.931`.

### Task 8: E2E y README

**Files:** Create `e2e/sueldos-pagos.spec.ts`; Modify `README.md`.

- [ ] **Step 1: Test** `test('sueldos: el contador cierra, ve el asiento, paga los netos, descarga el F.931 y paga las cargas sociales')`:
  - empleado y escala como en `e2e/sueldos.spec.ts`, con un CUIL distinto;
  - liquidación del mes actual;
  - pago desde la cuenta bancaria de la demo;
  - descarga `F931-AAAAMM.txt`;
  - pago de cargas sociales;
  - pendiente `$ 0,00`.
  - Si ambas pruebas de sueldos usan el mismo mes, esta usa el mes anterior.
- [ ] **Step 2:** Recrear `gestion_e2e`; `pnpm e2e -- --trace off` → 17/17.
- [ ] **Step 3:** README, sección "Sueldos: contabilidad, pagos y F.931 (Entrega 19)". Debe decir que el diseño del F.931 conviene verificarlo contra el manual de ARCA.
- [ ] **Step 4:** Suites API, web y e2e en verde.
- [ ] **Step 5:** Commit `test(e2e): pagos de sueldos y F.931; docs: README entrega 19`.
