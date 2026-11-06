# Entrega 5: Contabilidad general. Especificación de diseño

**Fecha:** 2026-11-07
**Estado:** aprobado en conversación, pendiente de revisión escrita
**Spec general:** `docs/superpowers/specs/2026-11-05-sistema-gestion-design.md` (§6, contabilidad)

**Construye sobre:**
- el plan de cuentas jerárquico, los centros de costo y los conceptos contables (`ConfigCuenta`);
- `AsientosService.generar` y `contraasiento`, que generan los asientos automáticos de compras, pagos, tesorería y conciliación, siempre balanceados;
- `Empresa.inicioEjercicioMes`.

## 0. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Uso | La empresa lleva la contabilidad completa en el sistema: asientos manuales, consultas, estados contables y cierre del ejercicio. |
| Ajuste por inflación (RT 6 / RT 54) | Fuera de esta entrega. Los estados salen en moneda histórica; el ajuste tendrá una entrega propia, diseñada con el contador. |
| Libros | Legales: numeración por ejercicio, meses definitivos al cerrarse, y Libro Diario y Libro de Inventarios y Balances en PDF con folios. |
| Numeración | Provisoria mientras el mes está abierto. Al cerrar el mes, los asientos reciben su número definitivo en orden cronológico. |

**Criterio de éxito:**
1. El contador registra asientos manuales, consulta el Diario, el Mayor y el balance de sumas y saldos, y cierra los meses en orden. El Diario legal sale en orden de fecha y con folios.
2. Una factura con fecha de un mes cerrado se rechaza.
3. Al cerrar el ejercicio, el sistema genera la refundición, el cierre y la apertura. El ejercicio nuevo arranca con los saldos patrimoniales.
4. El estado de situación patrimonial cumple activo = pasivo + patrimonio neto, y el estado de resultados muestra el resultado del ejercicio.

**Fuera de alcance:**
- ajuste por inflación;
- presupuesto e informes gerenciales;
- distribución automática de resultados (se hace con un asiento manual);
- consolidación de empresas;
- notas, anexos y estado de evolución del patrimonio neto y de flujo de efectivo (salvo como datos para el contador).

## 1. Ejercicios y períodos

- `Ejercicio { empresaId, numero, desde, hasta, estado ABIERTO | CERRADO, asientoRefundicionId?, asientoCierreId?, asientoAperturaId?, cerradoPor?, cerradoEn?, motivoReapertura? }`:
  - único por `empresaId + numero`;
  - abarca 12 meses: desde el día 1 del mes `inicioEjercicioMes` hasta el último día del mes anterior del año siguiente.
- `PeriodoContable { empresaId, ejercicioId, anio, mes, desde, hasta, estado ABIERTO | CERRADO, cerradoPor?, cerradoEn?, motivoReapertura? }`: 12 por ejercicio, únicos por `empresaId + anio + mes`.
- **Alta:**
  - al crear una empresa se crea el ejercicio que contiene la fecha de hoy (número 1), con sus períodos;
  - `POST /api/contabilidad/ejercicios/siguiente` crea el ejercicio que sigue al último (número + 1). Solo puede haber dos ejercicios ABIERTOS a la vez: si ya hay dos, 400.
- **Migración de empresas existentes:**
  - crea los ejercicios que cubren desde el asiento más antiguo hasta hoy;
  - asigna `ejercicioId` a cada asiento;
  - todos los períodos quedan abiertos.
- **Cambiar `inicioEjercicioMes`:** solo se permite si la empresa no tiene ejercicios con asientos. Si no: 400 "No se puede cambiar el inicio del ejercicio con ejercicios en uso".

## 2. Control de fechas en el motor de asientos

`AsientosService.generar` (y por lo tanto todo asiento, automático o manual, incluidos los contraasientos) verifica antes de grabar:

| Caso | Respuesta |
|---|---|
| Ningún ejercicio cubre la fecha | 400 "No hay un ejercicio contable para la fecha DD/MM/AAAA" |
| El ejercicio está cerrado | 400 "El ejercicio N está cerrado" |
| El período está cerrado | 400 "El período MM/AAAA está cerrado" |

- **Sin excepciones:** los asientos del cierre del ejercicio (§6) también pasan el control, porque se generan con el último mes y el ejercicio todavía abiertos, y la apertura va al primer mes, abierto, del ejercicio siguiente.
- **Bloqueo:** antes de verificar, el motor bloquea el período (`FOR UPDATE`) y lo mantiene hasta el fin de la transacción. Así un asiento no se cuela mientras otro usuario cierra el mes.
- **Orden de bloqueo:** el período es lo último que se bloquea en una operación, después de todo lo del módulo que genera el asiento.
- El asiento guarda `ejercicioId`.

## 3. Asientos manuales

- **Tipos de asiento** (`Asiento.tipo`): AUTOMATICO (los de los módulos), MANUAL, REFUNDICION, CIERRE y APERTURA. Los existentes quedan como AUTOMATICO.
- **Endpoints**, con el permiso nuevo `asiento.registrar`:
  - `POST /api/contabilidad/asientos { fecha, descripcion, renglones: [{ cuentaContableId, centroCostoId?, debe?, haber?, detalle? }] }`:
    - al menos dos renglones;
    - cada renglón con un solo lado mayor que cero;
    - las cuentas tienen que ser imputables y activas;
    - tiene que balancear, o 400 "El asiento no balancea (debe X, haber Y)";
    - `origenTipo` es 'MANUAL' y `origenId` es el propio id del asiento.
  - `PUT /api/contabilidad/asientos/:id`: reemplaza fecha, descripción y renglones. Solo para MANUAL, con su período abierto (el viejo y el nuevo), y usa control optimista por `version`.
  - `DELETE /api/contabilidad/asientos/:id`: solo para MANUAL con el período abierto. Queda en la auditoría.
  - `POST /api/contabilidad/asientos/:id/anular { fecha, motivo }`: genera el contraasiento (MANUAL) con la fecha indicada, que tiene que estar en un período abierto. Se puede anular una sola vez; si no, 409.
- **Asientos automáticos:** modificarlos, borrarlos o anularlos por estos endpoints responde 400 "Los asientos automáticos se anulan desde su comprobante".

## 4. Cierre de mes y numeración definitiva

- `Asiento.numero` sigue siendo el número interno (provisorio). Se agrega `numeroDefinitivo Int?`, único por `empresaId + ejercicioId + numeroDefinitivo`.
- **Cerrar un mes:** `POST /api/contabilidad/periodos/:id/cerrar`, con el permiso nuevo `contabilidad.cerrar`.
  - **Requisitos:** el ejercicio está ABIERTO y todos los meses anteriores del ejercicio están CERRADOS. Si no: 400 "Cierre primero el período MM/AAAA".
  - **Bloqueo:** el período, con `FOR UPDATE`.
  - **Numeración:** asigna números definitivos a los asientos del mes, continuando el último número definitivo del ejercicio, en este orden:
    1. fecha;
    2. tipo, con APERTURA primero, luego AUTOMATICO y MANUAL, y REFUNDICION y CIERRE al final;
    3. fecha de carga;
    4. número interno.
  - Estado CERRADO, con quién y cuándo.
- **Reabrir:** `POST /api/contabilidad/periodos/:id/reabrir { motivo }`, con `contabilidad.cerrar`.
  - Solo el último mes cerrado del ejercicio, y solo con el ejercicio ABIERTO.
  - Borra los números definitivos del mes y audita el motivo.
- **Consulta:** `GET /api/contabilidad/ejercicios` devuelve los ejercicios con sus períodos, cantidad de asientos y estado.

## 5. Consultas

Todas con `plancuentas.ver`, en JSON, Excel (`formato=xlsx`) y PDF (`formato=pdf`):

- **Libro Diario:** `GET /api/contabilidad/diario?desde&hasta&origenTipo&pagina`.
  - Asientos ordenados por número definitivo, o por fecha, tipo y fecha de carga mientras no lo tienen.
  - Cada asiento trae número interno y definitivo, fecha, tipo, descripción, origen (`origenTipo`, `origenId`, `ruta` web del comprobante cuando hay pantalla) y renglones con cuenta (código y nombre), centro de costo, debe, haber y detalle.
  - Incluye totales de debe y haber del rango.
- **Detalle de un asiento:** `GET /api/contabilidad/asientos/:id`, con renglones, el asiento que anula o que lo anula, y la ruta del origen.
- **Mayor:** `GET /api/contabilidad/mayor?cuentaContableId&desde&hasta&centroCostoId`.
  - Si la cuenta no es imputable, incluye todas sus descendientes.
  - `saldoInicial` = Σ(debe − haber) de los asientos del mismo ejercicio con fecha anterior a `desde`, incluida la apertura.
  - Cada movimiento trae fecha, asiento (número), descripción, debe, haber y saldo acumulado.
  - `desde` y `hasta` tienen que estar dentro de un mismo ejercicio; si no, 400.
- **Balance de sumas y saldos:** `GET /api/contabilidad/sumas-saldos?ejercicioId&desde&hasta&nivel`.
  - Por defecto el rango es el ejercicio completo hasta hoy.
  - Muestra cada cuenta con movimiento y todos sus rubros ascendentes: debe, haber, saldo deudor y saldo acreedor.
  - Los rubros llevan la suma de sus descendientes. `nivel` (1 a 5) limita la profundidad.
  - Los totales generales salen de las imputables (debe = haber).
  - Excluye los asientos de REFUNDICION y CIERRE salvo con `incluirCierre=true`.
- **Ruta del origen**, por `origenTipo`:

| `origenTipo` | Pantalla |
|---|---|
| COMPROBANTE_COMPRA | detalle del comprobante |
| PAGO u OP | detalle de la OP |
| INGRESO_VALORES | ingreso |
| DEPOSITO | depósito |
| MOVIMIENTO_BANCARIO | movimientos bancarios |
| MANUAL | asiento |
| otros | sin enlace |

## 6. Cierre del ejercicio

- **Vista previa:** `GET /api/contabilidad/ejercicios/:id/cierre/previa` devuelve los renglones de la refundición y del cierre, el resultado del ejercicio y los requisitos pendientes.
- **Cierre:** `POST /api/contabilidad/ejercicios/:id/cerrar`, con `contabilidad.cerrar`.
  - **Requisitos:**
    - los 11 primeros meses CERRADOS y el último ABIERTO;
    - existe el ejercicio siguiente, y su primer mes está ABIERTO;
    - si falta algo: 400 con lo que falta.
  - **Asientos que genera:**
    1. **Refundición** (REFUNDICION), con fecha del último día del ejercicio. Por cada cuenta de resultado (tipos RESULTADO_POSITIVO y RESULTADO_NEGATIVO) con saldo, el renglón inverso a su saldo. El neto va a la cuenta del concepto nuevo `RESULTADO_DEL_EJERCICIO` (3.2.02 "Resultado del ejercicio"). Si no hay saldos de resultado, no se genera.
    2. **Cierre** (CIERRE), con la misma fecha. Por cada cuenta patrimonial (ACTIVO, PASIVO y PATRIMONIO_NETO) con saldo después de la refundición, el renglón inverso.
    3. **Apertura** (APERTURA), con fecha del primer día del ejercicio siguiente: el inverso del cierre.
  - **Después:** cierra el último mes (numerando también la refundición y el cierre), marca el ejercicio CERRADO y guarda los ids de los tres asientos.
  - Saldos con centro de costo: la refundición y el cierre agrupan por cuenta, sin centro de costo.
- **Reabrir:** `POST /api/contabilidad/ejercicios/:id/reabrir { motivo }`.
  - Solo el último ejercicio cerrado, y solo si el siguiente no tiene meses cerrados.
  - Elimina los tres asientos (sus renglones y la auditoría quedan registrados), reabre el último mes (borrando sus números definitivos) y marca el ejercicio ABIERTO.

## 7. Estados contables

Con `plancuentas.ver`, en JSON y PDF:

- **Estado de situación patrimonial:** `GET /api/contabilidad/estados/situacion?fecha&nivel`.
  - Por defecto la fecha es el fin del último ejercicio cerrado, o hoy.
  - Se arma con los saldos a la fecha dentro del ejercicio que la contiene (apertura incluida, cierre excluido).
  - Activo (1), pasivo (2) y patrimonio neto (3), con la jerarquía del plan hasta `nivel` (por defecto 3).
  - Dentro del patrimonio neto, si el ejercicio no está refundido a esa fecha, se agrega la línea "Resultado del ejercicio (en curso)" con el saldo neto de las cuentas 4 y 5.
  - Totales: activo, pasivo, patrimonio neto, y el control `activo − (pasivo + patrimonio neto) = 0`.
  - Si existe un ejercicio anterior, se agrega una columna comparativa con los saldos al cierre de ese ejercicio.
- **Estado de resultados:** `GET /api/contabilidad/estados/resultados?desde&hasta&nivel`.
  - Por defecto, el ejercicio en curso.
  - Resultados positivos (4) y negativos (5) por rubro, y el resultado del período (4 − 5).
  - Excluye REFUNDICION y CIERRE.
  - Comparativo con el mismo rango del ejercicio anterior, si existe.
- **Signos:** las cuentas de activo y resultado negativo se presentan con su saldo deudor como positivo, y las de pasivo, patrimonio neto y resultado positivo con su saldo acreedor como positivo.

## 8. Libros legales

- `EmisionLibro { empresaId, libro DIARIO | INVENTARIOS, ejercicioId, desde, hasta, folioInicial, folioFinal, usuarioId, fecha }`.
- **Libro Diario:** `POST /api/contabilidad/libros/diario { desde, hasta, folioInicial? }` devuelve un PDF.
  - Solo meses CERRADOS; si no: 400 "El período MM/AAAA no está cerrado".
  - `folioInicial` es por defecto el último `folioFinal` del Diario + 1, o 1.
  - **Cada página:**
    - encabezado con razón social, CUIT, "Libro Diario", rango y número de folio;
    - "Transporte" al pie y "Viene de transporte" al comienzo de la siguiente, con los totales acumulados de debe y haber.
  - **Cada asiento:** número definitivo, fecha, descripción, renglones (código, cuenta, debe, haber) y totales.
  - Registra la emisión.
  - Si el rango ya fue emitido, la respuesta lleva el header `X-Advertencia: El rango ya fue emitido el DD/MM/AAAA (folios N a M)`.
- **Libro de Inventarios y Balances:** `POST /api/contabilidad/libros/inventarios { ejercicioId, folioInicial? }`, solo para ejercicios CERRADOS.
  - Contiene el balance de sumas y saldos del ejercicio (sin refundición ni cierre), el estado de situación patrimonial y el estado de resultados.
  - Mismo encabezado y foliado, y registra la emisión.
- **Historial:** `GET /api/contabilidad/libros/emisiones`.

## 9. Web

- **Registraciones › Contabilidad General:**
  - Asiento manual: grilla de renglones con totales en vivo y diferencia; Registrar solo si balancea.
  - Períodos y ejercicios: los ejercicios con sus meses en grilla (estado y cantidad de asientos), con estos botones:
    - "Cerrar mes" y "Reabrir mes";
    - "Abrir ejercicio siguiente";
    - "Cerrar ejercicio", con vista previa;
    - "Reabrir ejercicio".
- **Consultas › Contabilidad General:**
  - Libro Diario (con enlace al origen y acciones de modificar o anular en los asientos manuales);
  - Mayor;
  - Balance de sumas y saldos;
  - Estado de situación patrimonial;
  - Estado de resultados;
  - Libros legales (emitir e historial).
- **Detalle de asiento:** un modal reutilizable desde cualquier consulta.

## 10. Permisos, errores y concurrencia

- **Permisos nuevos:**
  - `asiento.registrar`: asientos manuales;
  - `contabilidad.cerrar`: meses, ejercicios y libros legales.
  - Se agregan al rol Administrador de las empresas existentes por migración.
- **Concepto nuevo:** `RESULTADO_DEL_EJERCICIO` → 3.2.02, en el plan modelo y por migración.
- **Cierre de mes y de ejercicio:** bloquean el período o el ejercicio. Los asientos en curso los esperan (ver §2).
- **Mensajes:** en castellano.

## 11. Pruebas y datos demo

- **Integración:**
  - **fechas:** sin ejercicio y en un mes cerrado, desde una factura, un pago y un asiento manual; todo se revierte;
  - **cierre de mes:**
    - numeración cronológica: un asiento cargado tarde con fecha anterior queda primero;
    - continuidad entre meses;
    - cierre fuera de orden;
    - reapertura que borra y reasigna los números;
  - **asientos manuales:**
    - un asiento que no balancea, con un renglón con debe y haber, o con una cuenta no imputable;
    - modificar con el mes abierto, y 400 con el mes cerrado;
    - eliminar;
    - anular con contraasiento;
    - un asiento automático no se toca;
  - **consultas:**
    - Diario con totales;
    - Mayor con saldo inicial, rubro con descendientes y centro de costo;
    - sumas y saldos con totales que coinciden y subtotales por rubro;
  - **cierre del ejercicio:**
    - refundición contra 3.2.02;
    - cierre que deja todo en cero;
    - apertura con los saldos patrimoniales;
    - numeración;
    - reapertura;
    - requisitos faltantes;
  - **estados:**
    - situación patrimonial que cuadra, con el resultado en curso;
    - estado de resultados;
    - comparativo;
  - **libros:**
    - PDF del Diario con folios y transporte;
    - folio propuesto que continúa la emisión anterior;
    - advertencia de reemisión;
    - Inventarios y Balances;
  - **concurrencia:** un asiento y el cierre del mismo mes a la vez nunca dejan un asiento sin número definitivo en un mes cerrado;
  - aislamiento entre empresas.
- **E2E:**
  1. El contador registra un asiento manual con fecha del mes anterior.
  2. Lo encuentra en el Diario y en el Mayor.
  3. Cierra ese mes (y los anteriores del ejercicio), y el asiento recibe un número definitivo.
  4. Emite el Libro Diario de ese mes en PDF.
- **Seed:**
  - ejercicio actual de la empresa demo;
  - asiento manual de aporte de capital, que sea el más antiguo del ejercicio;
  - usuario `contador@demo.com` / `contador1234`, con el rol Contador (`plancuentas.ver`, `plancuentas.editar`, `auditoria.ver`, `asiento.registrar`, `contabilidad.cerrar`).

## 12. Orden de construcción

1. Ejercicios, períodos, migración y control de fechas en el motor de asientos.
2. Asientos manuales.
3. Cierre de mes y numeración definitiva.
4. Diario, Mayor y sumas y saldos (con Excel y PDF).
5. Cierre del ejercicio.
6. Estados contables.
7. Libros legales.
8. Web.
9. Seed, e2e y README.
