# Ganancias de cuarta categoría (retención mensual): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que cada liquidación calcule la retención de Ganancias de cuarta categoría con las tablas de ARCA y el F.572 de cada empleado, y la descuente.

**Architecture:**
- **Cálculo puro** (`ganancias/calculo.ts`): recibe los acumulados del año, la tabla del semestre, las deducciones y las cargas, y devuelve el importe y la hoja de cálculo.
- **Integración:** el servicio de liquidaciones arma los acumulados (recibos cerrados del año, acumulado previo y otros empleadores del F.572) y agrega el renglón del concepto `GANANCIAS` después del cálculo de cada recibo.
- **F.572:** se importa del XML del SiRADIG con un mapeo declarativo.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, fast-xml-parser (ya instalado), Jest/supertest, React 19 + Mantine 7, Vitest y Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-entrega-31-ganancias-cuarta-design.md`

## Global Constraints

- **Permiso nuevo:** `ganancias.configurar`. La migración lo agrega a los Administrador (`array_append`).
- **Concepto de la precarga:**
  - código `560`, `Impuesto a las ganancias`;
  - clase `DESCUENTO`, tipo `GANANCIAS`, destino `OTRO`;
  - `codigoArca` `810008`;
  - cuenta `2.1.02.002`.
- **Mensajes:**
  - `Cargue la tabla de Ganancias de <1.er|2.º> semestre <año>`;
  - `Empleado inexistente (CUIL …)`;
  - `El F.572 de <Apellido, Nombre> está dirigido a otro empleador (CUIT …)`;
  - `Presentación N ya importada`;
  - `Hay una liquidación cerrada con fecha de pago posterior (N° X): ciérrelas en orden de fecha de pago`;
  - `Hay liquidaciones posteriores cerradas: su retención de Ganancias no se recalcula`.
- **Prorrateo:** valores anuales × *m*/12, con *m* = mes de la fecha de pago. El año fiscal es el de la fecha de pago.
- **Tope del mes:** 35 % de (remunerativo + no remunerativo) del recibo.
- **Devolución:** hasta lo retenido por la empresa en el año.
- **Migración:** se genera con `prisma migrate diff`, sin crear antes la carpeta vacía. Se aplica en `gestion` y `gestion_test`, y se verifica en `gestion_mig`.

## Review Focus

1. **Empleado que se liquida dos veces en el mismo mes** (mensual y SAC con la misma fecha de pago). El segundo acumula al primero; no se retiene dos veces. Prueba en Task 4.
2. **F.572 con un código de deducción desconocido.** Se importa como `OTRA`, no se deduce, avisa y no rompe la importación. Prueba en Task 3.
3. **Un mes con remuneración muy baja después de meses altos.** La retención llega al tope del 35 % y el excedente se retiene después; nunca da un neto negativo. Prueba en Task 2.
4. **Liquidación en borrador recalculada después de importar un F.572 nuevo.** Toma las deducciones nuevas y devuelve si corresponde. Prueba en Task 4.
5. **Empresa que no es agente de retención con el concepto 560 activo.** No agrega el renglón. Prueba en Task 4.

---

### Task 1: Modelos, migración y tablas de ARCA

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma`;
  - migración nueva;
  - `packages/shared/src/permisos.ts` (`ganancias.configurar`);
  - `apps/api/src/sueldos/modelo.ts` (concepto 560);
  - `apps/api/src/sueldos/dto.ts` (`exentoGanancias` y el tipo `GANANCIAS`).
- Create: `apps/api/src/sueldos/ganancias/{tablas.service.ts,tablas.controller.ts,dto.ts}`.
- Test: `apps/api/test/ganancias-tablas.e2e-spec.ts`.

**Interfaces:**
- **Produces (esquema):**
  - `TablaGanancias { id, empresaId, anio, semestre (1|2), gni, deduccionEspecial, conyuge, hijo, hijoIncapacitado, topeHipotecario, topeSeguroMuerte, topeSeguroMixto, topeSeguroRetiro, topeSepelio }`, todos los importes `Decimal(18,2)`, único `(empresaId, anio, semestre)`;
  - `TramoGanancias { id, empresaId, tablaId, desde, hasta?, fijo, porcentaje Decimal(7,4) }`;
  - `F572 { id, empresaId, empleadoId, anio, nroPresentacion Int, fecha Date?, origen ('IMPORTADO'|'MANUAL'), modificadoAMano Boolean, datos Json }`, único `(empleadoId, anio)`. `datos` tiene el tipo `DatosF572` (Task 3);
  - `AcumuladoGanancias { id, empresaId, empleadoId, anio, bruta, aportes, retenido }`, único `(empleadoId, anio)`;
  - `Concepto.exentoGanancias Boolean @default(false)`;
  - `ReciboSueldo.hojaGanancias Json?`;
  - `enum TipoConcepto` con `GANANCIAS`.
- **Produces (servicio y rutas):**
  - `TablasGananciasService.tabla(tx, anio: number, mes: number): Promise<TablaConTramos | null>`, que devuelve la tabla del semestre del mes;
  - `GET/PUT /api/sueldos/ganancias/tablas/:anio/:semestre` con `ganancias.configurar` (el GET también con `sueldos.ver`);
  - el cuerpo del PUT es `{ gni, deduccionEspecial, conyuge, hijo, hijoIncapacitado, topes: {...}, tramos: [{ desde, hasta, fijo, porcentaje }] }`;
  - `POST …/tablas/:anio/:semestre/copiar-anterior`.

- [ ] **Step 1: Pruebas que fallan (`ganancias-tablas.e2e-spec.ts`):**
  - `it('guardar y leer')`: PUT con 3 tramos → GET los devuelve ordenados.
  - `it('tramos inválidos')`:
    - el primero con `desde` 500 → 400 `El primer tramo empieza en 0`;
    - un hueco → 400 `Los tramos deben ser consecutivos`;
    - el último con `hasta` → 400 `El último tramo no tiene límite`.
  - `it('copiar del semestre anterior')`: con 2026/1 cargada, POST copiar en 2026/2 → mismos importes y tramos. Sin la anterior → 400 `No hay tabla del semestre anterior`.
  - `it('precarga del concepto 560')`: una empresa nueva tiene `560` tipo `GANANCIAS`, `codigoArca` `810008` y la cuenta 2.1.02.002.
  - `it('permisos')`: sin `ganancias.configurar` el PUT da 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - **Esquema y migración.** La migración:
    - crea el concepto `560` (o el primer código libre desde 561) en cada empresa que tiene `ConfiguracionSueldos`, con la cuenta 2.1.02.002 si existe;
    - agrega el permiso a los Administrador.
  - **Precarga** en `modelo.ts`.
  - **Rutas:** en `ganancias/tablas.controller.ts`, prefijo `sueldos/ganancias`.
- [ ] **Step 4:**
  - Migración en las tres bases.
  - En `gestion_mig`, cada empresa con sueldos tiene un concepto `GANANCIAS`.
  - PASS, más `test/sueldos-maestros` y `test/lsd-conceptos`.
- [ ] **Step 5:** Commit `feat(ganancias): tablas de ARCA y modelos`.

### Task 2: Cálculo puro de la retención

**Files:**
- Create: `apps/api/src/sueldos/ganancias/calculo.ts`.
- Test: `apps/api/src/sueldos/ganancias/calculo.spec.ts`.

**Interfaces:**
- **Produces:**
  - `type TipoDeduccion = 'CUOTAS_MEDICAS' | 'SEGURO_MUERTE' | 'SEGURO_MIXTO' | 'SEGURO_RETIRO' | 'DONACIONES' | 'INTERESES_HIPOTECARIOS' | 'SEPELIO' | 'GASTOS_MEDICOS' | 'INDUMENTARIA' | 'ALQUILER' | 'SERVICIO_DOMESTICO' | 'SGR' | 'VEHICULOS_CORREDORES' | 'INTERESES_CORREDORES' | 'EDUCACION' | 'CAJAS_JUBILACION' | 'OTRA'`.
  - `interface TablaCalc`: los importes de `TablaGanancias` en `Decimal`, más `tramos: { desde: Dec; hasta: Dec | null; fijo: Dec; porcentaje: Dec }[]`.
  - `interface DatosGanancias`, todo ya sumado a los meses 1..*m*:
    - `mes: number`;
    - `tabla: TablaCalc`;
    - `bruta: Dec` (incluye recibos cerrados del año, el recibo actual, el acumulado previo y otros empleadores);
    - `aportes: Dec`;
    - `deducciones: { tipo: TipoDeduccion; importe: Dec }[]`;
    - `cargas: { parentesco: 'CONYUGE' | 'HIJO' | 'HIJO_INCAPACITADO' | 'OTRO'; meses: number; porcentaje: number }[]`;
    - `retenidoAnterior: Dec`;
    - `retenidoEmpresa: Dec` (solo lo retenido por esta empresa en el año, para el límite de la devolución);
    - `brutaRecibo: Dec`.
  - `retencionGanancias(d: DatosGanancias): { importe: Dec; hoja: HojaGanancias }`.
  - `HojaGanancias` es un objeto plano con strings de 2 decimales:
    - `bruta`, `aportes`, `gananciaNeta`;
    - `deducciones: { tipo, informado, computado }[]`;
    - `personales: { gni, especial, cargas }`;
    - `sujeta`, `tramo: { desde, fijo, porcentaje }`, `impuesto`;
    - `retenidoAnterior`, `calculado`, `topeMes`, `importe`, `noRetenido`;
    - `avisos: string[]`.

- [ ] **Step 1: Pruebas que fallan.**
  - **Tabla de prueba (anual):**
    - GNI 1.200.000;
    - deducción especial 4.800.000;
    - cónyuge 1.200.000;
    - hijo 600.000;
    - hijo incapacitado 1.200.000;
    - topes: hipotecario 120.000, seguro de muerte 60.000, seguro mixto 60.000, seguro de retiro 60.000, sepelio 12.000;
    - tramos: [0 a 1.200.000, fijo 0, 5 %], [1.200.000 a 2.400.000, fijo 60.000, 10 %], [2.400.000 en adelante, fijo 180.000, 15 %].
  - **Casos:**
    - `it('bajo el mínimo')`: mes 1, bruta 400.000, aportes 68.000 → importe 0, `sujeta` `0.00`.
    - `it('ejemplo a mano')`: mes 1, bruta 2.000.000, aportes 340.000.
      - GN 1.660.000; personales 500.000; GSI 1.160.000;
      - tramo 3 con límites /12 (desde 200.000, fijo 15.000) → impuesto 15.000 + 15 % × 960.000 = 159.000 → importe `159000.00`.
    - `it('prorrateo por mes')`: mes 9, misma relación ×9 → impuesto acumulado `1431000.00`. Con `retenidoAnterior` 1.272.000 → importe `159000.00`.
    - `it('cargas de familia')`:
      - cónyuge 12 meses al 100 % → resta 1.200.000 × 1/12 en el mes 1 (con `meses: 1`);
      - un hijo con `meses: 1` al 50 % → resta 25.000.
    - `it('topes de deducciones')`:
      - cuotas médicas 200.000 con GN 1.660.000 → computa 83.000 (5 %);
      - gastos médicos informados 300.000 → 40 % = 120.000, limitado a 83.000 (los dos sobre la misma GN);
      - donaciones 100.000 → 5 % de (1.660.000 − 83.000 − 83.000) = 74.700;
      - alquiler 3.000.000 → 40 % = 1.200.000, limitado a GNI/12 = 100.000;
      - servicio doméstico 150.000 → 100.000;
      - educación 500.000 → 40 % = 200.000, limitado a 40.000;
      - hipotecario 50.000 → 10.000 (120.000/12);
      - `OTRA` 10.000 → 0 y un aviso.
    - `it('devolución')`: impuesto acumulado 100.000 con `retenidoAnterior` 150.000 y `retenidoEmpresa` 30.000 → importe `-30000.00` (limitado a lo retenido por la empresa).
    - `it('tope del 35 por ciento')` (Review Focus 3): calculado 500.000 con `brutaRecibo` 1.000.000 → importe `350000.00`, `noRetenido` `150000.00`.
- [ ] **Step 2:** FAIL (módulo inexistente).
- [ ] **Step 3: Implementar `retencionGanancias` según §5.3 a §5.5 de la spec.**
  - Las deducciones sin tope porcentual se restan antes de calcular la GN para los topes del 5 %.
  - Las cuotas médicas (1) y los gastos médicos (8) usan la misma GN; las donaciones, la GN menos esas dos.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ganancias): cálculo de la retención mensual`.

### Task 3: F.572 y acumulado previo

**Files:**
- Create:
  - `apps/api/src/sueldos/ganancias/f572-xml.ts`;
  - `apps/api/src/sueldos/ganancias/f572.service.ts`;
  - `apps/api/src/sueldos/ganancias/f572.controller.ts`.
- Test:
  - `apps/api/test/ganancias-f572.e2e-spec.ts`;
  - `apps/api/test/fixtures/f572-ejemplo.xml`, armado con la estructura de abajo.

**Interfaces:**
- **Produces:**
  - `DatosF572`:
    - `cargas: { parentesco: string; documento: string; nombre: string; mesDesde: number; mesHasta: number; porcentaje: number }[]`;
    - `otrosEmpleadores: { cuit: string; nombre: string; meses: { mes: number; bruta: string; aportes: string; retenido: string }[] }[]`;
    - `deducciones: { tipo: TipoDeduccion; codigo: string; prestador: string; meses: { mes: number; importe: string }[] }[]`.
  - `leerF572(xml: string): { cuil: string; cuitAgente: string; anio: number; nroPresentacion: number; fecha: string | null; datos: DatosF572; avisos: string[] }`.
  - **Mapeo declarativo provisional** en `f572-xml.ts` (§11 de la spec):
    - raíz `presentacion`: `periodo` → año; `nroPresentacion`; `fechaPresentacion`;
    - `empleado/cuit` → CUIL; `agenteRetencion/cuit`;
    - `cargasFamilia/cargaFamilia`: `tipoDoc`, `nroDoc`, `apellido`, `nombre`, `mesDesde`, `mesHasta`, `parentesco`, `porcentajeDeduccion`;
    - `ganLiqOtrosEmpEnt/empEnt`: `cuit`, `denominacion`; `ingresosAportes/ingAp` con atributo `mes` y los hijos `ganBrut`, `obraSoc`, `segSoc`, `sind`, `retGan`;
    - `deducciones/deduccion` con atributo `tipo`: `nroDoc`, `denominacion`; `periodos/periodo` con atributos `mesDesde`, `mesHasta` y `montoMensual`.
  - **Mapas de códigos provisionales:**
    - parentesco: `1` CONYUGE, `51` CONYUGE (unión convivencial), `3` HIJO, `31` HIJO_INCAPACITADO; el resto OTRO;
    - deducción:
      - `1` CUOTAS_MEDICAS, `2` SEGURO_MUERTE, `3` DONACIONES, `4` INTERESES_HIPOTECARIOS, `5` SEPELIO;
      - `7` GASTOS_MEDICOS, `8` SERVICIO_DOMESTICO, `9` SGR, `10` VEHICULOS_CORREDORES, `11` INTERESES_CORREDORES;
      - `22` ALQUILER, `23` SEGURO_MIXTO, `24` SEGURO_RETIRO, `32` EDUCACION, `33` INDUMENTARIA, `21` CAJAS_JUBILACION;
      - el resto OTRA.
  - **Rutas:**
    - `POST /api/sueldos/ganancias/f572/importar` (multipart `archivos[]`, opcional `confirmar=true`), con `sueldos.liquidar`; responde `{ importados: [{ archivo, empleado }], omitidos: [{ archivo, motivo }], pendientes: [{ archivo, empleado }] }`;
    - `GET/PUT /api/sueldos/ganancias/f572/:empleadoId/:anio` (el PUT marca `modificadoAMano` y `origen` MANUAL si no existía);
    - `GET/PUT /api/sueldos/ganancias/acumulado/:empleadoId/:anio` con `{ bruta, aportes, retenido }`.

- [ ] **Step 1: Pruebas que fallan (`ganancias-f572.e2e-spec.ts`):**
  - `it('importa el ejemplo')`:
    - con CUIL del empleado, agente igual a la empresa, un cónyuge (meses 1 a 12), una cuota médica (10.000 mensuales, de 1 a 12) y un otro empleador en el mes 3;
    - `importados` tiene 1;
    - el GET devuelve las cargas y las deducciones con `tipo` `CUOTAS_MEDICAS` y `codigo` `1`.
  - `it('CUIL inexistente')` y `it('agente distinto')` → en `omitidos`, con los mensajes de las Global Constraints.
  - `it('presentación repetida')`: importar dos veces la misma → la segunda en `omitidos` con `Presentación 1 ya importada`. Una con número 2 la reemplaza.
  - `it('no pisa una corrección manual sin confirmar')`:
    - PUT manual → importar el número 2 → `pendientes` con el empleado, y los datos siguen siendo los manuales;
    - con `confirmar=true` se reemplaza.
  - `it('código de deducción desconocido')` (Review Focus 2): un `tipo="99"` → la deducción se guarda como `OTRA` con `codigo` `99`, el archivo se importa y el resultado trae un aviso.
  - `it('acumulado previo')`: PUT y GET con `{ bruta: '5000000.00', aportes: '850000.00', retenido: '120000.00' }`.
  - `it('permisos')`: sin `sueldos.liquidar` importar da 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - Parser: `fast-xml-parser`, con atributos (`ignoreAttributes: false`, prefijo `@_`) y `isArray` para las listas.
  - Un archivo mal formado va a `omitidos` con `XML inválido`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ganancias): importación del F.572 web y acumulado previo`.

### Task 4: Retención en la liquidación

**Files:**
- Create: `apps/api/src/sueldos/ganancias/retencion.service.ts`.
- Modify:
  - `apps/api/src/sueldos/liquidaciones.service.ts` (después de `liquidarX` en `calcular`, en `cerrar` y en `reabrir`);
  - `apps/api/src/sueldos/calculo.ts` (que `descuentos` ignore el tipo `GANANCIAS`);
  - `apps/api/src/sueldos/salidas.controller.ts` o el que tenga los PDF de recibos (ruta de la hoja);
  - `apps/api/src/sueldos/maestros.service.ts` (aviso de conceptos con "ganancia").
- Test: `apps/api/test/ganancias-liquidacion.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** Tasks 1 a 3.
- **Produces:**
  - `RetencionGananciasService.aplicar(tx, l: Liquidacion, recibo: { empleadoId, renglones: RenglonCalc[], totalRemunerativo, totalNoRemunerativo }, conceptos): Promise<{ renglon: RenglonCalc | null; hoja: HojaGanancias | null }>`;
  - el renglón lleva `base` = sujeta acumulada y `porcentaje` = porcentaje del tramo;
  - `GET /api/sueldos/liquidaciones/:id/recibos/:reciboId/ganancias.pdf`, con `sueldos.ver`.

- [ ] **Step 1: Pruebas que fallan** (escenario: empresa agente, tabla 2026/2 de la Task 2, empleado con básico 3.000.000 en noviembre):
  - `it('renglón, neto y hoja')`:
    - el recibo tiene el renglón `560` con el importe de `retencionGanancias` sobre los datos del recibo;
    - el neto baja en ese importe;
    - `hojaGanancias.importe` coincide.
  - `it('sin tabla')`: sin la tabla 2026/2 → la liquidación da el error `Cargue la tabla de Ganancias de 2.º semestre 2026` en los errores del borrador y no se puede cerrar.
  - `it('empresa no agente')` (Review Focus 5): `agenteRetencionGanancias: false` → sin renglón 560.
  - `it('acumula liquidaciones cerradas y acumulado previo')`:
    - con octubre cerrada, la retención de noviembre resta lo retenido en octubre;
    - con un acumulado previo de `retenido` mayor que el impuesto, noviembre da devolución hasta lo retenido por la empresa en el año.
  - `it('mensual y SAC con la misma fecha de pago')` (Review Focus 1): diciembre mensual y SAC con fecha de pago 2026-12-18; se cierra la mensual y después el SAC → el SAC acumula la mensual. La suma de las dos retenciones es igual al impuesto acumulado de diciembre menos lo retenido antes.
  - `it('cierre fuera de orden')`: con una liquidación cerrada con fecha de pago 2026-12-20, cerrar otra con fecha 2026-12-05 → 400 `Hay una liquidación cerrada con fecha de pago posterior (N° X): ciérrelas en orden de fecha de pago`.
  - `it('F.572 nuevo recalcula el borrador')` (Review Focus 4): importar un F.572 con alquiler y recalcular → la retención baja.
  - `it('exento')`: un concepto FIJO no remunerativo con `exentoGanancias: true` no suma a la bruta de la hoja.
  - `it('asiento y Libro')`:
    - al contabilizar, el importe va a 2.1.02.002;
    - el Libro tiene un registro 03 con el código `560` (asociado a 810008 en el archivo de conceptos).
  - `it('hoja en PDF')`: el GET responde un PDF (`%PDF`).
  - `it('aviso de conceptos viejos')`: un concepto de descuento llamado `Ganancias 4ta` aparece en `GET /api/sueldos/conceptos/avisos`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - **Acumulados de `aplicar`:**
    - recibos de liquidaciones cerradas del empleado con fecha de pago en el año (excluida la propia);
    - más `AcumuladoGanancias`;
    - más los meses 1..*m* de `otrosEmpleadores` del F.572;
    - más el recibo actual.
  - Los aportes son los renglones de descuento cuyo concepto tiene destino SEGURIDAD_SOCIAL, OBRA_SOCIAL o SINDICAL.
  - El retenido son los renglones de conceptos tipo `GANANCIAS`.
  - El bloqueo de cierre fuera de orden va en `cerrar`.
  - La hoja PDF se arma con `pdfkit`, como el recibo.
- [ ] **Step 4:** PASS. También pasan `test/sueldos-*`, `test/lsd-*` y la suite completa de la API en dos mitades.
- [ ] **Step 5:** Commit `feat(ganancias): retención en la liquidación`.

### Task 5: Web y E2E

**Files:**
- Create:
  - `apps/web/src/sueldos/GananciasTablasPage.tsx`;
  - `apps/web/src/sueldos/GananciasEmpleado.tsx` (pestaña de la ficha);
  - `e2e/ganancias.spec.ts`, más el fixture XML.
- Modify:
  - `EmpleadosPage.tsx` (pestaña *Ganancias*);
  - `LiquidacionPage.tsx` (*Ver cálculo de Ganancias* en el recibo);
  - `ConceptosPage.tsx` (casilla *Exento de Ganancias*);
  - el menú y las rutas;
  - `e2e/playwright.config.ts` (proyecto `ganancias` después de `libro-sueldos`).
- Test: `apps/web/src/sueldos/ganancias.test.tsx`.

**Interfaces:**
- **Consumes:** las rutas de las Tasks 1, 3 y 4.
- **Produces:**
  - `FormTablaGanancias({ inicial, onGuardar })`;
  - `HojaGananciasVista({ hoja }: { hoja: HojaGanancias })`;
  - `ResultadoImportacionF572({ resultado })`.

- [ ] **Step 1: Pruebas que fallan (`ganancias.test.tsx`):**
  - el formulario de la tabla agrega y quita tramos y no deja guardar con tramos no consecutivos;
  - `HojaGananciasVista` muestra `Ganancia sujeta a impuesto`, el tramo y `Retención del mes`, y los avisos;
  - el resultado de la importación muestra los omitidos con su motivo y los pendientes con *Confirmar reemplazo*.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - *Administración → Ganancias de cuarta categoría*, en el menú con `ganancias.configurar`, con año y semestre y *Copiar del semestre anterior*.
  - La pestaña del empleado tiene importar F.572, editar (cargas, otros empleadores y deducciones con sus meses) y el acumulado previo.
- [ ] **Step 4:** Suite web y build.
- [ ] **Step 5: E2E `ganancias.spec.ts`:**
  - el contador:
    - carga la tabla del semestre actual con los valores de la Task 2;
    - importa el XML de ejemplo para un empleado de la demo (el fixture usa su CUIL y el CUIT de la empresa demo);
    - crea y calcula la liquidación del mes;
    - ve el renglón `Impuesto a las ganancias` en el recibo y abre *Ver cálculo de Ganancias*;
  - se recrea `gestion_e2e` y todo en verde.
- [ ] **Step 6:** Commit `feat(web): Ganancias de cuarta categoría`.
