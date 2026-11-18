# Entrega 31: Retención de Ganancias de cuarta categoría (mensual)

## 1. Objetivo

Que cada liquidación de sueldos calcule y descuente sola la retención del impuesto a las ganancias a los empleados (régimen de la RG 4003, con la Ley 27.743). Las deducciones de cada empleado vienen de su formulario F.572 web (SiRADIG).

**Por qué:**
- El empleador es agente de retención por obligación.
- Hoy la retención se calcula afuera y se carga como un descuento fijo, sin rastro del cálculo.
- Es el siguiente ítem del bloque legal (decisión del usuario), y el Libro de Sueldos Digital de la Entrega 30 ya prevé el concepto ARCA 810008.

**Éxito:**
- El contador carga una vez por semestre las tablas de ARCA (deducciones personales y escala).
- Importa los F.572 que descarga del SiRADIG, o los corrige a mano.
- Cada liquidación muestra en el recibo el renglón *Impuesto a las ganancias* con el importe correcto (o la devolución), y una hoja de cálculo por empleado que permite explicar cada peso.

**Alcance:** esta entrega es la primera de dos. La segunda trae la liquidación anual y la final (F.1357 y F.649), los pagos a cuenta y percepciones, y el depósito de lo retenido.

## 2. Objetivos, no objetivos y antiobjetivos

**Objetivos:**
- tablas de ARCA por año y semestre;
- F.572 por empleado y año (importado del SiRADIG o cargado a mano);
- retención mensual acumulativa con su tope;
- devolución cuando el acumulado baja;
- renglón en el recibo, en el asiento y en el Libro (810008);
- hoja de cálculo por empleado y liquidación;
- conceptos exentos.

**No objetivos (segunda entrega):**
- liquidación anual y final, F.1357 y F.649;
- percepciones y pagos a cuenta (sección 4 del F.572), beneficios y ajustes (secciones 5 y 6);
- depósito y declaración de lo retenido;
- RG 2442 (actores);
- regímenes especiales: zona patagónica, jubilados, personal de pozos petroleros, trabajadores de la ley 26.844 y similares.

**Antiobjetivos:**
- retener a quien no supera el mínimo;
- retener dos veces lo ya retenido en el año;
- usar en un mes las tablas de otro semestre;
- calcular cargas de familia o deducciones del F.572 a un empleado que no lo presentó;
- que un F.572 importado pise sin aviso una corrección manual;
- tablas fijas en el código.

## 3. Tablas de ARCA

*Administración → Ganancias de cuarta categoría*: la cargan quienes tienen el permiso nuevo `ganancias.configurar`. Son de la empresa, como los parámetros previsionales.

**Modelo `TablaGanancias`:** año, semestre (1: enero a junio; 2: julio a diciembre) y los importes **anuales** que publica ARCA para ese semestre:
- ganancia no imponible;
- deducción especial incrementada (empleados);
- cónyuge o conviviente;
- hijo o hijastro (menor de 18);
- hijo incapacitado para el trabajo;
- topes anuales, cada uno por separado (ARCA publica uno para cada concepto):
  - intereses hipotecarios;
  - primas de seguro para el caso de muerte;
  - primas de ahorro de seguros mixtos;
  - aportes a planes de seguro de retiro privados;
  - gastos de sepelio.

**Modelo `TramoGanancias`** (escala del art. 94, anual): por tabla, `desde`, `hasta` (null en el último), `fijo` y `porcentaje`.

**Uso por mes** (como las tablas acumuladas que publica ARCA): para el mes *m* se usa la tabla del semestre de *m* y cada importe anual se prorratea por *m*/12, tanto las deducciones como los límites de la escala.
- Ejemplo: en septiembre, la ganancia no imponible acumulada es la anual del 2.º semestre × 9/12.

**Sin tabla para el semestre**, la liquidación responde 400 `Cargue la tabla de Ganancias de <1.er|2.º> semestre <año>`, solo si algún empleado tiene ganancia acumulada positiva.

**Carga:**
- a mano;
- o copiando la del semestre anterior, para editar los importes;
- se valida que los tramos sean consecutivos (cada `desde` igual al `hasta` anterior), con el primero en 0 y el último sin `hasta`.

## 4. F.572 web (SiRADIG)

**Modelo `F572`:** empleado, año, número de presentación, fecha, `origen` (`IMPORTADO` | `MANUAL`) y `modificadoAMano`.

Sus partes:
- **Cargas de familia:**
  - parentesco: cónyuge o conviviente, hijo, hijo incapacitado (otros parentescos se guardan y no se deducen);
  - documento y nombre;
  - mes desde y mes hasta;
  - porcentaje: 50 o 100 (los hijos pueden repartirse entre los dos progenitores).
- **Otros empleadores** (pluriempleo), por mes:
  - CUIT y nombre;
  - remuneración bruta gravada;
  - aportes de seguridad social, obra social y sindicato;
  - retención de ganancias.
- **Deducciones:**
  - tipo interno (§5.3), guardado por nombre (`CUOTAS_MEDICAS`, `SEGURO_MUERTE`, …) y no por número;
  - el código original del SiRADIG;
  - documento y nombre del prestador;
  - meses, con su importe mensual.
- **Códigos del SiRADIG:** un mapa código → tipo interno en `f572-xml.ts`. Un código que no está en el mapa se guarda como `OTRA`, no se deduce y se avisa en la importación y en la hoja de cálculo (§11).

**Importación:** `POST /api/sueldos/ganancias/f572/importar` con uno o varios archivos XML (Sección A, `NNNNNNNNNNN_AAAA_presentacion_NNN.xml`).
- **Identificación:** el empleado se busca por el CUIL del XML. Si no existe: `Empleado inexistente (CUIL …)`.
- **Validación del agente:** el CUIT del agente de retención del XML debe ser el de la empresa. Si no: `El F.572 de <empleado> está dirigido a otro empleador (CUIT …)`.
- **Presentaciones repetidas:**
  - una presentación nueva del mismo año reemplaza a la anterior si su número es mayor;
  - una de número menor o igual se omite (`Presentación N ya importada`).
- **Corrección manual:** si la anterior tiene `modificadoAMano`, el reemplazo queda pendiente de confirmar. Responde `pendientes: [...]`, y con `{ confirmar: true }` se reemplaza.
- **Resultado:** `{ importados, omitidos: [{ archivo, motivo }], pendientes }`, por archivo. Un archivo con errores no corta a los demás.
- **Lectura del XML:** los nombres de las etiquetas que se leen quedan en un mapeo declarativo (`f572-xml.ts`), para corregirlo sin tocar la lógica (§11).

**Carga y corrección manual** en la ficha del empleado, pestaña *Ganancias*: el mismo contenido, editable. Guardar marca `modificadoAMano`.

**Sin F.572 del año,** el empleado tiene igual la ganancia no imponible, la deducción especial y sus aportes. No tiene cargas de familia, otros empleadores ni deducciones generales (antiobjetivo).

## 5. Cálculo de la retención

Al liquidar (mensual, SAC o final), para cada empleado, con la **fecha de pago** de la liquidación:
- año fiscal = año de la fecha de pago;
- mes *m* = mes de la fecha de pago.

### 5.1 Ganancia bruta acumulada

Es la suma, en el año fiscal, de los recibos del empleado en liquidaciones **cerradas** de esta empresa con fecha de pago en ese año y anterior a la de esta liquidación, más el recibo que se está calculando:
- conceptos remunerativos y no remunerativos;
- menos los que tienen `Concepto.exentoGanancias`;
- menos los renglones fijos exentos (indemnización por antigüedad, código 300).

Se suma la remuneración bruta de otros empleadores del F.572 de los meses 1 a *m*.

### 5.2 Aportes acumulados

Los descuentos del empleado con destino seguridad social, obra social o sindical, del mismo conjunto de recibos, más los aportes de otros empleadores del F.572 de los meses 1 a *m*.

### 5.3 Deducciones generales del F.572 (acumuladas a *m*)

Para cada tipo, la suma de los importes mensuales de los meses 1 a *m*, con su tope.

| Tipo | Deducción y tope |
|---|---|
| 1 | Cuotas médico-asistenciales: hasta el 5 % de la ganancia neta acumulada (§5.4) |
| 2 | Primas de seguro de muerte: hasta el tope de la tabla × *m*/12 |
| 3 | Primas de ahorro de seguros mixtos: hasta su tope de la tabla × *m*/12 |
| 4 | Planes de seguro de retiro privados: hasta su tope de la tabla × *m*/12 |
| 5 | Donaciones: hasta el 5 % de la ganancia neta acumulada |
| 6 | Intereses de préstamo hipotecario: hasta el tope de la tabla × *m*/12 |
| 7 | Gastos de sepelio: hasta el tope de la tabla × *m*/12 |
| 8 | Gastos médicos y paramédicos: el 40 % de lo informado, hasta el 5 % de la ganancia neta acumulada |
| 9 | Indumentaria y equipamiento: sin tope |
| 10 | Alquiler de casa habitación: el 40 % de lo informado, hasta la ganancia no imponible × *m*/12 |
| 11 | Personal doméstico: hasta la ganancia no imponible × *m*/12 |
| 12 | Aporte a sociedades de garantía recíproca: sin tope |
| 13 y 14 | Vehículos e intereses de corredores y viajantes: sin tope |
| 15 | Gastos de educación: el 40 % de lo informado, hasta la ganancia no imponible × *m*/12 × 40 % |
| 16 y 17 | Aportes a cajas de jubilación (ANSES, provinciales o de profesionales): sin tope |

Los números de esta tabla son solo para leerla. En los datos, cada tipo se guarda por nombre. Los tipos fuera de la tabla (actores y otros) se guardan como `OTRA` y no se deducen (se avisa en la hoja de cálculo).

### 5.4 Ganancia neta, sujeta a impuesto e impuesto

1. **Ganancia neta acumulada (GN)** = bruta − aportes − deducciones generales sin tope porcentual.
2. **Deducciones con tope del 5 %** (RG 4003, Anexo II):
   - las cuotas médico-asistenciales (1) y los gastos médicos (8) se limitan cada una al 5 % de la misma GN, antes de restar cualquiera de ellas, las donaciones y las deducciones personales;
   - las donaciones (5) se limitan al 5 % de la GN menos lo deducido por 1 y 8.
3. **Deducciones personales acumuladas:**
   - (ganancia no imponible + deducción especial incrementada) × *m*/12;
   - cargas de familia: por cada carga vigente, su importe anual × (meses de vigencia dentro de 1..*m*) / 12 × porcentaje.
4. **Ganancia sujeta a impuesto (GSI)** = GN − deducciones con tope − deducciones personales, mínimo 0.
5. **Impuesto determinado acumulado** = la escala prorrateada a *m* aplicada a la GSI: el `fijo` del tramo más el `porcentaje` sobre el excedente del `desde`, con los límites × *m*/12.
6. **Retenido anterior** = la suma de las retenciones (renglones de Ganancias) del empleado en el año, en los recibos cerrados anteriores, más las retenciones de otros empleadores del F.572 de los meses 1 a *m*.
7. **Retención del mes** = impuesto determinado acumulado − retenido anterior, redondeado al centavo.

### 5.5 Devolución y tope

**Si el resultado es negativo** (el acumulado bajó, por ejemplo por un F.572 nuevo), se devuelve:
- el renglón va con importe negativo (suma al neto);
- se devuelve como máximo lo que esta empresa retuvo en el año.

**Tope del mes:** la retención no puede superar el 35 % de la remuneración bruta del recibo (remunerativo + no remunerativo).
- Lo que excede se traslada, porque el mes siguiente vuelve a calcular el acumulado.
- La hoja de cálculo muestra el excedente no retenido.

### 5.6 Cuándo no se calcula

- Si la empresa no es agente de retención (`Empresa.agenteRetencionGanancias`), no hay renglón.
- Si la retención y la devolución dan 0, no se agrega renglón.

## 6. Integración con la liquidación

**Concepto nuevo de la precarga:**
- código `560`, `Impuesto a las ganancias`;
- clase `DESCUENTO`, tipo nuevo `GANANCIAS`, destino `OTRO`;
- código ARCA `810008`;
- cuenta *Retenciones Ganancias a depositar* (`2.1.02.002`).
- La migración lo crea en las empresas con sueldos que no tienen un concepto `560`. Si ya existe uno con ese código, se usa el primer código libre desde 561.

**Cálculo:** `liquidarMes`, `liquidarSac` y `liquidarFinal` no cambian. El servicio de liquidaciones, después del cálculo de cada recibo:
1. arma los acumulados (§5) leyendo las liquidaciones cerradas del año;
2. llama a una función pura `retencionGanancias(datos): { importe, hoja }`;
3. agrega el renglón del concepto `GANANCIAS`;
4. recalcula el total de descuentos y el neto.

En una liquidación en borrador se recalcula en cada recálculo; al cerrar queda fija con el recibo.

**Hoja de cálculo:**
- `ReciboSueldo.hojaGanancias` (Json) guarda cada paso de §5: bruta, aportes, cada deducción con su tope, deducciones personales, GSI, tramo, impuesto, retenido anterior, tope del 35 % y resultado;
- en la web se ve desde el recibo (*Ver cálculo de Ganancias*);
- `GET …/recibos/:id/ganancias.pdf` la imprime para entregar al empleado.

**Orden de cálculo entre liquidaciones:**
- una liquidación acumula todas las liquidaciones cerradas del año fiscal, excepto ella misma, sin importar su número;
- al cerrar se recalcula, para tomar las que se cerraron mientras estaba en borrador;
- no se puede cerrar una liquidación si ya hay otra cerrada del mismo año con fecha de pago posterior que retuvo o devolvió Ganancias a alguno de sus empleados (si la posterior no retuvo nada, no hay nada que retener dos veces): 400 `Hay una liquidación cerrada con fecha de pago posterior (N° X): ciérrelas en orden de fecha de pago`;
- con la misma fecha de pago cuenta el orden de cierre: la segunda acumula a la primera;
- reabrir una liquidación con otras posteriores cerradas avisa: `Hay liquidaciones posteriores cerradas: su retención de Ganancias no se recalcula`.

**Acumulados previos (puesta en marcha a mitad de año):**
- modelo `AcumuladoGanancias` por empleado y año fiscal;
- guarda lo pagado fuera del sistema o antes de usar este cálculo: ganancia bruta gravada, aportes y retenciones de ganancias;
- se carga en la pestaña *Ganancias* del empleado y suma a §5.1, §5.2 y §5.4 paso 6 como un mes anterior;
- los descuentos de ganancias cargados antes como concepto manual **no** se convierten solos: el contador los suma en el acumulado previo y desactiva el concepto viejo;
- la migración avisa si encuentra conceptos de descuento cuyo nombre contiene "ganancia" (aviso en *Conceptos*, como los de la Entrega 22).

**Exentos:**
- campo `Concepto.exentoGanancias` (por defecto `false`), editable en la ficha;
- el renglón fijo 300 (indemnización por antigüedad) es exento;
- el resto de los renglones fijos son gravados (preaviso, integración, vacaciones no gozadas, SAC sobre ellos y gratificación por cese).

**Asiento:** el renglón va a la cuenta del concepto, igual que los demás descuentos (Entrega 19).

**Libro de Sueldos Digital:** el renglón sale en el registro 03 con el código del concepto. Una devolución sale con indicador `C`, como ya resuelve la Entrega 30 para un descuento negativo.

## 7. Permisos

- `ganancias.configurar` (nuevo): tablas de ARCA. La migración lo agrega a los Administrador.
- Importar y editar el F.572: `sueldos.liquidar`.
- Ver la hoja de cálculo: `sueldos.ver`.

## 8. Enfoques considerados

**Entrada de las deducciones:**
- **Importar el F.572 del SiRADIG y permitir corregirlo a mano** (elegido por el builder, con la delegación del usuario).
- Solo carga manual: transcribe lo que el empleado ya declaró en ARCA. Descartado.
- Solo importación: no cubre al empleado que todavía no presentó. Descartado.

**Tablas:**
- **Cargadas por la empresa por semestre** (elegido). ARCA las actualiza por índice y no conviene fijarlas en el código.
- Fijas en el código: obligan a una versión nueva cada semestre. Descartado.

**Momento del cálculo:**
- **Después del cálculo de cada recibo, en el servicio** (elegido). El cálculo puro del recibo no conoce la historia del año.
- Dentro de `liquidarMes`: obligaría a pasarle toda la historia. Descartado.

## 9. Decisiones

**Del usuario:**
- seguir con Ganancias de cuarta categoría;
- el builder decide cómo entran las deducciones.

**Del builder (pueden revisarse):**
- dos entregas: esta con la retención mensual; la anual y la final en la siguiente;
- F.572 importado y corregible, con confirmación antes de pisar una corrección manual;
- tablas por empresa y semestre, prorrateadas por *m*/12;
- criterio de lo percibido: año y mes de la fecha de pago;
- el SAC suma en el mes en que se paga, sin prorrateo;
- solo la indemnización por antigüedad es exenta entre los renglones fijos;
- tope del 35 % de la remuneración bruta del mes;
- devolución hasta lo retenido en el año por esta empresa;
- sin F.572, solo ganancia no imponible, deducción especial y aportes;
- concepto `560` con código ARCA 810008 y la cuenta 2.1.02.002;
- regímenes especiales y actores fuera de alcance.

**Del builder, según la revisión:**
- acumulados previos por empleado y año, para la puesta en marcha a mitad de año; las retenciones viejas no se convierten solas (§6);
- base del 5 %: cuotas médicas y gastos médicos sobre la misma GN; donaciones sobre la GN menos esas dos (§5.4);
- tipos de deducción guardados por nombre, con un mapa de los códigos del SiRADIG que hay que verificar (§4, §11);
- topes separados para seguro de muerte, seguros mixtos y planes de retiro (§3);
- las liquidaciones de un año se cierran en orden de fecha de pago; con la misma fecha, cuenta el orden de cierre (§6).

## 10. Pruebas

**API (cálculo puro):**
- empleado bajo el mínimo: retención 0;
- empleado sobre el mínimo: ejemplo con números a mano en el test;
- cambio de semestre en julio con tablas distintas;
- cargas de familia con meses y 50 %;
- cada tope de §5.3, con los tipos 1, 8 y 5 en orden;
- otro empleador en el F.572;
- devolución, limitada a lo retenido;
- acumulado previo que suma bruta, aportes y retenido;
- bases del 5 % (cuotas médicas y gastos médicos sobre la misma GN; donaciones después);
- tope del 35 % y traslado al mes siguiente;
- SAC de junio;
- final con indemnización exenta y preaviso gravado.

**API (servicio):**
- importación de un XML de ejemplo: CUIL inexistente, agente distinto, presentación repetida y reemplazo pendiente por una corrección manual;
- liquidación con renglón, neto y hoja de cálculo;
- sin tabla → 400;
- empresa no agente: sin renglón;
- orden entre liquidaciones del mismo año: cierre bloqueado por una posterior cerrada; la misma fecha acumula por orden de cierre;
- asiento con la cuenta 2.1.02.002;
- Libro con 810008;
- permisos y migración.

**Web:**
- tablas con sus tramos;
- pestaña *Ganancias* del empleado con importación y edición;
- hoja de cálculo en el recibo.

**E2E:** el contador carga la tabla del semestre, importa un F.572 de ejemplo, liquida el mes y ve el renglón *Impuesto a las ganancias* y su hoja de cálculo.

## 11. Pendiente de verificar

- **Etiquetas del XML del SiRADIG.** El manual para el desarrollador (SiRADIG-Empleador) no está en el sitio de ARCA y no se pudo descargar desde esta sesión. La lectura se arma con el mapeo declarativo de §4 y con un XML de ejemplo que respeta la estructura conocida del formulario (presentación, empleado, agente de retención, cargas de familia, otros empleadores, deducciones). Antes de usarlo en producción, hay que probarlo con un XML real descargado del SiRADIG y ajustar el mapeo.
- **Códigos de tipo de deducción del SiRADIG.** No coinciden con la numeración del manual del trabajador: el mapa de `f572-xml.ts` se verifica con el mismo XML real.
- **Topes y porcentajes de §5.3.** Siguen el art. 85 de la ley y la RG 4003 vigentes según el manual del trabajador del SiRADIG, versión 1.20 (junio de 2026). Los importes se cargan en la tabla, así que no están fijos en el código.
