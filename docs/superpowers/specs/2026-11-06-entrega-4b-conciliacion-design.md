# Entrega 4B: Conciliación bancaria. Especificación de diseño

**Fecha:** 2026-11-06
**Estado:** aprobado en conversación, pendiente de revisión escrita
**Spec general:** `docs/superpowers/specs/2026-11-05-sistema-gestion-design.md` (§5, conciliación bancaria)
**Construye sobre:**
- Entrega 4A: `CuentaBancaria` y `MovimientoTesoreria`, que registra cada ingreso y egreso de banco (depósitos, acreditaciones, pagos de OP, débitos de cheques propios, rechazos, movimientos bancarios y transferencias internas);
- `MovimientoBancario`, que se usa para registrar desde el extracto.

## 0. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Origen de los extractos | Homebanking de cada banco, en CSV o Excel, cada uno con su formato. Cada cuenta bancaria tiene un formato configurable, con modelos precargados. |
| Líneas que el sistema no tiene (gastos, impuestos, intereses) | Se registran desde la conciliación con un clic, como movimiento bancario con asiento. Las reglas guardadas proponen la cuenta contable. |
| Forma de trabajo | Conciliación por período, con saldos inicial y final del extracto, cierre y bloqueo de lo conciliado. |
| Coincidencias automáticas | El sistema las propone y el usuario confirma. |
| Modelo | Vínculos de muchos a muchos entre líneas del extracto y movimientos del sistema, con importes iguales. |

**Criterio de éxito:**
1. El tesorero importa el extracto de octubre del Banco Nación. El sistema propone las coincidencias y el tesorero las confirma.
2. Registra con su regla el impuesto de la ley 25.413 y las comisiones.
3. La diferencia queda en cero, la conciliación se cierra y el reporte lista las partidas pendientes.
4. Un depósito conciliado en un período cerrado no se puede anular sin reabrir la conciliación.

**Fuera de alcance:**
- conexión directa con la API de los bancos;
- extractos en PDF;
- conversión entre monedas: cada cuenta se concilia en su moneda;
- conciliación de cajas.

## 1. Formatos de extracto

- `FormatoExtracto` (uno por cuenta bancaria) con los siguientes campos:
  - `cuentaBancariaId` (único);
  - `tipoArchivo`: CSV o XLSX;
  - `separador`: `,` o `;`; solo CSV;
  - `hoja`: nombre o número; solo XLSX, por defecto la primera;
  - `filaInicio`: número de la primera fila de datos, contando desde 1;
  - `formatoFecha`: `DD/MM/AAAA`, `DD-MM-AAAA` o `AAAA-MM-DD`;
  - `separadorDecimal`: `,` o `.`;
  - columnas por número o letra: `columnaFecha`, `columnaConcepto`, `columnaReferencia?` y `columnaSaldo?`;
  - `modoImporte` con sus columnas: IMPORTE_CON_SIGNO usa `columnaImporte`; DEBITO_CREDITO usa `columnaDebito` y `columnaCredito`.
- **Modelos precargados**, para elegir al crear el formato: Banco Nación, Galicia, Santander, Macro, BBVA y Genérico.
  - Son una estimación y hay que verificarlos con un extracto real.
  - La pantalla lo avisa, como en los valores de Ganancias.
- **ABM:** Maestros › Bancos y cajas, pestaña "Formatos de extracto", con `tesoreria.maestros.editar`.
- **Interpretación de cada fila:**
  - las filas vacías se saltean;
  - una fila con fecha o importe ilegible es un error que indica el número de fila;
  - el importe se guarda con su signo: positivo es un crédito (entra al banco) y negativo es un débito;
  - una fila con importe cero se saltea.

## 2. Importación

- `ImportacionExtracto { empresaId, cuentaBancariaId, archivo (nombre), usuarioId, fecha, lineas, duplicadas, estado ACTIVA | DESHECHA }`.
- `LineaExtracto { empresaId, cuentaBancariaId, importacionId, fecha, concepto, referencia?, importe (con signo), saldo?, estado PENDIENTE | CONCILIADA | IGNORADA, motivoIgnorada?, conciliacionId? }`.
- **Endpoints:**
  - `POST /api/conciliacion/importaciones/previsualizar` (multipart: `cuentaBancariaId`, `archivo`) devuelve `{ lineas: [primeras 20 interpretadas], total, errores: [{ fila, mensaje }], advertencias }`. No guarda nada.
  - `POST /api/conciliacion/importaciones` (multipart) guarda y devuelve `{ id, lineas, duplicadas, advertencias }`. Si hay errores de interpretación responde 400 con la lista.
- **Duplicados:**
  - Una línea es duplicada si ya existe en esa cuenta otra con la misma fecha, importe, concepto y referencia, en una importación ACTIVA.
  - Se saltea con aviso, por ejemplo "12 líneas ya estaban importadas".
  - Dentro de un mismo archivo, las filas idénticas sí se importan todas, porque el banco puede repetir un concepto real.
- **Saldo:**
  - Si el formato tiene columna de saldo, se verifica que el saldo de cada línea sea el de la anterior más su importe.
  - Si no cuadra, la importación igual se guarda, con la advertencia "El saldo de la fila N no coincide: revise el formato".
- **Deshacer:** `POST /api/conciliacion/importaciones/:id/deshacer`, solo si ninguna de sus líneas está CONCILIADA. Las líneas se eliminan y la importación queda DESHECHA.
- **Límites del archivo:**
  - hasta 5 MB y 20.000 filas;
  - el tipo de archivo debe coincidir con el formato (400 "El archivo no es CSV");
  - si la cuenta no tiene formato: 400 "La cuenta bancaria no tiene formato de extracto configurado".
- **Codificación:** los CSV se leen como UTF-8 y, si no son UTF-8 válido, como Latin-1.

## 3. Conciliación

- `Conciliacion { empresaId, cuentaBancariaId, desde, hasta, saldoInicial, saldoFinal (según el extracto), estado ABIERTA | CERRADA, cerradaPor?, cerradaEn?, motivoReapertura?, version }`.
  - Al crear una conciliación, `saldoInicial` se propone con el `saldoFinal` de la conciliación cerrada anterior de la cuenta.
  - Solo puede haber una conciliación ABIERTA por cuenta: si ya hay una, 409.
  - Los períodos de una cuenta no se pueden superponer: 409 "El período se superpone con la conciliación de …".
  - `desde` tiene que ser posterior al `hasta` de la última conciliación cerrada.
- `VinculoConciliacion { empresaId, conciliacionId, tipo AUTOMATICO | MANUAL | REGISTRO, creadoPor }`.
  - Cada línea del extracto y cada movimiento del sistema pertenece como máximo a un vínculo.
  - Se guarda con `LineaExtracto.vinculoId` y con `MovimientoTesoreria.vinculoId` (columna nueva).
- **Regla de importes:** la suma de los importes de las líneas es igual a la suma firmada de los movimientos del sistema (INGRESO positivo, EGRESO negativo). Si no: 400 "Los importes no coinciden (extracto $X, sistema $Y)".
- **Qué entra en una conciliación:**
  - líneas de extracto: de esa cuenta, con fecha dentro del período y estado PENDIENTE;
  - movimientos del sistema: de esa cuenta, no anulados, sin vínculo y con fecha hasta el fin del período (los anteriores al período también, porque son partidas que quedaron pendientes).
- **Endpoints (todos con `conciliacion.operar`):**
  - `GET/POST /api/conciliacion/conciliaciones` y `GET /:id`. El GET devuelve la conciliación con resumen, líneas pendientes, movimientos pendientes y vínculos del período.
  - `POST /:id/vinculos { lineas: [id], movimientos: [id], tipo? }`.
  - `DELETE /:id/vinculos/:vinculoId`, solo con la conciliación ABIERTA.
  - `POST /:id/lineas/:lineaId/ignorar { motivo }` y `/:lineaId/restaurar`.
- **Resumen:**
  - `saldoSistema` = Σ de los movimientos no anulados con fecha hasta `hasta`;
  - `pendientesSistema` = Σ firmada de los movimientos sin vínculo hasta `hasta`;
  - `pendientesExtracto` = Σ de las líneas PENDIENTE del período;
  - `diferencia` = `saldoFinal` − (`saldoSistema` − `pendientesSistema` + `pendientesExtracto`);
  - además, se controla que `saldoInicial` + Σ de las líneas del período (sin las IGNORADA) = `saldoFinal`. Si no da, se muestra la advertencia "El extracto del período no explica el saldo final".

## 4. Coincidencias automáticas

`POST /api/conciliacion/conciliaciones/:id/sugerencias` devuelve `[{ lineas: [id], movimientos: [id], nivel: EXACTA | PROBABLE | AGRUPADA, preseleccionada }]`. No guarda nada; se aplican con `POST /:id/vinculos` (uno por sugerencia aceptada), o todas juntas con `POST /:id/vinculos/lote { vinculos: [...] }`.

Cada movimiento y cada línea entra como máximo en una sugerencia. Las pasadas van en orden:

1. **EXACTA** (preseleccionada):
   - mismo importe con su signo;
   - y, además, la referencia de la línea contiene el número del comprobante de origen (número de cheque propio, boleta del depósito, referencia de la transferencia recibida o de la OP), o ambas fechas son iguales.
   - Si hay varios candidatos, gana el de fecha más cercana.
2. **PROBABLE** (sin preseleccionar):
   - mismo importe;
   - fechas a no más de N días (N es `diasToleranciaConciliacion` de la empresa, por defecto 5);
   - un único candidato de cada lado.
3. **AGRUPADA** (sin preseleccionar):
   - una línea contra 2 a 10 movimientos del mismo tipo (todos INGRESO o todos EGRESO) con la misma fecha que la línea, cuya suma iguala exacto la línea;
   - también el caso inverso: un movimiento contra varias líneas de la misma fecha.
   - Se busca solo entre lo que quedó sin sugerencia.

## 5. Registrar desde el extracto y reglas

- `POST /:id/registrar { lineas: [{ lineaId, cuentaContableId, concepto }] }`. Por cada línea, en una sola transacción:
  - crea un `MovimientoBancario` (GASTO si la línea es un débito, INGRESO si es un crédito) con la fecha e importe de la línea, más su `MovimientoTesoreria` y su asiento, usando el servicio de la 4A;
  - crea un vínculo REGISTRO entre la línea y ese movimiento.
- `ReglaConciliacion { empresaId, prioridad, texto, sentido DEBITO | CREDITO | AMBOS, cuentaBancariaId?, cuentaContableId, concepto?, activa }`.
  - Coincide si el concepto de la línea contiene el texto, sin distinguir mayúsculas ni acentos, el sentido corresponde y, si la regla tiene cuenta bancaria, es la misma.
  - Gana la de menor número de prioridad.
- **ABM** en Administración › Reglas de conciliación, con `conciliacion.operar`: `GET/POST/PATCH /api/conciliacion/reglas`.
- El GET de la conciliación devuelve en cada línea pendiente la `reglaSugerida: { id, cuentaContableId, cuenta, concepto } | null`.
- **Cuentas nuevas** en el plan modelo y por migración en las empresas existentes:
  - `5.2.05 Impuesto a los débitos y créditos bancarios`;
  - `4.2.02 Intereses ganados`.
- **Reglas iniciales** por empresa (también por migración):

| Prioridad | Texto | Sentido | Cuenta |
|---|---|---|---|
| 10 | PERCEP IVA | DEBITO | 1.1.03.002 |
| 20 | PERCEP IIBB | DEBITO | 1.1.03.003 |
| 30 | SIRCREB | DEBITO | 1.1.03.003 |
| 40 | LEY 25413 | AMBOS | 5.2.05 |
| 50 | IMP DEB | DEBITO | 5.2.05 |
| 60 | IMP CRED | AMBOS | 5.2.05 |
| 70 | IVA | DEBITO | 1.1.03.001 |
| 80 | COMISION | DEBITO | 5.2.02 |
| 90 | MANTENIMIENTO | DEBITO | 5.2.02 |
| 100 | INTERES | CREDITO | 4.2.02 |

## 6. Cierre, bloqueo y reapertura

- `POST /:id/cerrar { version }`. Requisitos:
  - `diferencia` = 0, o 400 "La conciliación no cuadra: diferencia $X";
  - todas las líneas del período en estado CONCILIADA o IGNORADA, o 400 "Hay N líneas del extracto sin conciliar".
  - Al cerrar se guardan el `resumen` (JSON con los cuatro importes) y `cerradaPor` / `cerradaEn`.
  - Los movimientos del sistema que quedan pendientes no impiden el cierre y aparecen en la siguiente conciliación.
- **Bloqueo** (helper `verificarNoConciliado(tx, origenTipo, origenId)`, llamado por cada anulación que anula movimientos de banco):
  - Anulaciones alcanzadas: de ingreso (transferencias acreditadas), depósito, OP pagada, rechazo de cheque, débito de cheque propio, movimiento bancario y transferencia interna.
  - Si algún `MovimientoTesoreria` del origen tiene un vínculo en una conciliación CERRADA: 400 "El movimiento está conciliado en la conciliación del período DD/MM/AAAA–DD/MM/AAAA: reábrala para anularlo".
  - Si el vínculo está en una conciliación ABIERTA, la anulación primero elimina el vínculo, y la línea del extracto vuelve a PENDIENTE.
  - Además, no se pueden registrar movimientos de banco con fecha igual o anterior al `hasta` de la última conciliación CERRADA de esa cuenta: 400 "La cuenta está conciliada hasta DD/MM/AAAA". Esto se controla en `registrarMovimiento` cuando trae `cuentaBancariaId`.
- **Reabrir:** `POST /:id/reabrir { motivo }` con `tesoreria.anular`. Solo se puede reabrir la última cerrada de la cuenta y solo si no hay otra abierta. Queda ABIERTA y se audita el motivo.

## 7. Reporte

- `GET /api/conciliacion/conciliaciones/:id/reporte?formato=pdf|xlsx` incluye:
  - encabezado con empresa, cuenta, período, estado, quién la cerró y cuándo;
  - saldo según el extracto;
  - (+) créditos del sistema no acreditados por el banco y (−) débitos del sistema no debitados, cada uno con su detalle (fecha, descripción e importe);
  - (+/−) líneas del banco pendientes de registrar, con su detalle;
  - saldo según libros y diferencia.
- Usa pdfkit y exceljs, igual que la OP y el Libro IVA.

## 8. Web

- **Registraciones › Tesorería › Conciliación bancaria:**
  - historial de conciliaciones por cuenta, con estado, período, saldos y botones para el reporte y para reabrir;
  - "Importar extracto": selector de cuenta, archivo, vista previa con errores y advertencias, y confirmar;
  - "Nueva conciliación": cuenta, período y saldos.
- **Pantalla de conciliación:**
  - **resumen arriba:** saldo del extracto, saldo del sistema, pendientes de cada lado y diferencia en rojo o en verde;
  - **dos tablas con casillas:** "Extracto" y "Sistema", con la suma seleccionada de cada lado;
  - **botones:**
    - "Conciliar seleccionados": habilitado si las sumas coinciden;
    - "Buscar coincidencias": abre un modal con las sugerencias agrupadas por nivel, con casillas y "Aplicar";
    - "Registrar": en cada línea, con la cuenta sugerida editable;
    - "Registrar todas las que tienen regla";
    - "Ignorar";
    - "Cerrar conciliación";
  - **pestaña "Conciliado":** los vínculos del período, con "Deshacer".
- **Maestros › Bancos y cajas:** pestaña "Formatos de extracto", con un selector de modelo y el aviso de verificar.
- **Administración › Reglas de conciliación:** ABM ordenado por prioridad.

## 9. Errores y concurrencia

- Mensajes en castellano y una transacción por operación.
- **Orden de bloqueo:** conciliación → movimientos de tesorería → líneas de extracto (cada grupo ordenado por id).
- Un movimiento o una línea que ya tiene vínculo responde 409 "El movimiento ya fue conciliado" o 409 "La línea ya fue conciliada".
- Operar sobre una conciliación CERRADA responde 400 "La conciliación está cerrada".
- El permiso nuevo `conciliacion.operar` se agrega al rol Administrador de las empresas existentes por migración.

## 10. Pruebas y datos demo

- **Integración:**
  - interpretación de los dos modos de importe, de los tres formatos de fecha y de los dos separadores decimales;
  - XLSX y CSV en Latin-1;
  - errores con número de fila y líneas duplicadas;
  - advertencia de saldo;
  - deshacer una importación;
  - crear una conciliación con saldo propuesto y superposición (409);
  - las tres pasadas de sugerencias, incluida una agrupada;
  - vínculo de varios con varios y vínculo con importes distintos (400);
  - registrar con regla, y verificar el asiento y la prioridad de las reglas;
  - ignorar una línea;
  - cierre que cuadra y cierre con diferencia;
  - partidas pendientes que pasan a la conciliación siguiente;
  - bloqueo de la anulación de un depósito conciliado, y desvinculación cuando la conciliación está abierta;
  - bloqueo de movimientos con fecha conciliada;
  - reapertura;
  - reporte en PDF y XLSX;
  - dos vínculos simultáneos sobre el mismo movimiento (201 y 409);
  - aislamiento entre empresas.
- **E2E:**
  1. El tesorero importa `extracto-demo-nacion.csv`.
  2. Crea la conciliación y aplica las sugerencias.
  3. Registra con regla el impuesto 25.413.
  4. Cierra, y la conciliación queda CERRADA con diferencia $ 0,00.
- **Seed:**
  - formato Banco Nación en la cuenta demo;
  - reglas iniciales;
  - archivo `apps/api/prisma/demo/extracto-demo-nacion.csv`, generado por el seed a partir de los movimientos bancarios que siembra, más tres líneas propias del banco (25.413, comisión e IVA de la comisión). Las fechas dependen del día de la siembra, por eso se genera al sembrar y está en `.gitignore`;
  - permiso `conciliacion.operar` para el rol Tesorero.

## 11. Orden de construcción

1. Formatos de extracto e intérprete de archivos (unitario).
2. Importación, duplicados, saldo y deshacer.
3. Conciliación: alta, resumen y vínculos manuales.
4. Sugerencias automáticas.
5. Reglas y registro desde el extracto.
6. Cierre, bloqueo y reapertura.
7. Reporte PDF y XLSX.
8. Web.
9. Seed, e2e y README.
