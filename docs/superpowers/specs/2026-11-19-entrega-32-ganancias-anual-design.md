# Entrega 32: Ganancias de cuarta: prorrateo corregido, liquidación anual y final, F.1359, pagos a cuenta y depósito

## 1. Objetivo

Cerrar el circuito de Ganancias de cuarta categoría que empezó en la Entrega 31:
- corregir el prorrateo mensual de las tablas;
- liquidación anual de cada empleado, con su ajuste en el sueldo siguiente;
- liquidación final al egreso;
- presentación F.1359 y certificado para el empleado;
- pagos a cuenta del F.572;
- depósito de lo retenido por SICORE.

**Por qué:**
- **El prorrateo de la Entrega 31 está mal.** Usa el valor anual del semestre × *m*/12. Las tablas oficiales de ARCA de 2025 (manual del F.1359 v2.0, Tabla 5) acumulan cada mes con 1/12 del valor anual de **su** semestre:
  - **Ejemplo:** julio = lo acumulado a junio + 1/12 del valor anual del 2.º semestre. La ganancia no imponible acumulada a julio de 2025 es $ 2.333.759,65; con la regla actual daría $ 2.629.378.
  - **Efecto:** de julio a diciembre se deduce de más y se retiene de menos.
- **El empleador debe:**
  - hacer la liquidación anual hasta el último día hábil de abril;
  - presentar el F.1359 (anual, final, distracto);
  - entregar el certificado al empleado;
  - depositar lo retenido.
- **El F.1357 ya no se usa:** desde 2024 lo reemplazó el F.1359 (RG 5531/2024). La versión 2.0 rige para 2025 en adelante (RG 5683/2025).

**Éxito:**
- La retención mensual coincide con las tablas acumuladas de ARCA.
- En enero o febrero, el contador abre *Ganancias → Liquidación anual 2026*, la calcula y la cierra. La diferencia de cada empleado se retiene o se devuelve sola en el sueldo siguiente.
- El contador descarga el F.1359, que ARCA acepta, y el certificado de cada empleado.
- Lo retenido sale en el SICORE del mes.

## 2. Objetivos, no objetivos y antiobjetivos

**Objetivos:**
- prorrateo por semestre;
- pagos a cuenta del F.572 (importados y manuales), computados en la retención;
- liquidación anual con su ajuste;
- liquidación final (la de la Entrega 31 al egreso) y presentación F.1359 de tipo final;
- distracto de enero a marzo;
- archivo F.1359 v2.0;
- certificado PDF;
- retenciones de empleados en el SICORE (impuesto 217, régimen 160);
- rubro exento por concepto.

**No objetivos:**
- presentación informativa (tipo 3);
- rectificativas (secuencia mayor que 00): el archivo sale siempre original;
- envío por webservice a ARCA;
- regímenes especiales: actores, petroleros de pozo, Tierra del Fuego, Antártida, poder judicial y jubilados (deducción específica);
- deducción del 10 % del alquiler (art. 85 inc. k);
- autorretención (RG 5683);
- retribuciones no habituales separadas: van en remuneración bruta.

**Antiobjetivos:**
- retener o devolver dos veces la diferencia anual;
- que la diferencia anual se cuente como retención del año en curso;
- un F.1359 cuyos totales no cumplan los controles del manual;
- incluir en la anual a un empleado que egresó en el año (va en su final);
- incluir en la anual a uno que egresó entre enero y marzo del año siguiente (va en el distracto).

## 3. Prorrateo corregido (corrige la Entrega 31)

El valor acumulado al mes *m* de cada importe de la tabla es la suma, para *k* = 1..*m*, de (valor anual del semestre de *k*) / 12. Esto vale para:
- la ganancia no imponible, la deducción especial y las cargas de familia;
- los topes;
- los límites `desde` y el `fijo` de los tramos de la escala.

**Ejemplo:** mes 9 = 6/12 del valor del 1.er semestre + 3/12 del valor del 2.º.

**Implementación:**
- El cálculo puro (`retencionGanancias`) deja de prorratear. Recibe una tabla **ya acumulada**.
- Las funciones nuevas en `ganancias/tablas.ts`:
  - `tablaAcumulada(t1, t2, mes)`: para el mensual;
  - `tablaAnual(t2)`: para la anual, con los valores anuales del 2.º semestre sin prorratear. Así lo indica la Tabla 5 *Anual* del manual;
  - `tablaFinal(t1, t2, mesDePago)`: para la liquidación final, con los valores **anuales completos** del semestre de la fecha de pago (`t1` de enero a junio, `t2` de julio a diciembre), sin prorratear. Lo indica el manual (§2.2 y Tabla 6, *Topes para liquidación final*). Esto cambia también el cálculo de la retención de la liquidación final de la Entrega 31, que hoy acumula al mes.
- **Las tablas de los dos semestres:**
  - sin la del 1.er semestre, un mes de julio a diciembre toma la del 2.º para los meses 1 a 6, con un aviso en la hoja;
  - sin la del semestre del mes, el error es el de la Entrega 31.
- **Cargas de familia:** cada mes de vigencia suma 1/12 del valor anual del semestre de ese mes.

**Verificación:** con las tablas oficiales de 2025 (manual del F.1359, Tablas 4 y 5), la ganancia no imponible acumulada da $ 326.355,70 en enero, $ 2.333.759,65 en julio y $ 4.211.886,94 en diciembre. La anual da $ 4.507.505,52.

## 4. Pagos a cuenta (F.572, sección 4)

`DatosF572` agrega `pagosACuenta: { tipo: TipoPagoACuenta; codigo: string; meses: { mes: number; importe: string }[] }[]`.

Los tipos son los diez del registro 07 del F.1359:

| Tipo | Concepto |
|---|---|
| `ADUANERAS` | RG 2281 |
| `CHEQUE_BANCARIO` | RG 2111, créditos y débitos en cuenta bancaria |
| `CHEQUE_MOVIMIENTOS` | RG 2111, movimientos de fondos |
| `EFECTIVO_AGENCIAS` | RG 3819, agencias de viajes |
| `EFECTIVO_TRANSPORTE` | RG 3819, transporte |
| `DOLAR_ATESORAMIENTO` | RG 5617, inc. a |
| `DOLAR_BIENES_EXTERIOR` | RG 5617, inc. b |
| `DOLAR_SERVICIOS_NO_RESIDENTES` | RG 5617, inc. c |
| `DOLAR_AGENCIAS` | RG 5617, inc. d |
| `DOLAR_TRANSPORTE` | RG 5617, inc. e |

**Importación:** desde el XML del SiRADIG, con un mapeo provisional como el de la Entrega 31:
- etiqueta `retPerPagos/retPerPago`, con el atributo `tipo` y los `periodos` de la misma forma que las deducciones;
- mapa de códigos provisional en `f572-xml.ts`;
- un código desconocido se guarda como `OTRO`, no se computa y se avisa.

**Edición:** en la pantalla del F.572, una fila por pago (tipo, mes e importe).

**Cálculo:** los pagos a cuenta de los meses 1..*m* se restan del impuesto, como lo retenido. Retención del mes = impuesto acumulado − retenido anterior − pagos a cuenta acumulados. Si da negativo, se devuelve hasta lo que retuvo la empresa en el año (regla de la Entrega 31). La hoja de cálculo los muestra.

## 5. Liquidación anual

*Sueldos → Ganancias → Liquidación anual* (`sueldos.liquidar`).

**Modelo `LiquidacionAnualGanancias`:**
- campos: año, estado (`BORRADOR` | `CERRADA`), fecha de cierre y usuario;
- único por empresa y año.

**Modelo `LiquidacionAnualGananciasEmpleado`:**
- campos: empleado, `hoja` (Json), `impuesto`, `retenido`, `pagosACuenta`, `saldo`, `ajusteAplicado` (Boolean) y los datos del F.1359 del empleado (Json, §7);
- el saldo es positivo si queda por retener y negativo si hay que devolver.

**Calcular** (`POST …/ganancias/anual/:anio/calcular`) recalcula el borrador. Se puede calcular en cualquier momento después del 31/12, como vista previa. **Quiénes entran:**
- los empleados con recibos en liquidaciones **cerradas** con fecha de pago en el año;
- **sin** egreso en el año ni entre el 1/1 y el 31/3 del año siguiente (esos van al final o al distracto).

**Para cada uno:**
- la misma suma de la Entrega 31 (bruta, aportes, F.572, acumulado previo y otros empleadores) con *m* = 12;
- con `tablaAnual(t2)`;
- impuesto anual − retenido en el año (renglones tipo `GANANCIAS` con fecha de pago en el año, más el acumulado previo y lo retenido por otros empleadores) − pagos a cuenta del año = saldo.

El año debe estar terminado: si no, 400 `Solo se liquida un año terminado`.

**Cerrar** (`POST …/cerrar`):
- solo desde el 1/4 del año siguiente; antes: 400 `La liquidación anual se cierra desde el 1/4/AAAA, cuando ya se conocen los egresos de enero a marzo (que van en el distracto)`. ARCA acepta la presentación anual original recién desde esa fecha, y quienes egresan de enero a marzo no pueden estar en la anual;
- fija los importes y genera un **ajuste pendiente** por cada empleado con saldo distinto de cero. Reabrir solo se permite si ningún ajuste se aplicó todavía.

**Ajuste en el sueldo siguiente:**
- **Concepto nuevo de la precarga:**
  - `561` *Ajuste anual de Ganancias*;
  - tipo nuevo `GANANCIAS_AJUSTE`, clase `DESCUENTO`;
  - código ARCA 810008 y cuenta 2.1.02.002;
  - la migración lo crea como el 560 de la Entrega 31.
- La primera liquidación (mensual o final) que se calcule con fecha de pago posterior al cierre agrega el renglón con el saldo: positivo retiene, negativo devuelve.
  - El ajuste a retener se limita al 35 % del bruto del recibo, igual que la retención; el resto queda pendiente para la liquidación siguiente.
  - Una devolución no tiene límite: se devuelve lo que la anual determinó.
- Al cerrar esa liquidación, el ajuste queda aplicado. Si la liquidación se reabre, vuelve a pendiente.
- **Los renglones `GANANCIAS_AJUSTE` no cuentan** en el retenido ni en la bruta del año en curso.
- **Importes fijos al cerrar:** la anual y su F.1359 quedan con los importes del cierre. El "impuesto retenido" del registro 08 **no** incluye el ajuste aplicado después, y el saldo es el de la anual. El ajuste es la forma de cancelar ese saldo, no una retención del año.

**Pantalla:** tabla por empleado (bruta, deducciones, impuesto, retenido, pagos a cuenta y saldo), con:
- *Calcular*, *Cerrar* y *Ver hoja*;
- *Descargar F.1359*;
- *Certificados (PDF)*.

## 6. Liquidación final y distracto

**Final:** el egreso ya genera la liquidación final (Entrega 20), que calcula la retención con el acumulado al mes de egreso. Esa liquidación **es** la liquidación final de Ganancias del empleado.

**F.1359 final:** `GET …/ganancias/f1359/final/:anio/:mes`.
- Contiene las liquidaciones finales **cerradas** con fecha de pago en ese mes.
- Tipo de presentación 2, período AAAAMM.
- Los datos salen de la hoja de la liquidación final y del año acumulado a ese mes.
- Sin finales en el mes: 400 `No hay liquidaciones finales cerradas en MM/AAAA`.

**Distracto** (tipo 4, período AAAA00):
- Comprende a los empleados que egresaron entre enero y marzo del año siguiente; como la anual se cierra desde el 1/4, nunca están en una anual cerrada.
- **Su anual del año anterior se liquida junto con la final** (manual §2.1): al calcular una liquidación final con fecha de pago entre el 1/1 y el 31/3, se calcula la anual del año anterior de ese empleado con las reglas de §5. El saldo entra en la misma final como renglón `561` (ajuste anual), con el tope del 35 % si es a retener.
- Al cerrar la final se guarda como fila de anual con la marca `distracto` y el id de la liquidación final, en un `LiquidacionAnualGanancias` del año anterior que se crea si hace falta. Al reabrir la final se borra.
- `GET …/ganancias/f1359/distracto/:anio` arma el archivo con esas filas guardadas.
- Solo se puede descargar del 1/1 al 31/3 del año siguiente, como exige ARCA. Fuera de esas fechas responde 400 con el mensaje del manual.

## 7. Archivo F.1359 v2.0

**Fuente:** ARCA, *F.1359 Versión 2.0 – DJ anuales, finales e informativas año 2025* (abril de 2026). El texto completo está en `docs/referencias/arca-F1359-v2.0-manual.txt`.

**Reglas generales:**
- **Nombre:** `F1359.<CUIT>.<período>.0000.txt`, con período `AAAA0000` para la anual y el distracto, y `AAAAMM00` para la final, según el ejemplo del manual.
- **Formato:** alfanuméricos a la izquierda con espacios; numéricos a la derecha con ceros; importes sin separadores, con 2 decimales implícitos; fin de línea CRLF.
- **Registros:** un 01 y, por empleado, los registros 02 a 08 en orden.
- Lo define una tabla declarativa en `ganancias/f1359-diseno.ts`, como `lsd-diseno.ts`.

**Largos:** 01 = 38, 02 = 36, 03 = 178, 04 = 313, 05 = 478, 06 = 160, 07 = 178 y 08 = 105.

**01 Cabecera:**
- tipo `01`;
- CUIT;
- período (`AAAA00` o `AAAAMM`);
- secuencia `00`;
- impuesto `0103`;
- concepto `593`;
- formulario `1359`;
- tipo de presentación: 1 anual, 2 final, 4 distracto;
- versión `00200`.

**02 Trabajador:**
- CUIL;
- período trabajado desde y hasta (AAAAMMDD, dentro del año: el mayor entre ingreso y 1/1, y el menor entre egreso y 31/12);
- meses (de 1 a 12);
- beneficio `1`;
- las cuatro marcas en `0`.

**03 Remuneraciones gravadas:**

| Campo | Contenido |
|---|---|
| Remuneración bruta | bruta gravada del año en esta empresa, sin SAC (incluye el acumulado previo) |
| Retribuciones no habituales | 0 |
| SAC primera cuota | renglones de SAC (código 200, sin concepto) en liquidaciones con fecha de pago de enero a junio |
| SAC segunda cuota | los de julio a diciembre |
| Otros empleos: remuneración bruta | la de los otros empleadores del F.572 |
| Otros empleos: no habituales y SAC | 0 |
| Ajustes | 0 |
| Total | la suma de los anteriores; es el control del manual |

**04 Exentas o no alcanzadas:** cada concepto con `exentoGanancias` tiene un **rubro** (campo nuevo `Concepto.rubroExentoGanancias`), que se elige en la ficha y es obligatorio si está marcado como exento:

| Rubro | Campo del registro 04 |
|---|---|
| `ASIGNACIONES_FAMILIARES` | 3 |
| `INTERESES_PRESTAMOS` | 4 |
| `INDEMNIZACIONES` | 5 (el renglón fijo 300 va acá) |
| `CURSOS_SEMINARIOS` | 8 |
| `INDUMENTARIA` | 9 |

- Los campos de otros empleos van en 0.
- El total exento (19) y el total de remuneraciones (20 = gravada + exenta) se calculan.
- Los conceptos exentos de la Entrega 31 sin rubro: la migración les pone `INDUMENTARIA` y Conceptos avisa `Revise el rubro exento de los conceptos X`.

**05 Deducciones generales:**

| Campo | Contenido |
|---|---|
| 3 | aportes de seguridad social (destino `SEGURIDAD_SOCIAL`) |
| 4 | aportes de otros empleos |
| 5 | `CAJAS_JUBILACION` |
| 7 | aportes de obra social |
| 9 | aportes sindicales |
| 11 | cuotas médicas (computado) |
| 12 | seguro de muerte |
| 13 | seguro mixto |
| 15 | sepelio |
| 16 | vehículos e intereses de corredores |
| 17 | donaciones |
| 18 | alquiler 40 % |
| 20 | gastos médicos |
| 21 | intereses hipotecarios |
| 22 | SGR |
| 23 | servicio doméstico |
| 27 | seguro de retiro |
| 28 | indumentaria del empleado |
| 29 | educación |
| 33 | total |

El resto va en 0. Los aportes de otros empleos van todos en el campo 4, porque el F.572 los guarda sumados (Entrega 31).

**06 Art. 30:**
- ganancia no imponible;
- cónyuge;
- cantidad de hijos al 50 % y al 100 % e importe;
- incapacitados (cantidad e importe);
- total de cargas;
- deducción especial;
- adicional y específica en 0;
- total;
- hijos de 18 a 24 en 0, que el manual permite.

**07 Pagos a cuenta:** los diez tipos de §4 y su total.

**08 Cálculo:**
- remuneración sujeta: la fórmula del manual, mínimo 0;
- alícuota: el código de la Tabla 3 según el porcentaje del tramo (`00` para 0 %, `01` para 5 %, … `09` para 35 %; un porcentaje fuera de la tabla da 400);
- impuesto determinado;
- impuesto retenido;
- subtotal;
- autorretenido en 0;
- saldo.

**Controles internos antes de devolver el archivo** (un fallo es 500, porque indica un error del programa):
- los largos;
- total gravado, total de deducciones generales y total del art. 30;
- remuneración sujeta = gravada − generales − art. 30 (mínimo 0);
- subtotal = determinado − retenido;
- saldo = subtotal − pagos a cuenta;
- el art. 30 no supera gravada + exenta.

Si no se cumple el último control, el art. 30 se limita y se avisa, como pide el manual.

**Coherencia con la hoja:** los importes del archivo salen de la misma hoja que la anual o la final. La deducción con tope que se informa es la **computada**.

**De dónde salen los datos:** el archivo se arma **recalculando** desde los recibos y el F.572 con las reglas corregidas, no desde las hojas guardadas. Así las finales cerradas antes de esta entrega (con el prorrateo viejo y los aportes sin separar por destino) salen bien en el F.1359. La diferencia con lo que se retuvo queda en el saldo informado. No se rehacen las liquidaciones ya cerradas.

**Importes negativos** (subtotal y saldo cuando hay devolución): el manual no fija una convención de signo. Se escribe un `-` en la primera posición del campo, seguido del número completado con ceros hasta el largo (por ejemplo `-00000001234567` en 15). Los demás importes nunca son negativos. Queda **pendiente de verificar** con la primera presentación real (§14).

## 8. Certificado

`GET …/ganancias/anual/:anio/certificados.pdf`: un PDF con una hoja por empleado, con el diseño del punto 8 del manual:
- beneficiario y agente;
- remuneraciones gravadas y exentas;
- deducciones generales y del art. 30;
- remuneración sujeta;
- impuesto, retenciones y pagos a cuenta;
- saldo;
- lugar y fecha, y firma.

También existe para una liquidación final: `GET /api/sueldos/liquidaciones/:id/ganancias-certificado.pdf`.

## 9. Depósito: SICORE

El SICORE del mes (presentaciones de la Entrega 7) agrega una línea por empleado con retención en liquidaciones **cerradas** con fecha de pago en el período:
- **Retención:** la suma de sus renglones `GANANCIAS` y `GANANCIAS_AJUSTE` positivos del período.
- **Datos de la línea:**
  - comprobante 7 (*liquidación de sueldos*);
  - fecha de pago;
  - número: el de la liquidación;
  - importe del comprobante: el bruto;
  - impuesto 217, régimen 160, operación 1;
  - base: el bruto;
  - fecha de retención: la de pago;
  - condición 1;
  - documento 86 (CUIL).
- **Devoluciones:** no se informan en el SICORE; restan en la línea del empleado y, si el neto da negativo, no se informa línea.

Los códigos 7, 160 y 86 siguen el estándar del aplicativo SICORE y se verifican en él, como el resto del diseño SICORE del sistema.

## 10. Permisos

- La liquidación anual y los F.1359 requieren `sueldos.liquidar`; ver requiere `sueldos.ver`.
- El SICORE sigue con los permisos de presentaciones.

## 11. Enfoques considerados

- **Ajuste anual automático en el sueldo siguiente** (elegido; la RG 4003 lo indica en el pago siguiente).
- Pagar la diferencia por separado: queda afuera del recibo y del Libro. Descartado.
- **F.1359 v2.0** (vigente). El F.1357 solo rige para 2018 a 2023.
- **Depósito en el SICORE existente** (elegido), en lugar de un archivo aparte.

## 12. Decisiones

**Del usuario:** la entrega completa como se propuso (ok).

**Del builder (pueden revisarse):**
- corregir el prorrateo de la Entrega 31 con la regla de la Tabla 5;
- anual con los valores anuales del 2.º semestre sin prorratear;
- ajuste con un concepto propio (561) que no cuenta para el año en curso, limitado al 35 % si es a retener;
- pagos a cuenta computados en el mensual;
- rubro exento obligatorio por concepto;
- sin informativas, rectificativas, regímenes especiales ni deducción del 10 % del alquiler;
- SAC primera o segunda cuota según el mes de la fecha de pago;
- códigos SICORE 7, 160 y 86 a verificar en el aplicativo;
- demo: las tablas de ejemplo pasan a los valores oficiales de 2025 del manual (Tabla 4 y Tabla 5 anual: el 2.º semestre; para el 1.er semestre, la Tabla 6). La escala sigue siendo ilustrativa porque el manual no la trae.

**Del builder, según la revisión:**
- la final usa los valores anuales completos del semestre de pago (`tablaFinal`), según el manual §2.2 y la Tabla 6;
- la anual se calcula como vista previa en cualquier momento y se cierra desde el 1/4;
- el distracto liquida la anual del año anterior dentro de la final de enero a marzo (ajuste 561) y se guarda al cerrarla;
- la anual queda con los importes del cierre: el registro 08 no incluye el ajuste posterior;
- el F.1359 se recalcula desde los recibos con las reglas corregidas, sin rehacer liquidaciones cerradas;
- importes negativos con `-` en la primera posición, a verificar.

## 13. Pruebas

**Cálculo:**
- `tablaAcumulada` con las tablas oficiales de 2025: los valores de §3 al centavo, para enero, julio y diciembre, y las cargas de familia de julio;
- `tablaAnual`;
- pagos a cuenta en la retención mensual;
- las pruebas de la Entrega 31 se adaptan a la tabla acumulada.

**Anual:**
- quiénes entran (sin egresados, sin distracto);
- saldo a retener y a devolver;
- cierre con ajustes;
- el ajuste aparece en la mensual siguiente, se limita al 35 %, queda pendiente y se aplica al cerrar;
- no cuenta en el año nuevo;
- reabrir con un ajuste aplicado → 400;
- año no terminado → 400.

**F.1359:**
- largos de los 8 registros;
- controles;
- anual, final y distracto (y fuera de fecha → 400);
- rubros exentos en el 04;
- SAC por cuota;
- otros empleos.

**Certificado:** devuelve un PDF.

**Revisión:**
- final de marzo con `tablaFinal` (valores anuales del 1.er semestre) y de agosto (2.º semestre);
- cerrar la anual antes del 1/4 → 400;
- final de febrero con el ajuste 561 del año anterior y su fila de distracto al cerrar;
- registro 08 con saldo negativo y signo;
- F.1359 de una final cerrada antes de la entrega, recalculado.

**SICORE:** línea del empleado con 217/160 y la suma; las devoluciones restan.

**Web:**
- pantalla de la liquidación anual;
- pagos a cuenta en el F.572;
- rubro exento en Conceptos.

**E2E:** el contador calcula y cierra la anual del año anterior para un empleado con retención, descarga el F.1359 (primera línea `01<CUIT><AAAA00>0001035931359100200`) y ve el ajuste en la liquidación siguiente.

## 14. Pendiente de verificar

- **Signo de los importes negativos** del registro 08: se verifica con la primera presentación real y se corrige en `f1359-diseno.ts`.
- **Etiquetas y códigos de los pagos a cuenta del SiRADIG:** son provisionales, como los de la Entrega 31.
- **Códigos SICORE para sueldos** (comprobante 7, régimen 160, documento 86): se verifican en el aplicativo.
