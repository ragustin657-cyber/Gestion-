# Entrega 7 — Libros IVA, control con ARCA y presentaciones de retenciones

## 1. Objetivo y alcance

El contador genera desde el sistema los archivos que se suben a ARCA y a los fiscos provinciales, sin recargar datos. Esos archivos coinciden con las consultas y con los asientos.

**Criterio de éxito.** Con la empresa demo, un mes cualquiera:
1. el Libro IVA Ventas y el Libro IVA Compras en pantalla, Excel y PDF, con totales que coinciden con las cuentas de IVA del Mayor;
2. el ZIP del Libro IVA Digital;
3. el TXT de SICORE;
4. el lote de ARBA y el TXT de AGIP;
5. el historial de lo generado, con aviso si los datos cambiaron después;
6. el control de un CSV de "Mis Comprobantes" contra lo cargado.

**Decisiones tomadas con el usuario:**
- **Archivos:** Libro IVA Digital (ventas y compras), SICORE (Ganancias), ARBA A-122R y AGIP e-ARCIBA (retenciones de IIBB).
- **Historial:** generar un archivo **no bloquea** nada. Queda en el historial con su huella, y si los datos cambian se avisa que corresponde rectificar.
- **Diseño técnico:** formatos declarativos (tablas de campos) y un único escritor de ancho fijo.
- **Control con ARCA:** se compara el CSV de "Mis Comprobantes" (recibidos y emitidos) con lo cargado.

**Contexto normativo** (relevado en noviembre de 2026; las referencias están en `docs/superpowers/specs/referencias/entrega-7/`):
- **RG 5707/2025:** el Libro IVA Digital es obligatorio solo para los **exentos** en IVA. Los Responsables Inscriptos liquidan con **IVA Simple** (F.2051) sobre los datos de "Mis Comprobantes". De ahí el control contra ARCA. El archivo del Libro IVA Digital sigue sirviendo para exentos y para períodos anteriores.
- **RG 5921/2026:** las retenciones y percepciones de **IVA** pasan a SIRE, obligatorio desde abril de 2027. **Ganancias (RG 830) sigue en SICORE.**
- **ARBA, RN 22/25:** el diseño A-122R está vigente desde el 01/03/2026, y **ARBA emite el comprobante de retención** al procesar el lote.

**Fuera de alcance:**
- percepciones, porque la empresa no las practica;
- retenciones de IVA y SUSS;
- otras jurisdicciones de IIBB (SIRCAR y demás);
- importaciones con despacho;
- prorrateo del crédito fiscal;
- notas de crédito de retenciones en AGIP (anular una retención ya presentada se resuelve rectificando);
- presentación automática en los sitios de los organismos.

## 2. Escritor de ancho fijo

`apps/api/src/impuestos/formato/`.

**El campo:** `{ nombre, largo, tipo, ... }`. Tipos y cómo se escriben:

| Tipo | Escritura |
|---|---|
| `NUM` | Entero, alineado a la derecha, relleno con ceros. Sin signo. |
| `TXT` | Alineado a la izquierda, relleno con espacios. Los caracteres que no son ASCII imprimible se reemplazan por su equivalente sin acento (á→a, ñ→n) o por un espacio. |
| `IMPORTE` | Con `decimales` (2 por defecto) y `separador` (`''` para sin separador, `','` o `'.'`). Ceros a la izquierda. El largo incluye el separador. Nunca lleva signo: los negativos se rechazan, y el formato decide cómo se representan las NC. |
| `FECHA` | Con `formato` (`'AAAAMMDD'` o `'DD/MM/AAAA'`). Vacía: ceros (AAAAMMDD) o espacios (DD/MM/AAAA). |
| `FIJO` | Un valor constante. |

**`linea(campos, valores)`:**
- devuelve la línea;
- lanza `ErrorFormato` con nombre del campo, valor y largo si un `NUM` o `IMPORTE` no entra;
- los `TXT` largos se truncan y se informa una advertencia: "El campo Razón social (30) del registro 5 se recortó";
- valida que la línea mida exactamente la suma de los largos.

**Archivo:** líneas separadas por CRLF, codificación latin1 (ISO-8859-1), y CRLF también al final.

## 3. Libros IVA (consultas)

### 3.1 Libro IVA Ventas (nuevo)

`GET /api/impuestos/libro-iva-ventas?desde&hasta[&formato=xlsx|pdf]`

- **Qué entra:** comprobantes de venta `AUTORIZADO` con fecha en el rango, ordenados por fecha, tipo, punto de venta y número.
- **Columnas:** fecha, comprobante, cliente, CUIT o documento, condición de IVA, neto gravado por alícuota (21, 10,5, 27, 5, 2,5, 0), IVA por alícuota, no gravado, exento y total, todo en pesos (a la cotización del comprobante).
- **Signo:** las NC van en negativo.
- **Totales:** generales y por alícuota.
- **Comprobantes C:** el total va en "neto gravado" sin discriminar IVA, igual que en el comprobante.

### 3.2 Libro IVA Compras

`GET /api/impuestos/libro-iva-compras?desde&hasta[&formato=xlsx|pdf]`

- Reutiliza la consulta existente de Compras (`ConsultasComprasService.libroIva`), con el mismo filtro por fecha contable.
- Agrega el PDF y las columnas por alícuota.
- El endpoint actual de Compras sigue funcionando.

### 3.3 Cuadre con contabilidad

En cada libro, el total de IVA del período coincide con el movimiento de la cuenta del concepto:
- `IVA_DEBITO_FISCAL` (haber menos debe) en Ventas;
- `IVA_CREDITO_FISCAL` (debe menos haber) en Compras.

Cuando no coinciden, la pantalla lo informa como **advertencia** (por ejemplo, por asientos manuales a esas cuentas): "El IVA del libro (x) difiere del Mayor de la cuenta 2.1.02.001 (y)".

## 4. Libro IVA Digital (archivo)

`POST /api/impuestos/presentaciones` con `{ tipo: 'LIBRO_IVA_DIGITAL', periodo: 'AAAAMM' }`.
- Devuelve el ZIP `LIBRO_IVA_DIGITAL_<CUIT>_<AAAAMM>.zip` con `VENTAS_CBTE.txt`, `VENTAS_ALICUOTAS.txt`, `COMPRAS_CBTE.txt` y `COMPRAS_ALICUOTAS.txt`.
- Diseños tomados de `referencias/entrega-7/libro-iva-digital-diseno-registros.txt`:

| Archivo | Largo del registro |
|---|---|
| Ventas cabecera | 266 |
| Ventas alícuotas | 62 |
| Compras cabecera | 325 |
| Compras alícuotas | 84 |

**Reglas comunes:**
- **Importes:** 13 enteros y 2 decimales, sin separador.
- **Tipo de cambio:** 4 enteros y 6 decimales.
- **Fechas:** AAAAMMDD.
- **Moneda:** `PES` o `DOL`.
- **Alícuotas:** 0003 (0%), 0004 (10,5%), 0005 (21%), 0006 (27%), 0008 (5%), 0009 (2,5%).
- **Documentos:** 80 CUIT, 96 DNI, 99 sin identificar (número en ceros).
- **Tipos de comprobante:**
  - Ventas: los de WSFE (001 a 013).
  - Compras:
    - FC, ND y NC A: 001, 002, 003;
    - FC, ND y NC B: 006, 007, 008;
    - FC, ND y NC C: 011, 012, 013;
    - FC, ND y NC M: 051, 052, 053;
    - tique: 083.
- **NC:** se informan con importes positivos; el tipo indica que es crédito.
- **Moneda extranjera:** los importes van en la moneda del comprobante, con su tipo de cambio; en pesos, el tipo de cambio es 1,000000.

**Ventas:**
- **Qué entra:** comprobantes `AUTORIZADO` del período por fecha.
- **Cabecera:** "número hasta" igual al número. "Percepción a no categorizados", otras percepciones e impuestos internos en cero.
- **Alícuotas:** un registro por alícuota del comprobante.
  - Si el comprobante no tiene ninguna, por ser todo exento o no gravado, va un registro con alícuota 0003, neto 0 e impuesto 0.
  - Los C no llevan registros de alícuotas, y su cantidad de alícuotas es 0.
- **Código de operación:** según el contenido del comprobante:
  - todo gravado: `' '` (espacio, no corresponde);
  - todo exento: `'E'`;
  - todo no gravado: `'N'`;
  - mezcla: `' '`.

  La regla está en la tabla `CODIGO_OPERACION` para que el contador la revise.
- **Fecha de vencimiento o pago:** la de pago del servicio, o la de vencimiento del comprobante.

**Compras:**
- **Qué entra:** comprobantes `CONFIRMADO` con fecha contable en el período. La fecha que se informa es la de emisión.
- **Cabecera:**
  - Despacho de importación, CUIT y denominación del corredor e IVA comisión: vacíos o en cero.
  - Percepciones de IVA, de IIBB (suma por comprobante) e impuestos internos: de los campos del comprobante.
  - Otros tributos: 0.
- **Crédito fiscal computable:** el IVA total. En C y tique, 0.
- **Alícuotas:** como en Ventas, con documento y número del vendedor.

**Totales de control:** la respuesta incluye la cantidad de registros y la suma de totales e IVA por archivo, y deben coincidir con los libros de la sección 3.

## 5. Control con "Mis Comprobantes"

`POST /api/impuestos/control-arca` (multipart) con `{ archivo, sentido: 'RECIBIDOS' | 'EMITIDOS', desde, hasta }`.

**Lectura del CSV:**
- **Separador:** se detecta `;` o `,` en la línea de encabezados.
- **Decimales:** coma o punto.
- **Comillas y BOM:** se toleran.
- **Columnas:** se reconocen por nombre, normalizado a minúsculas, sin acentos ni puntos. Para cada columna se aceptan estas variantes (las primeras de cada lista son las conocidas a noviembre de 2026):

| Columna | Variantes aceptadas |
|---|---|
| fecha | "Fecha", "Fecha de Emisión" |
| tipo | "Tipo", "Tipo de Comprobante" (código numérico o texto "1 - Factura A") |
| punto de venta | "Punto de Venta" |
| número | "Número Desde", "Número" |
| documento | "Nro. Doc. Emisor" (recibidos), "Nro. Doc. Receptor" (emitidos), "Nro. Doc." |
| neto gravado | "Imp. Neto Gravado", "Neto Gravado Total" |
| IVA | "IVA", "Total IVA" |
| total | "Imp. Total", "Importe Total" |
| moneda | "Moneda" (opcional) |
| tipo de cambio | "Tipo Cambio" (opcional) |

- Si falta una columna obligatoria: 400 "Al CSV le faltan las columnas: …".
- Se ignoran las líneas fuera del rango de fechas.

**Clave de cada comprobante:** CUIT o documento de la contraparte + tipo (código ARCA) + punto de venta + número.
- **Recibidos:** se compara contra `ComprobanteCompra` no anulados, por fecha de emisión. La clave usa el CUIT del proveedor y el código de la sección 4.
- **Emitidos:** se compara contra `ComprobanteVenta` autorizados. La clave usa el CUIT de la empresa como emisor, y el documento del cliente solo como dato.

**Resultado** (no se guarda):
- `soloArca` y `soloSistema`: las filas de cada lado;
- `diferencias`: cada fila con los dos valores de total, neto gravado e IVA, en pesos, con tolerancia de 0,01;
- `coinciden`: la cantidad.

Se puede descargar en Excel (`?formato=xlsx` sobre el mismo POST).

## 6. Retenciones

### 6.1 SICORE (Ganancias)

`POST /api/impuestos/presentaciones` con `{ tipo: 'SICORE', periodo: 'AAAAMM', quincena?: 1 }`.

- **Qué entra:** `OrdenPagoRetencion` con impuesto `GANANCIAS`, no anuladas, con certificado y fecha de pago de la OP en el período. Con quincena 1, solo los días 1 a 15.
- **Archivo:** TXT `SICORE_<CUIT>_<AAAAMM>[_Q1].txt`.
- **Registro:** 145 posiciones. Formato estándar del aplicativo, según `referencias/entrega-7/sicore-instructivo-importacion.txt`. Las posiciones 45 a 145 siguen el formato estándar publicado por proveedores del mercado (Axoft, SIU), y la primera importación se verifica en el aplicativo:

| Pos. | Largo | Campo | Valor |
|---|---|---|---|
| 1-2 | 2 | Código de comprobante | `06` Orden de pago |
| 3-12 | 10 | Fecha de emisión del comprobante | Fecha de la OP, dd/mm/aaaa |
| 13-28 | 16 | Número de comprobante | Número de OP, sin separadores, alineado a la derecha con ceros |
| 29-44 | 16 | Importe del comprobante | Total de la OP, 2 decimales con coma |
| 45-48 | 4 | Código de impuesto | `0217` |
| 49-51 | 3 | Código de régimen | El régimen RG 830 de la retención (por ejemplo, `078`) |
| 52 | 1 | Código de operación | `1` Retención |
| 53-66 | 14 | Base de cálculo | Con coma |
| 67-76 | 10 | Fecha de emisión de la retención | Fecha de pago, dd/mm/aaaa |
| 77-78 | 2 | Código de condición | `01` Inscripto, `02` No inscripto (según `inscriptoGanancias` del proveedor) |
| 79 | 1 | Retención a sujetos suspendidos | `0` |
| 80-93 | 14 | Importe de la retención | Con coma |
| 94-99 | 6 | Porcentaje de exclusión | `000,00` |
| 100-109 | 10 | Fecha de emisión del boletín | Espacios |
| 110-111 | 2 | Tipo de documento del retenido | `80` |
| 112-131 | 20 | Número de documento del retenido | CUIT, alineado a la izquierda con espacios |
| 132-145 | 14 | Número de certificado original | Ceros (solo para NC) |

Sin retenciones en el período, se genera un archivo vacío con la advertencia "No hay retenciones de Ganancias en MM/AAAA".

### 6.2 ARBA (IIBB Buenos Aires, jurisdicción 902)

`POST /api/impuestos/presentaciones` con `{ tipo: 'ARBA', periodo: 'AAAAMM', quincena?: 1 | 2 }`.

- **Qué entra:** retenciones IIBB 902, no anuladas y con certificado, del período (o quincena).
- **Archivo:** ZIP `ER-<CUIT>-<AAAAMMQ>-<ACTIVIDAD>-LOTE<nnnnn>.zip`.
  - Q es 0 si es mensual.
  - `nnnnn` es el correlativo de lotes ARBA de la empresa, porque ARBA rechaza un nombre de lote repetido.
  - Adentro va `ER-<CUIT>-<AAAAMMQ>-<ACTIVIDAD>-LOTE<nnnnn>.txt`.
- **Registro:** alta, 67 posiciones, según `referencias/entrega-7/arba-a122r-diseno-registro.md`:
  - número de transacción del agente: el número de certificado propio, 20 dígitos;
  - CUIT del retenido;
  - sucursal: configuración, por defecto 1;
  - fecha de operación: la fecha de pago, dd/mm/aaaa;
  - alícuota: `99.99`, con punto;
  - base: `9999999999999.99`, con punto.
- **Configuración** (`ConfigImpuestos`):
  - `arbaActividad`: por defecto `'6'`, "a confirmar con el padrón de agente";
  - `arbaSucursal`: por defecto 1;
  - `arbaPeriodicidad`: `MENSUAL` o `QUINCENAL`, por defecto mensual.
- **Aviso fijo en la pantalla:** "ARBA emite el comprobante de retención al procesar el lote (RN 22/25): entregue al proveedor el de ARBA."

### 6.3 AGIP (IIBB CABA, jurisdicción 901)

`POST /api/impuestos/presentaciones` con `{ tipo: 'AGIP', periodo: 'AAAAMM' }`.

- **Archivo:** TXT `AGIP_RET_<CUIT>_<AAAAMM>.txt`, ordenado por fecha de retención.
- **Registro:** 215 posiciones, según `referencias/entrega-7/agip-e-arciba-diseno-registro.txt`. Los numéricos van con ceros y los importes con 2 decimales y coma.

| Pos. | Campo | Valor |
|---|---|---|
| 1 | Tipo de operación | `1` |
| 2-4 | Código de norma | De la configuración `agipCodigoNorma`, por defecto `'029'`, "a confirmar" |
| 5-14 | Fecha de retención | Fecha de pago |
| 15-16 | Tipo de comprobante | `03` Orden de pago |
| 17 | Letra | Espacio (el código 03 no lleva letra) |
| 18-33 | Número de comprobante | Número de OP |
| 34-43 | Fecha del comprobante | Fecha de la OP |
| 44-59 | Monto del comprobante | La base de la retención |
| 60-75 | Número de certificado propio | El certificado, como texto |
| 76 | Tipo de documento | `3` CUIT |
| 77-87 | Número de documento | CUIT |
| 88 | Situación IIBB | `1` Local, `2` Convenio, `4` No inscripto, `5` Régimen simplificado |
| 89-99 | Número de inscripción IIBB | El número; ceros si no inscripto |
| 100 | Situación frente al IVA | `1` RI, `3` Exento, `4` Monotributo |
| 101-130 | Razón social | |
| 131-146 | Importe otros conceptos | 0 |
| 147-162 | Importe IVA | 0 |
| 163-178 | Monto sujeto a retención | La base |
| 179-183 | Alícuota | `99,99` |
| 184-199 | Retención practicada | |
| 200-215 | Monto total retenido | Igual a la retención practicada |

- **Datos nuevos en `Tercero`:**
  - `situacionIibb`: enum `LOCAL | CONVENIO | NO_INSCRIPTO | SIMPLIFICADO`, nullable;
  - `numeroIibb`: texto, nullable.

  Se editan en el maestro de proveedores.
- **Validación:** si una retención es de un proveedor sin situación de IIBB, o sin número cuando no es "No inscripto", se responde 400 "Complete la situación de Ingresos Brutos de: Proveedor X, Proveedor Y" y no se genera nada.
- **Situación frente al IVA:** un proveedor con una condición distinta de RI, Exento o Monotributo da 400, con el mismo estilo de mensaje.

## 7. Presentaciones e historial

**Modelo `Presentacion`:**
- `tipo` (`LIBRO_IVA_DIGITAL | SICORE | ARBA | AGIP`), `periodo` (AAAAMM), `quincena` (0, 1 o 2);
- `nombreArchivo`, `contenido` (Bytes);
- `registros`, `total` (Decimal), `huella` (sha256 del contenido);
- `advertencias` (Json), `generadoPor`, `generadoEn`.

Hay además un talonario `ARBA-LOTE` para el correlativo de lotes.

**Funcionamiento:**
- `POST /api/impuestos/presentaciones`: genera, guarda y devuelve `{ id, nombreArchivo, registros, total, advertencias }`.
- `GET /api/impuestos/presentaciones/:id/archivo`: devuelve el contenido guardado.
- `GET /api/impuestos/presentaciones?tipo&periodo`: el historial. Para cada fila, la generación más reciente de cada (tipo, período, quincena) se **recalcula en memoria** y se compara su huella.
  - Para ARBA se compara el TXT interno, no el ZIP.
  - Si difiere, la fila lleva `cambiaron: true` y la pantalla muestra "Los datos del período cambiaron desde la generación del dd/mm/aaaa: corresponde rectificar".

## 8. Permisos, pantallas y datos de demo

**Permisos nuevos**, que se agregan al rol Administrador y al rol Contador de la demo:
- `impuestos.ver`: "Ver libros IVA y presentaciones";
- `impuestos.presentar`: "Generar presentaciones impositivas y controlar con ARCA".

**Menú Impuestos:**
- **Registraciones:** Generar presentación, Control con ARCA.
- **Consultas:** Libro IVA Ventas, Libro IVA Compras, Presentaciones.
- **Administración:** Configuración de impuestos.

**Pantallas:**
- **Generar presentación:** impuesto, período (mes y año), quincena si corresponde. Muestra el resultado con registros, total y advertencias, y descarga.
- **Presentaciones:** lista con aviso de cambios y botón para volver a descargar.
- **Control con ARCA:** sentido, período y archivo. Muestra tres tablas con contadores y exporta a Excel.
- **Configuración de impuestos.**
- **Maestro de proveedores:** campos Situación IIBB y Número IIBB.

**Demo:** los proveedores con retenciones IIBB de la demo reciben situación y número de IIBB.

## 9. Pruebas

**Unitarias:**
- El escritor: `NUM` con ceros, `TXT` con espacios y acentos, `IMPORTE` con y sin separador, desborde, fecha vacía, largo exacto y CRLF.
- Cada formato contra una línea armada a mano campo por campo, desde las tablas de las referencias. SICORE también contra el ejemplo del instructivo, en los campos 1 a 3.
- El lector de "Mis Comprobantes": separador `;` y `,`, coma decimal, columnas en otro orden y con variantes de nombre, columna faltante.

**Integración:**
- **Libro IVA Ventas:** FC A con 21% y 10,5%, FC B, NC A, factura en USD, exenta y C. Totales por alícuota y cuadre con el Mayor de IVA débito.
- **Libro IVA Compras:** PDF y Excel, y cuadre con IVA crédito.
- **Libro IVA Digital:**
  - el ZIP tiene 4 archivos;
  - cada línea mide lo que corresponde;
  - la cantidad de cabeceras es igual a la cantidad de comprobantes;
  - la suma de los totales leídos de vuelta coincide con los libros;
  - la exenta lleva la alícuota 0003 con código de operación `E`.
- **SICORE:** dos retenciones y una anulada, que se excluye; filtro por quincena; posiciones de régimen, importe y CUIT leídas en la línea.
- **ARBA:** nombre del ZIP, correlativo de lote que sube y contenido de 67 posiciones.
- **AGIP:**
  - un proveedor sin situación de IIBB da 400 con su nombre;
  - completo, genera 215 posiciones con el importe en su lugar.
- **Control con ARCA:** un CSV con una factura que falta en el sistema, una que falta en ARCA, una con total distinto y una que coincide.
- **Historial:** se genera, se carga una compra en el período, la lista marca `cambiaron` y se vuelve a descargar el archivo original.
- **Permisos:** sin `impuestos.presentar`, 403.

**Punta a punta:** el contador genera el Libro IVA Digital y SICORE del mes de la demo, descarga los archivos y ve el historial.

## 10. Revisión: casos a vigilar

1. Un nombre o razón social con ñ, tildes o comillas: el archivo queda en latin1 sin romper el largo de la línea.
2. Una NC de venta o de compra en el Libro IVA Digital: importes positivos con el código de NC, y en el libro en pantalla resta.
3. Una factura en USD: la cabecera lleva `DOL` y la cotización, los importes en la moneda original y los totales del libro en pesos. Hay que confirmar la convención de ARCA (importes en moneda de origen) contra el diseño.
4. Un período sin movimientos: cada archivo se genera vacío o con su mínimo y con advertencia, nunca con error 500.
5. Un CSV de "Mis Comprobantes" con columnas en otro orden, un BOM o importes "1.234,56": se lee bien. Un CSV de otra cosa: mensaje claro.
