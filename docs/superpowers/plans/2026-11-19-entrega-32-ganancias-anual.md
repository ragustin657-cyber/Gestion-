# Ganancias de cuarta: prorrateo corregido, anual, final, F.1359, pagos a cuenta y SICORE. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** completar Ganancias de cuarta categoría con lo siguiente:
- prorrateo por semestre corregido y tabla de la final;
- pagos a cuenta;
- liquidación anual con ajuste en el sueldo siguiente;
- distracto dentro de la final de enero a marzo;
- F.1359 v2.0 y certificado;
- retenciones de empleados en el SICORE.

**Architecture:**
- El cálculo puro recibe una tabla ya acumulada (`tablaAcumulada`, `tablaAnual`, `tablaFinal`).
- Un armador de acumulados por empleado (`acumuladoEmpleado`) suma recibos, F.572 y acumulado previo, con el detalle que necesita el F.1359. Lo usan la retención mensual, la anual y el F.1359.
- El ajuste anual es un renglón del concepto `561` (`GANANCIAS_AJUSTE`) marcado con el año que cancela. Lo pendiente se calcula a partir de los renglones cerrados, sin estado mutable.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, pdfkit, React 19 + Mantine 7, Vitest y Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-entrega-32-ganancias-anual-design.md`. Manual: `docs/referencias/arca-F1359-v2.0-manual.txt`.

## Global Constraints

- **Concepto `561`:** *Ajuste anual de Ganancias*, tipo `GANANCIAS_AJUSTE`, clase `DESCUENTO`, `codigoArca` 810008, cuenta 2.1.02.002. La migración se separa en esquema (enum) y datos, como en la Entrega 31.
- **Largos del F.1359:** 01=38, 02=36, 03=178, 04=313, 05=478, 06=160, 07=178, 08=105.
- **Cabecera:**
  - impuesto `0103`, concepto `593`, formulario `1359`, versión `00200`, secuencia `00`;
  - tipo de presentación: 1 anual, 2 final, 4 distracto.
- **Formato:** importes sin separadores con 2 decimales implícitos; un negativo lleva `-` en la primera posición; CRLF.
- **Nombre:** `F1359.<CUIT>.<AAAA0000|AAAAMM00>.0000.txt`.
- **Alícuotas (Tabla 3):** 0 %→`00`, 5→`01`, 9→`02`, 12→`03`, 15→`04`, 19→`05`, 23→`06`, 27→`07`, 31→`08`, 35→`09`.
- **Mensajes:**
  - `Solo se liquida un año terminado`;
  - `La liquidación anual se cierra desde el 1/4/AAAA, cuando ya se conocen los egresos de enero a marzo (que van en el distracto)`;
  - `No hay liquidaciones finales cerradas en MM/AAAA`.
- **SICORE de sueldos:** comprobante 7, impuesto 217, régimen 160, operación 1, condición 1, documento 86.
- **Permisos:** `sueldos.liquidar` para operar y `sueldos.ver` para ver.

## Review Focus

1. **Liquidación de sueldos con el ajuste anual pendiente y un recibo bajo.** El ajuste a retener se limita al 35 %, lo que sobra queda pendiente y no se retiene dos veces. Prueba en Task 4.
2. **Reabrir una liquidación que aplicó el ajuste.** El ajuste vuelve a pendiente y la mensual siguiente lo retoma. Prueba en Task 4.
3. **Empleado sin F.572 ni retenciones en el año.** Si tiene recibos, entra en la anual con saldo 0. Su F.1359 cumple los controles con ceros. Prueba en Task 5.
4. **Devolución anual.** Saldo negativo con signo en el registro 08; el ajuste devuelve sin tope. Prueba en Tasks 4 y 5.
5. **Concepto exento sin rubro.** No se puede guardar; la migración les pone `INDUMENTARIA` y Conceptos avisa. Prueba en Task 3.

---

### Task 1: Prorrateo por semestre y tabla de la final

**Files:**
- Create: `apps/api/src/sueldos/ganancias/tablas.ts`.
- Modify:
  - `ganancias/calculo.ts` (deja de prorratear);
  - `ganancias/retencion.service.ts` (arma la tabla: mensual o final);
  - `ganancias/tablas.service.ts` (devuelve las dos tablas del año).
- Test:
  - `apps/api/src/sueldos/ganancias/tablas.spec.ts`;
  - `calculo.spec.ts` (se adapta);
  - `apps/api/test/ganancias-liquidacion.e2e-spec.ts` (agrega casos).

**Interfaces:**
- **Produces:**
  - `tablaAcumulada(t1: TablaCalc | null, t2: TablaCalc | null, mes: number): { tabla: TablaCalc; avisos: string[] }`;
  - `tablaAnual(t2: TablaCalc): TablaCalc`;
  - `tablaFinal(t1: TablaCalc | null, t2: TablaCalc | null, mesDePago: number): TablaCalc`.
  - Las tres reciben y devuelven importes **anuales**. `TablaCalc` es la de la Entrega 31.
  - `retencionGanancias(d)` usa `d.tabla` tal cual, sin multiplicar por *m*/12. `d.mes` queda solo para la hoja y para las cargas de familia.
  - `DatosGanancias.cargas[].meses` pasa a `importe: Dec`: el importe acumulado de la carga, que arma el servicio con `cargaAcumulada(anualPorSemestre: [Dec, Dec], mesDesde, mesHasta, mes, porcentaje): Dec`, exportada de `tablas.ts`.
  - `TablasGananciasService.tablasDelAnio(tx, anio): Promise<{ t1: TablaConTramos | null; t2: TablaConTramos | null }>`.

- [ ] **Step 1: Pruebas que fallan (`tablas.spec.ts`)**, con las tablas oficiales de 2025: t1 GNI 3.916.268,37; t2 GNI 4.507.505,52.
  - `it('acumulado como la Tabla 5 de ARCA')`: GNI acumulado de los meses 1, 7, 9 y 12 = 326.355,70; 2.333.759,65; 3.085.010,57; 4.211.886,94, con tolerancia de 0,01 (`Math.abs(diff) <= 0.01`).
  - `it('julio sin tabla del primer semestre')`: `tablaAcumulada(null, t2, 7)` usa t2 para los meses 1 a 6 y avisa `Falta la tabla de Ganancias del 1.er semestre: se usa la del 2.º para enero a junio`.
  - `it('anual')`: `tablaAnual(t2).gni` = 4.507.505,52.
  - `it('final')`:
    - `tablaFinal(t1, t2, 3).gni` = 3.916.268,37;
    - `tablaFinal(t1, t2, 8).gni` = 4.507.505,52;
    - `tablaFinal(null, t2, 3)` lanza `SinTablaGanancias`.
  - `it('carga de familia acumulada')`: cónyuge con t1 3.688.339,32 y t2 4.245.166,13, de los meses 1 a 12 al 100 %, en el mes 7 → 6/12 × 3.688.339,32 + 1/12 × 4.245.166,13 = 2.197.933,50 (Tabla 5: 2.197.933,50; tolerancia 0,01).
  - `it('escala acumulada')`: un tramo `desde` 1.200.000 en t1 y 2.400.000 en t2 → mes 7: 600.000 + 200.000 = 800.000.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar `tablas.ts`.**
  - Cada importe se calcula como Σ (anual del semestre del mes *k*)/12 para *k* = 1..*m*, con Decimal exacto, y se redondea al centavo al final (ROUND_HALF_UP).
  - Los tramos se acumulan campo por campo (`desde`, `hasta` y `fijo`), emparejados por posición. Si las dos escalas no tienen la misma cantidad de tramos, se usa la del semestre del mes y se avisa.
  - En `calculo.ts`, la función `p` deja de prorratear y las cargas usan su `importe`.
  - En `retencion.service.ts`:
    - si la liquidación es `FINAL`, la tabla es `tablaFinal(t1, t2, mesDePago)` y las cargas usan el importe anual completo del semestre de pago × porcentaje, si estuvieron vigentes en algún mes hasta el egreso;
    - si no, la tabla es `tablaAcumulada`;
    - los avisos van a la hoja.
- [ ] **Step 4:** Las pruebas de `calculo.spec.ts` de la Entrega 31 pasan con la tabla ya prorrateada: el test construye `tablaAcumulada(TABLA, TABLA, m)` con la misma tabla en los dos semestres, así que los números esperados no cambian.
- [ ] **Step 5: E2E (`ganancias-liquidacion`).**
  - `it('revisión E32: julio acumula por semestre')`: con tablas 2026/1 y 2026/2 distintas (GNI 1.200.000 y 2.400.000), la hoja de una mensual de julio tiene `personales.gni` = 600.000 + 200.000 = 800.000.
  - `it('revisión E32: la final usa los valores anuales del semestre de pago')`: una final pagada en agosto tiene `personales.gni` = 2.400.000.
- [ ] **Step 6:** PASS, más `test/ganancias-*`. Commit `fix(ganancias): prorrateo por semestre y tabla de la liquidación final`.

### Task 2: Pagos a cuenta del F.572

**Files:**
- Modify:
  - `ganancias/f572-xml.ts` (mapeo provisional `retPerPagos`);
  - `ganancias/f572.service.ts` (zod);
  - `ganancias/calculo.ts` y `retencion.service.ts`.
- Test: `src/sueldos/ganancias/calculo.spec.ts`; `test/ganancias-f572.e2e-spec.ts`; `test/ganancias-liquidacion.e2e-spec.ts`.

**Interfaces:**
- **Produces:**
  - `type TipoPagoACuenta = 'ADUANERAS' | 'CHEQUE_BANCARIO' | 'CHEQUE_MOVIMIENTOS' | 'EFECTIVO_AGENCIAS' | 'EFECTIVO_TRANSPORTE' | 'DOLAR_ATESORAMIENTO' | 'DOLAR_BIENES_EXTERIOR' | 'DOLAR_SERVICIOS_NO_RESIDENTES' | 'DOLAR_AGENCIAS' | 'DOLAR_TRANSPORTE' | 'OTRO'`;
  - `DatosF572.pagosACuenta: { tipo: TipoPagoACuenta; codigo: string; meses: { mes: number; importe: string }[] }[]`, por defecto `[]`;
  - `DatosGanancias.pagosACuenta: Dec` (acumulado a *m*);
  - `HojaGanancias.pagosACuenta: string`.
  - **Mapeo provisional:** `retPerPagos/retPerPago`, con el atributo `tipo` y `periodos/periodo` igual que en deducciones.
  - **Códigos provisionales:** `1` ADUANERAS, `2` CHEQUE_BANCARIO, `3` CHEQUE_MOVIMIENTOS, `4` EFECTIVO_AGENCIAS, `5` EFECTIVO_TRANSPORTE, `6` DOLAR_ATESORAMIENTO, `7` DOLAR_BIENES_EXTERIOR, `8` DOLAR_SERVICIOS_NO_RESIDENTES, `9` DOLAR_AGENCIAS, `10` DOLAR_TRANSPORTE; el resto OTRO, con aviso.

- [ ] **Step 1: Pruebas que fallan.**
  - **Cálculo** `it('pagos a cuenta')`: en el ejemplo a mano de la Entrega 31 (impuesto 159.000), con `pagosACuenta` 9.000 → importe 150.000 y `hoja.pagosACuenta` `9000.00`. Con 200.000 y `retenidoEmpresa` 0 → importe 0, porque la devolución se limita a lo retenido por la empresa.
  - **F.572** `it('importa pagos a cuenta')`: un `<retPerPagos><retPerPago tipo="6">…mesDesde 3 mesHasta 3 montoMensual 50000</retPerPago></retPerPagos>` → `pagosACuenta` `[{ tipo: 'DOLAR_ATESORAMIENTO', codigo: '6', meses: [{ mes: 3, importe: '50000.00' }] }]`.
  - **F.572** `it('código de pago a cuenta desconocido')`: `tipo="77"` → OTRO, con un aviso.
  - **Liquidación** `it('pagos a cuenta bajan la retención')`: con el F.572 anterior, la retención de noviembre baja en 50.000 respecto de sin el F.572.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - La retención es `impuesto − retenidoAnterior − pagosACuenta`; el resto de las reglas de la Entrega 31 no cambia.
  - Los tipos `OTRO` no se computan.
  - Un F.572 guardado antes de esta entrega, sin `pagosACuenta`, se lee como `[]`.
- [ ] **Step 4:** PASS. Commit `feat(ganancias): pagos a cuenta del F.572`.

### Task 3: Modelos, rubro exento, acumulado por empleado y liquidación anual

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma`;
  - dos migraciones (esquema y datos);
  - `sueldos/modelo.ts` (concepto 561);
  - `sueldos/dto.ts` y `maestros.service.ts` (rubro exento);
  - `sueldos/calculo.ts` (`descuentos` ignora `GANANCIAS_AJUSTE`);
  - `ganancias/retencion.service.ts` (usa `acumuladoEmpleado`).
- Create:
  - `ganancias/acumulado.ts`;
  - `ganancias/anual.service.ts`;
  - `ganancias/anual.controller.ts`.
- Test: `apps/api/test/ganancias-anual.e2e-spec.ts`.

**Interfaces:**
- **Produces (esquema):**
  - `enum TipoConcepto` con `GANANCIAS_AJUSTE`;
  - `enum RubroExentoGanancias { ASIGNACIONES_FAMILIARES INTERESES_PRESTAMOS INDEMNIZACIONES CURSOS_SEMINARIOS INDUMENTARIA }`;
  - `Concepto.rubroExentoGanancias RubroExentoGanancias?`;
  - `ReciboSueldoRenglon.anioAjusteGanancias Int?`;
  - `LiquidacionAnualGanancias { id, empresaId, anio, estado ('BORRADOR'|'CERRADA'), cerradoEn?, cerradoPor? }`, única `(empresaId, anio)`;
  - `LiquidacionAnualGananciasEmpleado { id, empresaId, anualId, empleadoId, distracto Boolean @default(false), liquidacionFinalId String? @db.Uuid, hoja Json, f1359 Json, impuesto, retenido, pagosACuenta, saldo (Decimal 18,2) }`, única `(anualId, empleadoId)`.
- **Produces (código):**
  - `acumuladoEmpleado(tx, empleadoId, anio, hasta: { fechaPago: Date; excluirLiquidacionId?: string; incluirRecibo?: RenglonCalc[] }): Promise<AcumuladoEmpleado>`, en `acumulado.ts`, con:
    - `brutaGravadaSinSac`, `sac1`, `sac2`;
    - `exentos: Record<RubroExentoGanancias, Dec>`;
    - `aportesSS`, `aportesOS`, `aportesSindical`;
    - `retenido` (renglones `GANANCIAS`, más el acumulado previo);
    - `otros: { bruta, aportes, retenido }` (F.572, meses ≤ mes de `hasta`);
    - `f572: DatosF572`;
    - `primeraFecha`, `ultimaFecha` (fechas de pago con recibo).
  - En ese armador:
    - los renglones `GANANCIAS_AJUSTE` no suman nada;
    - SAC es el código 200 sin concepto: va a `sac1` con fecha de pago de enero a junio y a `sac2` con la de julio a diciembre;
    - el exento del código 300 va a `INDEMNIZACIONES`.
  - `AnualGananciasService`:
    - `calcular(anio): Promise<ResumenAnual>`;
    - `cerrar(anio)`;
    - `reabrir(anio)`;
    - `ver(anio)`;
    - `anualDeEmpleado(tx, empleadoId, anio): Promise<{ hoja; impuesto; retenido; pagosACuenta; saldo; f1359: DatosF1359Empleado }>` (lo usa también el distracto, en la Task 4).
  - `DatosF1359Empleado` es un objeto con los importes de los registros 02 a 08 ya calculados (strings con 2 decimales), definido en `ganancias/f1359-datos.ts`. Lo arma `armarF1359Empleado(acumulado, hojaAnual, periodo)`, que usan las Tasks 3 y 5.
  - **Rutas** con prefijo `sueldos/ganancias/anual/:anio`:
    - `GET /`;
    - `POST /calcular`;
    - `POST /cerrar`;
    - `POST /reabrir`.

- [ ] **Step 1: Pruebas que fallan (`ganancias-anual.e2e-spec.ts`)**, con el escenario de la Entrega 31 (básico 30.000.000, tablas 2026/1 y 2026/2) y el reloj de las pruebas en 2026-11-06.
  - `it('año no terminado')`: calcular 2026 → 400 `Solo se liquida un año terminado`.
  - `it('calcula la anual del año anterior')`:
    - liquidaciones 2025 cerradas: se crean con tablas 2025 y fechas de pago de 2025;
    - calcular 2025 → una fila por empleado con `impuesto`, `retenido` = la suma de los renglones 560 de 2025 y `saldo` = impuesto − retenido − pagos.
  - `it('quedan afuera los egresados')`: un empleado con egreso en 2025 y otro con egreso en febrero de 2026 no están en la anual 2025.
  - `it('cerrar desde el 1/4')`: cerrar 2025 con el reloj en 2026-11-06 → 201. Con el reloj simulado en 2026-02-10 (`jest.setSystemTime`) → 400 con el mensaje de las Global Constraints.
  - `it('reabrir')`: después de cerrar, reabrir → BORRADOR.
  - `it('rubro exento obligatorio')` (Review Focus 5): un concepto con `exentoGanancias: true` sin rubro → 400 `Elija el rubro exento de Ganancias`.
  - `it('concepto 561 en la precarga')`: tipo `GANANCIAS_AJUSTE`, `codigoArca` 810008 y cuenta 2.1.02.002.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - **Migraciones:**
    - las enums, el rubro y las tablas nuevas;
    - en la parte de datos: el concepto 561 (o el primer código libre desde 562) en cada empresa con sueldos, y `rubroExentoGanancias = 'INDUMENTARIA'` en los conceptos exentos sin rubro.
  - **Aviso en Conceptos:** `Revise el rubro exento de Ganancias de los conceptos X` para los que quedaron con INDUMENTARIA por migración. Para distinguirlos se guarda la marca `rubroExentoPorDefecto Boolean @default(false)`.
  - **Anual:** usa `acumuladoEmpleado(…, anio, { fechaPago: 31/12 })`, `tablaAnual(t2)` y `retencionGanancias` con `mes: 12`, `brutaRecibo` muy grande, sin `netoRecibo` y `retenidoEmpresa: retenido` (para no limitar). El saldo es `impuesto − retenido − otros.retenido − pagosACuenta`, sin topes.
  - **Reabrir** da 400 `El ajuste anual ya se aplicó en una liquidación cerrada: no se puede reabrir` si existe un renglón con `anioAjusteGanancias = anio` en una liquidación cerrada.
  - **El reloj:** todas las comparaciones de fecha usan `hoy()` de `tesoreria-comun`.
- [ ] **Step 4:** PASS, más `test/ganancias-*` y `test/sueldos-maestros`. Commit `feat(ganancias): liquidación anual`.

### Task 4: Ajuste anual en las liquidaciones y distracto

**Files:**
- Modify:
  - `ganancias/retencion.service.ts`;
  - `liquidaciones.service.ts` (cerrar y reabrir de las finales de enero a marzo);
  - `ganancias/anual.service.ts`.
- Test: `apps/api/test/ganancias-ajuste.e2e-spec.ts`.

**Interfaces:**
- **Consumes:** Task 3.
- **Produces:**
  - `RetencionGananciasService.ajustes(tx, l, empleadoId, r, conceptoAjuste): Promise<void>`. Agrega los renglones `561` con `anioAjusteGanancias` y recalcula el total de descuentos y el neto. Se llama después de `aplicar`.

- [ ] **Step 1: Pruebas que fallan (`ganancias-ajuste.e2e-spec.ts`).**
  - `it('el ajuste aparece en la liquidación siguiente')`:
    - anual 2025 cerrada con saldo +S para el empleado;
    - una mensual con fecha de pago posterior al cierre tiene un renglón `561` de importe S con `anioAjusteGanancias` 2025.
  - `it('tope del 35 por ciento y pendiente')` (Review Focus 1):
    - con S mayor que el 35 % del bruto menos la retención del mes, el renglón es el 35 % del bruto menos la retención del mes;
    - al cerrar, la mensual siguiente tiene el resto (S − lo aplicado).
  - `it('devolución sin tope')` (Review Focus 4): con saldo −S, el renglón es −S y el neto sube S.
  - `it('no cuenta en el año nuevo')`: la hoja de la mensual tiene `retenidoAnterior` sin el 561.
  - `it('reabrir la liquidación lo deja pendiente')` (Review Focus 2): reabrir la mensual que aplicó el ajuste y calcular otra → vuelve a aparecer el pendiente completo.
  - `it('no se reabre la anual con ajuste aplicado')`.
  - `it('distracto en la final de febrero')`:
    - empleado con egreso el 2026-02-15 y final pagada en febrero (reloj simulado en 2026-02-20);
    - la final tiene un renglón 561 con `anioAjusteGanancias` 2025 y el saldo de su anual 2025;
    - al cerrarla hay una fila `distracto: true` en la anual 2025 con `liquidacionFinalId`;
    - al reabrirla, la fila desaparece.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - **Pendiente de un año** = `saldo` de la fila no-distracto de la anual cerrada − Σ importes de los renglones 561 con ese año en liquidaciones cerradas, sin contar la propia.
  - **Cuándo se aplica:** solo en liquidaciones con fecha de pago posterior a `cerradoEn`.
  - **Tope del ajuste a retener:** `max(0, 35 % × bruta − retención del mes)`.
  - **Distracto:** en una `FINAL` con fecha de pago de enero a marzo, si el empleado no tiene fila en una anual cerrada del año anterior, se calcula `anualDeEmpleado(tx, empleadoId, anio - 1)` y su saldo entra como 561.
  - **Al cerrar la final:** `upsert` del encabezado de la anual (crea un `BORRADOR` si no existe) y de la fila `distracto`.
  - **Al reabrir:** se borra la fila.
- [ ] **Step 4:** PASS. Corre la suite completa de la API en dos mitades. Commit `feat(ganancias): ajuste anual y distracto`.

### Task 5: F.1359 y certificado

**Files:**
- Create:
  - `ganancias/f1359-diseno.ts`;
  - `ganancias/f1359-datos.ts` (si no quedó completo en la Task 3);
  - `ganancias/f1359.service.ts`;
  - `ganancias/certificado-pdf.ts`.
- Modify: `anual.controller.ts`, `salidas.controller.ts`.
- Test:
  - `src/sueldos/ganancias/f1359-diseno.spec.ts`;
  - `test/ganancias-f1359.e2e-spec.ts`.

**Interfaces:**
- **Produces:**
  - `REG01…REG08: CampoLsd<…>[]`, usando `CampoLsd` y `linea` de `lsd-diseno.ts`, con una variante `I` con signo (`IS`): `-` en la primera posición si el valor es negativo.
  - `F1359Service`:
    - `anual(anio)`;
    - `final(anio, mes)`;
    - `distracto(anio)`.
    - Las tres devuelven `Promise<{ nombre: string; contenido: Buffer }>`.
  - **Rutas:**
    - `GET /api/sueldos/ganancias/f1359/anual/:anio`;
    - `GET …/f1359/final/:anio/:mes`;
    - `GET …/f1359/distracto/:anio`;
    - `GET …/anual/:anio/certificados.pdf`;
    - `GET /api/sueldos/liquidaciones/:id/ganancias-certificado.pdf`.

- [ ] **Step 1: Pruebas que fallan.**
  - **Unitarias:**
    - las sumas de largos son 38/36/178/313/478/160/178/105;
    - el código de alícuota de 15 % es `04`;
    - un importe −12.345,67 en un campo `IS` de 15 → `-00000001234567`.
  - **E2E:**
    - `it('anual')`, con la anual 2025 cerrada:
      - cabecera `01` + CUIT + `202500` + `00` + `0103593` + `1359` + `1` + `00200`;
      - por empleado, los registros 02 a 08 en orden;
      - todos los largos;
      - controles de 03 (total), 05 (total), 06 (total), 08 (sujeta, subtotal y saldo);
      - el saldo del 08 igual al de la fila de la anual.
    - `it('empleado sin retenciones')` (Review Focus 3): saldo `000000000000000` y controles cumplidos.
    - `it('devolución con signo')` (Review Focus 4): un saldo negativo empieza con `-`.
    - `it('final')`:
      - con una final cerrada en noviembre de 2026: período `202611` y tipo `2`;
      - en el registro 04, el campo 5 (indemnizaciones) es la indemnización de la final.
    - `it('final sin liquidaciones')` → 400 `No hay liquidaciones finales cerradas en 11/2026`.
    - `it('distracto')`:
      - período `202500` y tipo `4`, con la fila del distracto;
      - fuera del 1/1 al 31/3 → 400 `El F.1359 de distracto se presenta del 1/1 al 31/3`.
    - `it('rubros exentos y SAC por cuota')`: un concepto exento con rubro `ASIGNACIONES_FAMILIARES` va al campo 3 del 04; el SAC de junio va al campo 5 del 03 y el de diciembre al 6.
    - `it('certificados')`: los dos PDF empiezan con `%PDF`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar según §7 y §8 de la spec.**
  - Los registros salen de `DatosF1359Empleado`: lo guardado en la fila de la anual o el distracto, o, para la final, lo recalculado desde los recibos con `tablaFinal`.
  - Antes de devolver se verifican los controles internos (§7): un fallo es `InternalServerErrorException`.
  - Si el art. 30 supera gravada + exenta, se limita y se agrega un aviso (no bloquea el archivo).
- [ ] **Step 4:** PASS. Commit `feat(ganancias): F.1359 y certificado`.

### Task 6: Retenciones de empleados en el SICORE

**Files:**
- Modify: `apps/api/src/impuestos/retenciones/sicore.ts`.
- Test: `apps/api/test/ganancias-sicore.e2e-spec.ts`.

- [ ] **Step 1: Pruebas que fallan.**
  - `it('línea por empleado')`, con una mensual de noviembre cerrada y retención R:
    - la presentación SICORE de 11/2026 tiene, además de las de proveedores, una línea con impuesto `0217`, régimen `160`, comprobante `07`, documento `86`, el CUIL y el importe R;
    - el total de la presentación suma R.
  - `it('devolución resta')`: un recibo con −D en el mismo mes deja la línea en R − D; si da ≤ 0, no hay línea.
  - `it('ajuste anual positivo')`: el 561 positivo suma a la línea del empleado.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - Se suman los renglones de tipo `GANANCIAS` y `GANANCIAS_AJUSTE` de los recibos de liquidaciones cerradas con fecha de pago en el período.
  - Número de comprobante: el de la liquidación. Importe del comprobante y base: el bruto del recibo. Fechas: la de pago.
- [ ] **Step 4:** PASS, más `test/impuestos-*`. Commit `feat(ganancias): retenciones de empleados en el SICORE`.

### Task 7: Web y E2E

**Files:**
- Create: `apps/web/src/sueldos/GananciasAnualPage.tsx`, `e2e/ganancias-anual.spec.ts`.
- Modify:
  - `GananciasPages.tsx` (pagos a cuenta en la edición del F.572 y `pagosACuenta` en la hoja);
  - `ConceptosPage.tsx` (rubro exento);
  - el menú, las rutas y `e2e/playwright.config.ts`.
- Test: `apps/web/src/sueldos/ganancias-anual.test.tsx`.

- [ ] **Step 1: Pruebas que fallan.**
  - `TablaAnualGanancias({ filas })` muestra empleado, impuesto, retenido, pagos a cuenta y saldo (negativo en verde como devolución) y el total.
  - En Conceptos, al marcar *Exento de Ganancias* aparece el select de rubro, y *Guardar* queda deshabilitado sin rubro.
  - La edición del F.572 agrega un pago a cuenta (tipo, mes e importe).
  - La hoja muestra *Pagos a cuenta*.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - *Sueldos → Ganancias: liquidación anual*, con un selector de año (los anteriores al actual) y los botones *Calcular*, *Cerrar*, *Reabrir*, *Descargar F.1359* y *Certificados (PDF)*.
  - En el detalle de una liquidación final cerrada: *F.1359 final del mes* y *Certificado de Ganancias*.
- [ ] **Step 4:** Suite web y build.
- [ ] **Step 5: E2E `ganancias-anual.spec.ts`** (proyecto después de `ganancias`):
  - el contador abre la anual del año anterior, calcula, ve la tabla y descarga el F.1359;
  - la primera línea coincide con `^01\d{11}\d{4}000001035931359100200$`.
  - Si el año anterior no tiene datos en la demo, la prueba verifica el mensaje vacío y la descarga de la cabecera. Esa decisión se toma al ver la demo.
  - Se recrea `gestion_e2e` y todo en verde.
- [ ] **Step 6:** Commit `feat(web): liquidación anual de Ganancias`.
