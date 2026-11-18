# Entrega 30: Libro de Sueldos Digital

## 1. Objetivo

Que el contador presente el Libro de Sueldos Digital (LSD) de ARCA sin tipear nada. Por cada liquidación cerrada descarga el archivo de importación, lo sube en el servicio de ARCA y de ahí genera el F.931.

**Por qué:**
- El Libro es obligatorio para todo empleador incluido por ARCA.
- Desde la inclusión, el F.931 se confecciona a partir de las liquidaciones cargadas en el Libro.
- Hoy el sistema solo exporta el archivo de SICOSS (Entrega 19), que sirve para los empleadores que todavía no están en el Libro.
- Es el primer ítem del bloque legal e impositivo; lo eligió el builder por delegación del usuario.

**Éxito:**
- Antes de la primera presentación, el contador descarga el archivo de conceptos y lo importa en el Libro (*Carga por importación de archivo*). Eso asocia cada concepto propio con su concepto ARCA.
- Cada mes, al cerrar una liquidación, descarga *Libro de Sueldos Digital* y lo importa sin errores de formato.

## 2. Objetivos, no objetivos y antiobjetivos

**Objetivos:**
- código de concepto ARCA en cada concepto, con valores por defecto;
- archivo de asociación de conceptos (Anexo II de la guía);
- archivo de liquidación (Anexo III: registros 01 a 04) por liquidación cerrada, para las tres clases (mensual, SAC y final);
- número de liquidación del Libro, estable.

**No objetivos:**
- envío automático a ARCA (el Libro no tiene un servicio público de carga: se importa desde la web);
- registros 05 (trabajadores eventuales, Dec. 342/92) y 06 (observaciones), que son opcionales;
- envío `RE` (rectificativa solo de datos del F.931);
- liquidaciones quincenales, por día o por hora;
- retenciones de Ganancias en el Libro (llegan con la entrega de Ganancias de 4ª);
- cambiar cómo se calculan las bases del F.931: se reutilizan las de la Entrega 19.

**Antiobjetivos:**
- una línea de largo distinto del diseño (ARCA rechaza el archivo: "la línea N no posee 51 caracteres");
- que la cantidad de registros 04 del registro 01 no coincida con los informados;
- que el Libro y el archivo de SICOSS informen bases distintas para la misma liquidación;
- números de liquidación repetidos o que bajen dentro de un período (ARCA exige que cada número supere a los ya ingresados);
- descargar el Libro de una liquidación sin cerrar.

## 3. Formato (verificado con la guía oficial)

Fuente: ARCA, *Libro de Sueldos Digital: Conceptos básicos y guía de uso*, versión 2.1 (Anexos II y III). El registro 04 completo está en la versión 2.0. Se consultaron el 18/11/2026.

**Reglas generales:**
- texto `.txt` en ANSI (latin1), sin comprimir, una línea por registro, con fin de línea CRLF;
- alfanuméricos completados con espacios a la derecha;
- numéricos completados con ceros a la izquierda;
- decimales sin separador: las dos últimas posiciones son los centavos.

Igual que en el F.931 de la Entrega 19, el diseño lo define una tabla declarativa en `apps/api/src/sueldos/lsd-diseno.ts`: `{ nombre, largo, tipo: 'N' | 'C' | 'I', valor }`.

### Registro 01: datos de la liquidación (35 caracteres)

| # | Campo | Largo | Valor |
|---|---|---|---|
| 1 | Tipo de registro | 2 | `01` |
| 2 | CUIT del empleador | 11 | `Empresa.cuit` sin guiones |
| 3 | Identificación del envío | 2 | `SJ` |
| 4 | Período | 6 | AAAAMM de la liquidación |
| 5 | Tipo de liquidación | 1 | `M` |
| 6 | Número de liquidación | 5 | §5 |
| 7 | Días base | 2 | `30` |
| 8 | Cantidad de registros 04 | 6 | empleados informados |

### Registro 02: datos del trabajador (115 caracteres)

Un registro por recibo.

| # | Campo | Largo | Valor |
|---|---|---|---|
| 1 | Tipo | 2 | `02` |
| 2 | CUIL | 11 | sin guiones |
| 3 | Legajo | 10 | `Empleado.legajo` (alfanumérico, a la izquierda) |
| 4 | Dependencia de revista | 50 | nombre de la sucursal del empleado; si no tiene, en blanco |
| 5 | CBU | 22 | solo si la forma de pago es 3; si no, en blanco |
| 6 | Días para proporcionar el tope | 3 | §4.3 |
| 7 | Fecha de pago | 8 | `Liquidacion.fechaPago`, AAAAMMDD |
| 8 | Fecha de rúbrica | 8 | en blanco (optativo) |
| 9 | Forma de pago | 1 | `1` efectivo, `3` acreditación en cuenta (transferencia) |

### Registro 03: conceptos liquidados (51 caracteres)

Un registro por renglón del recibo con importe distinto de cero.

| # | Campo | Largo | Valor |
|---|---|---|---|
| 1 | Tipo | 2 | `03` |
| 2 | CUIL | 11 | |
| 3 | Código de concepto del empleador | 10 | §4.1 (alfanumérico) |
| 4 | Cantidad | 5 | 3 enteros y 2 decimales; ver §4.2 |
| 5 | Unidades | 1 | ver §4.2 |
| 6 | Importe | 15 | valor absoluto, 13 enteros y 2 decimales |
| 7 | Débito/Crédito | 1 | §4.2 |
| 8 | Período de ajuste retroactivo | 6 | `000000` |

### Registro 04: datos para el F.931 (370 caracteres)

Un registro por empleado de la liquidación. Los importes salen del mismo cálculo por recibo que el archivo de SICOSS (§4.4).

| Pos. | Campo | Largo | Valor |
|---|---|---|---|
| 1–2 | Tipo | 2 | `04` |
| 3–13 | CUIL | 11 | |
| 14 | Cónyuge | 1 | `0`/`1` |
| 15–16 | Cantidad de hijos | 2 | |
| 17 | Trabajador en CCT | 1 | `trabajadorConvencionado` |
| 18 | SCVO | 1 | como en el F.931 |
| 19 | Corresponde reducción | 1 | `0` |
| 20 | Tipo de empleador | 1 | `Empresa.tipoEmpresaSicoss` |
| 21 | Tipo de operación | 1 | `0` |
| 22–23 | Situación | 2 | `codigoSituacion` |
| 24–25 | Condición | 2 | `codigoCondicion` |
| 26–28 | Actividad | 3 | `codigoActividad` |
| 29–31 | Modalidad de contratación | 3 | `codigoModalidad` |
| 32–33 | Siniestrado | 2 | `codigoSiniestrado` |
| 34–35 | Código de localidad (zona) | 2 | `codigoZona ?? Empresa.codigoZonaSicoss` |
| 36–37 | Situación de revista 1 | 2 | `codigoSituacion` |
| 38–39 | Día de inicio 1 | 2 | el de ingreso si ingresó en el mes; si no, `01` |
| 40–47 | Situaciones de revista 2 y 3 con sus días | 8 | ceros |
| 48–49 | Días trabajados | 2 | `diasTrabajados` del recibo; en el SAC, los del recibo mensual del empleado en ese período (0 si no tiene) |
| 50–52 | Horas trabajadas | 3 | `000` |
| 53–57 | % aporte adicional SS | 5 | 0 |
| 58–62 | % contribución por tarea diferencial | 5 | 0 |
| 63–68 | Obra social | 6 | `codigoObraSocial` |
| 69–70 | Adherentes | 2 | `adherentesObraSocial` |
| 71–145 | Aporte y contribución adicional de OS y bases diferenciales de OS/FSR y LRT | 5 × 15 | 0 |
| 146–160 | Remuneración maternidad ANSeS | 15 | 0 |
| 161–175 | Remuneración bruta | 15 | remuneración total del F.931 |
| 176–310 | Bases imponibles 1 a 9 | 9 × 15 | 1, 2, 3, 4, 5, 8 y 9 del F.931; 6 y 7 en 0 |
| 311–340 | Bases diferenciales de aporte y contribución SS | 2 × 15 | 0 |
| 341–355 | Base imponible 10 (Ley 27.430) | 15 | la remuneración imponible 11 del F.931 (remunerativo menos detracción) |
| 356–370 | Importe a detraer | 15 | la detracción del F.931 |

## 4. Reglas

### 4.1 Conceptos

**Código ARCA:**
- Campo nuevo `Concepto.codigoArca` (6 dígitos), obligatorio y editable en la ficha del concepto.
- Debe pertenecer al rango de su clase (Anexo I):
  - remunerativo: 110000 a 499999;
  - no remunerativo: 510000 a 799999;
  - descuento: 810000 a 829999.
- Si no: 400 `El código ARCA <código> no corresponde a un concepto <clase>`.
- **Valores por defecto** (en la migración para los conceptos existentes y en la precarga), por el tipo del concepto:

| Concepto | Código ARCA |
|---|---|
| `BASICO` | 110000 Sueldo |
| `ANTIGUEDAD` | 160001 Adicional por antigüedad |
| Presentismo (código 120 de la precarga) | 170001 Premio por presentismo |
| `HORAS_EXTRA` | 130001 si el recargo es 50 %, 130002 si es 100 % |
| `AUSENCIA` | 110000 (se informa como débito) |
| `VACACIONES` positivo (150) | 150000 Adelanto vacacional |
| `VACACIONES` descuento (151) | 110000 (débito) |
| Otro remunerativo | 160000 Adicionales |
| Comisiones (210, no remunerativo por decisión del usuario en la E24) | 550000 Importes no remunerativos especiales |
| Otro no remunerativo | 550000 |
| Descuento de seguridad social: 500 Jubilación | 810000 |
| Descuento de seguridad social: 510 Ley 19.032 | 810001 |
| Otro descuento de seguridad social | 810000 |
| Descuento de obra social | 810002 |
| Descuento sindical | 810004 Cuota sindical |
| Otro descuento | 820000 |

- **Código del empleador:** es `Concepto.codigo`, de hasta 10 caracteres. Un código más largo da 400 al guardar.

**Renglones sin concepto:** los arma el cálculo (SAC y conceptos de la liquidación final) con un código fijo, y tienen código ARCA fijo:

| Código | Renglón | Código ARCA |
|---|---|---|
| 200 | SAC (liquidación SAC) | 120000 |
| 201 | SAC proporcional (en la liquidación final se informa con este código, aunque el recibo diga 200) | 120003 |
| 300 | Indemnización por antigüedad | 520014 |
| 310 | Preaviso | 520015 |
| 311 | SAC sobre preaviso | 520017 |
| 320 | Integración mes de despido | 520016 |
| 321 | SAC sobre integración | 520017 |
| 330 | Vacaciones no gozadas | 520012 |
| 331 | SAC sobre vacaciones no gozadas | 520018 |
| 340 | Gratificación por cese | 520010 |

**Archivo de asociación de conceptos:** `GET /api/sueldos/lsd/conceptos` (`sueldos.ver`).
- Contenido:
  - una línea de 195 caracteres por concepto, activo o no (así quedan asociados también los códigos de liquidaciones viejas);
  - más una por cada renglón fijo de la tabla anterior, con descripción `SAC`, `SAC proporcional`, etc.
- Nombre: `LSD-conceptos.txt`.
- Diseño de cada línea (Anexo II):
  - código ARCA (6);
  - código del empleador (10);
  - descripción (150);
  - marca de repetición (1): `0`;
  - las 19 posiciones de subsistemas (168–186):
    - las *libres* en blanco;
    - el resto `1` o `0` según la clase:
      - **Remunerativo:** `1` en aportes y contribuciones SIPA, INSSJyP, obra social y FSR, contribuciones de asignaciones familiares, Fondo Nacional de Empleo y LRT. `0` en RENATEA y en aportes de regímenes diferenciales y especiales.
      - **No remunerativo y descuento:** todo `0`. Así ARCA calcula las mismas bases que el archivo de SICOSS, que no incluye lo no remunerativo en las bases (§4.4).
  - libre (9).
- Posiciones 168 a 186 (Anexo II):

| Pos. | Subsistema | Remunerativo |
|---|---|---|
| 168 | Aportes SIPA | 1 |
| 169 | Contribuciones SIPA | 1 |
| 170 | Aportes INSSJyP | 1 |
| 171 | Contribuciones INSSJyP | 1 |
| 172 | Aportes obra social | 1 |
| 173 | Contribuciones obra social | 1 |
| 174 | Aportes FSR (ex ANSSAL) | 1 |
| 175 | Contribuciones FSR | 1 |
| 176 | Aportes RENATEA | 0 |
| 177 | Contribuciones RENATEA | 0 |
| 178 | Libre | blanco |
| 179 | Contribuciones asignaciones familiares | 1 |
| 180 | Libre | blanco |
| 181 | Contribuciones Fondo Nacional de Empleo | 1 |
| 182 | Libre | blanco |
| 183 | Contribuciones LRT | 1 |
| 184 | Aportes regímenes diferenciales | 0 |
| 185 | Libre | blanco |
| 186 | Aportes regímenes especiales | 0 |

**Código del empleador en el registro 03:** el código actual del concepto (`Concepto.codigo`) si el renglón tiene concepto; si no, el código fijo del renglón (con el 201 para el SAC de la final).

### 4.2 Registro 03

**Débito o crédito:**
- remunerativo y no remunerativo: `C` si el importe es positivo; `D` (con el valor absoluto) si es negativo, por ejemplo las ausencias o el descuento de días de vacaciones;
- descuento: `D` si es positivo, `C` si es negativo.

**Cantidad y unidades:**
- se informa la cantidad del renglón cuando la tiene: días del SAC, horas extra, días de vacaciones, años de la indemnización;
- unidades:
  - `H` para horas extra;
  - `D` para el SAC, las vacaciones y los días de preaviso, integración y vacaciones no gozadas;
  - `A` para la indemnización por antigüedad;
  - en blanco en los demás;
- sin cantidad: `00000` y unidad en blanco. El básico, la antigüedad y las ausencias van sin cantidad;
- el preaviso guarda la cantidad en meses: se informa en días (meses × 30) con unidad `D`.

ARCA exige la cantidad para el SAC proporcional (120003), el adelanto vacacional (150000) y las horas extra (130000 a 130003): esos renglones la llevan siempre. Una cantidad mayor que 999,99 da 400 con el empleado y el concepto.

### 4.3 Registro 02

**Forma de pago:**
- `recibo.formaPago ?? empleado.formaPago`;
- con transferencia exige un CBU de 22 dígitos;
- si falta o es inválido: 400 `<Apellido, Nombre>: falta el CBU (22 dígitos) para la acreditación en cuenta`.

**Días para proporcionar el tope** (la guía pide 0 salvo inicio o fin de la relación, o vacaciones):
- liquidación final: los `diasTrabajados` del recibo;
- mensual con ingreso en el mes: los `diasTrabajados`;
- en los demás casos: 0.

### 4.4 Importes del registro 04: uno con el F.931

Los dos archivos usan el mismo cálculo por recibo.
- El cálculo por recibo de `F931Service` (topes, detracción y conceptos indemnizatorios excluidos) se extrae a una función pura: `importesRecibo(recibo, liquidación, parámetros) → { remuneracionTotal, imponibles, detraccion, ... }`.
- El F.931 la suma por empleado y el Libro la usa por liquidación.

**Una liquidación por archivo.** La guía (*Esquema del armado de la declaración jurada*) dice que ARCA:
- acumula las remuneraciones de todas las liquidaciones del período;
- toma el resto de los datos del empleado de su última liquidación ingresada.

Por eso cada archivo informa los importes de su propia liquidación y no los acumulados.

**Datos del empleado en el SAC.** Como el SAC suele ser la última liquidación del período, sus datos de empleado son los que usa ARCA. Por eso los días trabajados del registro 04 del SAC repiten los del recibo mensual del empleado en ese período, como ya hace el archivo de SICOSS. Así no queda en cero. El día de inicio sigue la regla general.

## 5. Número de liquidación del Libro

**Campo nuevo `Liquidacion.numeroLsd`** (entero, opcional):
- se asigna la primera vez que se descarga el Libro de esa liquidación: el mayor `numeroLsd` del mismo período (año y mes, cualquier tipo) más 1, o 1 si no hay;
- con un bloqueo por empresa y período, para que dos descargas simultáneas no tomen el mismo número;
- después no cambia, aunque se reabra y se vuelva a cerrar. Así una liquidación ya presentada conserva su número y una nueva siempre tiene uno mayor.

Si ARCA ya tiene cargada otra liquidación con ese número (por ejemplo, cargada a mano), el contador puede fijar el primer número del período: `PUT /api/sueldos/liquidaciones/:id/numero-lsd` con `{ numero }` (`sueldos.liquidar`). Solo se permite mientras la liquidación no tenga número asignado.

## 6. Descarga

**`GET /api/sueldos/liquidaciones/:id/lsd`** (`sueldos.ver`):
- **Respuestas de error:**
  - liquidación inexistente: 404;
  - no cerrada: 400 `Solo se descarga el Libro de una liquidación cerrada`.
- **Archivo:** `LSD-<CUIT>-<AAAAMM>-<número>.txt`, en latin1 con CRLF.
- **Contenido:**
  - el registro 01;
  - después, por empleado (ordenado por CUIL): su 02, sus 03 en el orden del recibo y su 04.
- **Controles internos antes de devolverlo** (un fallo de largo es un error interno, 500):
  - el largo de cada línea (35/115/51/370);
  - que la cantidad de registros 04 coincida con el campo 8 del registro 01.
- **Errores de datos (400 con el empleado):** un renglón sin código ARCA, un CBU faltante o una cantidad fuera de rango.

**Web:**
- En la liquidación cerrada, botón *Libro de Sueldos Digital* junto a *Descargar F.931*, con el número asignado a la vista ("Liquidación N° 2 del Libro").
- En *Conceptos*:
  - columna y campo *Código ARCA*: un select con los códigos del Anexo I más usados y un campo libre;
  - botón *Archivo de conceptos para ARCA*.

## 7. Permisos

No hay permisos nuevos. Descargar requiere `sueldos.ver`; fijar el número requiere `sueldos.liquidar`; editar el código ARCA requiere el permiso que hoy edita conceptos.

## 8. Enfoques considerados

- **Archivo de importación por liquidación cerrada** (elegido). Lo descarga el contador y lo importa en la web de ARCA, como el F.931 de SICOSS.
- **Envío automático a ARCA.** No hay un servicio público de carga para el Libro. Descartado.
- **Solo SICOSS.** No sirve para los empleadores incluidos en el Libro. Se mantiene para los que no lo están.

## 9. Decisiones

**Del usuario:**
- empezar el bloque legal por donde decida el builder;
- verificar el diseño contra el manual oficial (hecho, §3).

**Del builder (pueden revisarse):**
- el Libro como primer ítem legal, porque lo presenta todo empleador incluido;
- los códigos ARCA por defecto de §4.1;
- lo no remunerativo y los descuentos sin subsistemas, para que coincidan las bases con el F.931 actual;
- las comisiones como 550000, por ser no remunerativas en este sistema;
- un solo concepto de obra social (810002) para el 3 %: ARCA puede informar una diferencia porque separa obra social (810002) de FSR (810003). Separarlos queda para otra entrega;
- el SAC de la liquidación final con el código propio 201 y el código ARCA 120003;
- cada archivo con los importes de su liquidación (§4.4);
- un número del Libro persistente, asignado en la primera descarga (§5);
- registros 05 y 06 fuera.

**Del builder, según la revisión:**
- el SAC repite los días trabajados de la mensual (§4.4);
- las posiciones de los subsistemas del archivo de conceptos se tomaron del Anexo II (§4.1);
- el preaviso en días (meses × 30) con unidad `D`; el básico, la antigüedad y las ausencias sin cantidad (§4.2);
- el archivo de conceptos incluye los inactivos, y el registro 03 usa el código actual del concepto (§4.1).

## 10. Pruebas

**API:**
- **Diseño:** cada registro con su largo exacto (35, 115, 51 y 370); relleno de alfanuméricos y numéricos; decimales sin separador.
- **Archivo de una mensual cerrada:**
  - registro 01 con CUIT, período, `M`, número 1 y cantidad de 04;
  - 02 con forma de pago y CBU;
  - 03 con débito y crédito (una ausencia como `D`) y cantidad en las horas extra;
  - 04 con las mismas bases que el F.931 de ese mes.
- **Final:** SAC proporcional con el código 201, sus días y sus indemnizaciones (520014 y otros) en el 03; días para el tope en el 02.
- **SAC:** número 2 del período si la mensual ya tiene el 1.
- **Número:** se mantiene al volver a descargar y al reabrir y cerrar; dos descargas simultáneas de liquidaciones distintas toman números distintos; fijar el número.
- **Errores:** no cerrada, falta de CBU, código ARCA fuera de rango.
- **Archivo de conceptos:** líneas de 195 caracteres y marcas de subsistemas por clase.
- **Migración:** códigos por defecto en los conceptos existentes.
- Permisos.

**Web:** botón y número en la liquidación; columna y edición del código ARCA; descarga del archivo de conceptos.

**E2E:** el contador cierra la liquidación de la demo, descarga el Libro y obtiene un archivo cuyo primer registro es `01<CUIT>SJ<período>M0000130…` y cuyas líneas tienen los largos del diseño.
