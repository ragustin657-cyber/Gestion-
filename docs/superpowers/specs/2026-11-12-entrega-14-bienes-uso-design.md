# Entrega 14 — Bienes de uso

## 1. Objetivo y alcance

El contador lleva los bienes de uso dentro del sistema: cada bien comprado queda registrado, la amortización mensual se contabiliza con un botón, las bajas y ventas dan su resultado, y la planilla anexa de bienes de uso coincide con el Mayor, en valores nominales y reexpresados.

**Criterio de éxito.** Con la demo: registro una factura de proveedor con un rodado, genero la amortización de cada mes, vendo el rodado con una factura de venta y la planilla anexa del ejercicio muestra altas, bajas, amortizaciones y valor residual que coinciden con el Mayor; el ajuste por inflación reexpresa la amortización desde el mes de alta del bien.

**Decisiones tomadas con el usuario:**
- **Alta:** desde la factura de proveedor (renglón a la cuenta de un rubro) y a mano (alta con asiento o carga inicial).
- **Amortización:** lineal por meses, desde el mes de alta inclusive, sin amortizar el mes de baja; vida útil por rubro, modificable por bien; valor residual opcional.
- **Inflación:** integrada con el ajuste de la Entrega 9 mediante una fecha de origen en el renglón del asiento.
- **Proceso:** amortización mensual por botón (vista previa, generar, anular), un asiento por mes agrupado por rubro y mes de alta.

**Fuera de alcance:** amortización impositiva, revalúo técnico, bienes en moneda extranjera, componentes, mejoras que extienden la vida útil, centros de costo por bien.

## 2. Plan de cuentas, conceptos y rubros

**Cuentas nuevas** en el plan modelo; la migración las crea en cada empresa que tenga la cuenta madre y no tenga el código:
- `1.2.02 Amortizaciones acumuladas de bienes de uso` (activo, no monetaria) con `1.2.02.001 Amort. acum. muebles y útiles`, `1.2.02.002 Amort. acum. rodados`, `1.2.02.003 Amort. acum. equipos de computación` (imputables, no monetarias). La regla de cuentas no monetarias del plan modelo incorpora `1.2.02` y sus descendientes.
- `5.2.07 Amortizaciones de bienes de uso` y `5.2.08 Bajas de bienes de uso` (resultado negativo, imputables).
- `4.2.05 Resultado por venta de bienes de uso` (resultado positivo, imputable).

**Conceptos nuevos** en `CONCEPTOS_CUENTA`: `RESULTADO_VENTA_BIENES_USO: '4.2.05'`, `BAJAS_BIENES_USO: '5.2.08'`.

**Rubro** (`RubroBienUso`, de empresa): `{ id, empresaId, nombre, cuentaOrigenId, cuentaAmortizacionId, cuentaGastoId, vidaUtilMeses, activo }`, nombre único por empresa. Validaciones (400):
- cuentas imputables: `La cuenta <código> no es imputable`;
- `cuentaOrigenId` única entre rubros: `La cuenta <código> ya es de otro rubro`;
- `vidaUtilMeses` entero entre 1 y 1200.

**Rubros precargados** (plan modelo y migración, si existen las cuentas): Muebles y útiles (1.2.01.001 / 1.2.02.001 / 5.2.07, 120 meses), Rodados (1.2.01.002 / 1.2.02.002 / 5.2.07, 60), Equipos de computación (1.2.01.003 / 1.2.02.003 / 5.2.07, 36).

## 3. Bien de uso

`BienUso { id, empresaId, numero (correlativo por empresa), descripcion, rubroId, fechaAlta, valorOrigen Decimal(18,2), vidaUtilMeses, valorResidual Decimal(18,2) default 0, origen: FACTURA | MANUAL | INICIAL, comprobanteCompraRenglonId?, asientoAltaId?, amortizacionInicial Decimal(18,2) default 0, fechaAmortizacionInicial?, estado: ACTIVO | BAJA, fechaBaja?, motivoBaja?: DESUSO | SINIESTRO | ROBO | VENTA, comprobanteVentaRenglonId?, asientoBajaId?, creadoPor, creadoEn }`.

Validaciones comunes (400): `valorOrigen > 0`; `0 ≤ valorResidual < valorOrigen` (`El valor residual debe ser menor que el valor de origen`); vida útil entre 1 y 1200 meses.

**Desde la factura de proveedor.** Un renglón cuya cuenta es la `cuentaOrigenId` de un rubro activo debe traer `bien: { descripcion, vidaUtilMeses?, valorResidual? }`; sin él la factura se rechaza: `Indique el bien de uso del renglón N`. Al registrar la factura se crea un bien por renglón: `fechaAlta` = fecha de la factura, `valorOrigen` = neto del renglón × cotización (2 decimales), origen `FACTURA`, sin asiento propio (la factura ya debita la cuenta). Una NC de proveedor no modifica bienes.

**Anular una factura con bienes:** si alguno tiene amortizaciones contabilizadas vigentes o está dado de baja: `El bien N° X ya tiene amortizaciones o baja: anúlelas primero`. Si no, los bienes se eliminan con la anulación.

**Alta manual** (`POST /api/bienes-uso` con `origen: 'MANUAL'`, `cuentaContrapartidaId`): asiento a la fecha de alta, debe `cuentaOrigenId` del rubro, haber la contrapartida (imputable, distinta de la del rubro).

**Carga inicial** (`origen: 'INICIAL'`): sin asiento (el saldo ya está en la apertura). Exige `amortizacionInicial` (0 ≤ x ≤ valorOrigen − valorResidual) y `fechaAmortizacionInicial` (fin de un mes, posterior o igual al mes de alta): la amortización acumulada hasta ese mes inclusive. La amortización del sistema empieza el mes siguiente.

**Edición:** descripción siempre; rubro, fecha de alta, valores y vida útil solo mientras el bien no tenga amortizaciones contabilizadas vigentes (`El bien ya tiene amortizaciones: anúlelas para modificarlo`). Eliminar: solo bienes `MANUAL`/`INICIAL` sin amortizaciones ni baja (anula el asiento de alta si lo hay).

## 4. Amortización mensual

**Cálculo puro** (`apps/api/src/bienes-uso/calculo.ts`). Para un bien y un mes `M`:
- Amortizable = valorOrigen − valorResidual; cuota = amortizable / vidaUtilMeses (sin redondear).
- Meses amortizados hasta `M` = meses desde el mes de alta inclusive hasta `M` inclusive, sin pasar de la vida útil; si el bien tiene baja, hasta el mes anterior al de la baja.
- Amortización acumulada esperada hasta `M` = redondeo a 2 decimales de cuota × meses (al completar la vida útil, exactamente el amortizable). Para la carga inicial, la acumulada hasta `fechaAmortizacionInicial` es `amortizacionInicial` y desde ahí la cuota es (amortizable − amortizacionInicial) / meses restantes de vida útil.
- Del mes = esperada hasta `M` − ya contabilizada (amortizaciones vigentes del bien + la inicial). Puede abarcar varios meses si el bien se cargó tarde.

**Registro** `AmortizacionBien { id, empresaId, bienId, asientoId, mes (AAAA-MM), importe }` y `ProcesoAmortizacion { id, empresaId, mes, asientoId, estado: VIGENTE | ANULADO, creadoPor, creadoEn }`.

**Endpoints** (permiso `contabilidad.cerrar`):
- `GET /api/bienes-uso/amortizacion/previa?mes=AAAA-MM` → `{ mes, filas: [{ bienId, numero, descripcion, rubro, importe }], porRubro: [{ rubroId, nombre, importe }], total }` (solo bienes con importe ≠ 0).
- `POST /api/bienes-uso/amortizacion { mes }` → genera el asiento con fecha el último día del mes: por cada rubro y mes de alta, debe `cuentaGastoId`, haber `cuentaAmortizacionId`, con `fechaOrigen` = primer día del mes de alta. Tipo de asiento `AUTOMATICO`, `origenTipo 'AMORTIZACION'`. Sin importes: 400 `No hay amortizaciones para contabilizar en MM/AAAA`.
- `POST /api/bienes-uso/amortizacion/:id/anular` → contraasiento; solo el último proceso vigente (`Solo se puede anular la última amortización generada`).
- `GET /api/bienes-uso/amortizacion` → procesos con mes, total, asiento y estado.

Reglas (400): `mes` no anterior al último proceso vigente (`Ya hay una amortización generada para un mes posterior: MM/AAAA`); el período del último día del mes debe estar abierto (mensaje existente de períodos); un mes con proceso vigente se puede volver a generar y agrega solo la diferencia (bienes cargados tarde).

**Cierre del ejercicio:** requiere un proceso vigente del mes de cierre y que la vista previa de ese mes dé total 0: `Genere la amortización de bienes de uso de MM/AAAA` (solo si la empresa tiene bienes activos o dados de baja en el ejercicio).

## 5. Bajas y ventas

**Baja manual** `POST /api/bienes-uso/:id/baja { fecha, motivo: DESUSO | SINIESTRO | ROBO }` (`bienes.gestionar`):
- Requisitos: bien activo; `fecha ≥ fechaAlta`; la amortización de los meses anteriores al de la baja ya contabilizada (vista previa del bien al mes anterior = 0): si no, 400 `Genere primero la amortización de MM/AAAA`; sin amortizaciones de meses ≥ al de la baja (`El bien tiene amortizaciones posteriores a la baja`).
- Asiento a `fecha`: debe `cuentaAmortizacionId` por la acumulada, debe `BAJAS_BIENES_USO` por el residual contable (origen − acumulada), haber `cuentaOrigenId` por el valor de origen; todos los renglones con `fechaOrigen` = primer día del mes de alta.
- Anular baja `POST /api/bienes-uso/:id/baja/anular`: contraasiento, el bien vuelve a `ACTIVO`; solo bajas manuales sin amortizaciones posteriores.

**Venta.** El renglón del comprobante de venta acepta `bienUsoId` (sin artículo, cantidad 1). Su cuenta contable es `RESULTADO_VENTA_BIENES_USO` en lugar de Ventas. Validaciones al guardar y al reservar (antes de ARCA; nada bloquea después de la autorización): bien activo, `fecha ≥ fechaAlta`, amortización de los meses anteriores contabilizada, sin amortizaciones posteriores, y que ningún otro comprobante pendiente o autorizado no anulado lo incluya (`El bien N° X ya está en otro comprobante`). Solo en FACTURA y NOTA_DEBITO (`Una nota de crédito no puede vender un bien de uso`). Al autorizar, la baja con motivo `VENTA` se registra en la misma transacción con fecha del comprobante y el residual contable va a `RESULTADO_VENTA_BIENES_USO` (así esa cuenta queda con precio − residual). Esos renglones se excluyen de los informes de ventas y márgenes de la Entrega 13.

## 6. Inflación

- `AsientoRenglon.fechaOrigen DateTime? @db.Date`. `AsientosService.generar` lo acepta por renglón; el contraasiento lo copia.
- El cálculo del ajuste por inflación agrupa los movimientos por el mes de `COALESCE(r."fechaOrigen", a."fecha")`. Un mes de origen anterior al inicio del ejercicio se reexpresa con su propio índice (los meses necesarios incluyen esos meses; si faltan, el mensaje existente `Faltan los índices de: …`).
- La amortización, las bajas y la anulación de la factura de alta llevan la fecha de origen del bien; el alta manual y la factura usan su propia fecha (igual al mes de alta).

## 7. Planilla anexa y consultas

`GET /api/bienes-uso/planilla?ejercicioId&fecha&reexpresar=true|false&formato=xlsx|pdf` (`bienes.ver`); `fecha` dentro del ejercicio (por defecto su cierre). Por rubro y total:
- `origenInicio` (bienes con alta antes del inicio y sin baja antes del inicio), `altas` (alta en el ejercicio hasta la fecha), `bajas` (baja en el ejercicio hasta la fecha, en negativo), `origenCierre`;
- `amortInicio` (acumulada contabilizada al día anterior al inicio, incluida la inicial), `amortBajas` (acumulada de los dados de baja, en negativo), `amortEjercicio` (contabilizada en el ejercicio hasta la fecha), `amortCierre`;
- `neto` = origenCierre − amortCierre.
- **Reexpresada:** cada importe del bien × I(mes de `fecha`) / I(mes de alta); si falta algún índice, `aviso: 'Faltan los índices de: …: se muestran importes nominales'` y valores nominales.
- **Control con el Mayor** (nominal): por rubro, saldo de `cuentaOrigenId` y de `cuentaAmortizacionId` a la fecha (sin los asientos de ajuste por inflación) contra `origenCierre` y `amortCierre`; `control: { origen, amortizacion }` (diferencias; 0 = coincide).

`GET /api/bienes-uso?rubroId&estado&q` (lista con acumulada y residual a hoy), `GET /api/bienes-uso/:id` (ficha con historial: alta, amortizaciones por mes, baja con asientos).

## 8. Web

- **Permisos nuevos:** `bienes.ver` ("Ver bienes de uso") y `bienes.gestionar` ("Gestionar bienes de uso"); en la demo los tienen Administrador y Contador.
- **Maestros → Rubros de bienes de uso** (`bienes.gestionar`).
- **Registraciones → Contabilidad General → Bienes de uso** (`bienes.ver`; alta, edición y baja con `bienes.gestionar`): lista, ficha con historial, alta manual o carga inicial, baja.
- **Registraciones → Contabilidad General → Amortización del mes** (`contabilidad.cerrar`): mes, vista previa por rubro y por bien, Generar, historial con Anular.
- **Consultas → Contabilidad General → Planilla de bienes de uso** (`bienes.ver`): ejercicio, fecha, "En moneda de hoy", control con el Mayor, Excel y PDF.
- **Factura de proveedor:** si la cuenta del renglón es de un rubro, aparecen descripción del bien, vida útil (precargada del rubro) y residual.
- **Comprobante de venta:** en el renglón, opción "Bien de uso" con selector de bienes activos (precio libre, cantidad 1).

## 9. Pruebas

**Ejemplo que fija el cálculo:** rodado de 1.200.000,00, alta 15/03/2026 por factura, 60 meses, sin residual → 20.000,00 por mes; amortización generada a septiembre 2026: acumulada 140.000,00 (marzo a septiembre, 7 meses). Venta el 15/10/2026 por 1.100.000,00 neto: baja con acumulada 140.000,00 (octubre no se amortiza), residual 1.060.000,00, cuenta 4.2.05 con saldo acreedor 40.000,00.

- **Cálculo puro:** cuota y redondeo del último mes (bien de 1.000,00 a 3 meses: 333,33 / 333,33 / 333,34); bien cargado tarde que recupera meses; carga inicial; vida útil cumplida (no amortiza más); mes de baja.
- **API:** factura con renglón de rubro sin bien rechazada; alta desde factura; anular factura con y sin amortizaciones; alta manual y carga inicial; previa, generar, re-generar con un bien tardío, anular la última, no generar un mes anterior; baja manual y anulación; venta por comprobante (validaciones antes de ARCA, baja al autorizar, resultado 40.000,00, excluida de informes de ventas); cierre bloqueado sin la amortización del mes de cierre; ajuste por inflación con fecha de origen (amortización de un bien dado de alta en un mes anterior se reexpresa desde ese mes); planilla nominal que coincide con el Mayor y reexpresada; permisos; exportaciones.
- **Web:** campos del bien en la factura cuando la cuenta es de rubro; tabla de la planilla con totales; vista previa de amortización.
- **E2E:** el contador registra una factura con un rodado, genera la amortización del mes y ve el bien en la planilla con "Coincide con el Mayor".
