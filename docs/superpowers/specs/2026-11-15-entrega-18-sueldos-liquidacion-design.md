# Entrega 18 — Sueldos y jornales, parte 1: legajos, liquidación y recibos

## 1. Intención

Las empresas que usan el sistema liquidan hoy los sueldos afuera. Esta entrega les permite cargar sus empleados, liquidar el mes y el aguinaldo con los conceptos de su convenio y emitir los recibos legales, sin planillas. La parte 2 (otra entrega) agrega el asiento contable, el pago, las contribuciones patronales y el F.931.

El usuario delegó las decisiones: empleados mensualizados, conceptos configurables por tipo de cálculo y el convenio de Comercio (CCT 130/75) precargado como ejemplo. Aprobó el diseño presentado sin cambios.

**Criterio de éxito.** Con la demo: doy de alta tres empleados de Comercio, cargo la escala del mes, cargo horas extra y una ausencia, liquido noviembre, reviso los importes, cierro la liquidación y descargo los recibos en PDF; en diciembre liquido el aguinaldo.

**Objetivos:** legajos; convenios, categorías y escalas por mes; conceptos configurables; novedades del mes; liquidación mensual y SAC con borrador recalculable y cierre; recibos art. 140 LCT; resumen exportable.

**No objetivos (fuera de alcance):** asiento contable, pago, contribuciones patronales y F.931 (parte 2); ganancias de cuarta categoría; vacaciones; liquidación final e indemnizaciones; embargos; asignaciones familiares; jornalizados y quincenales.

**Anti-objetivos:** un sueldo mal calculado sin que se note (por eso no hay fórmulas libres); importes de escala inventados (no se precargan básicos).

## 2. Enfoques

1. **Conceptos por tipo de cálculo (elegido).** Cada concepto pertenece a un tipo cerrado con parámetros editables. Configurable sin escribir fórmulas; fácil de probar y de explicar en el recibo. Un caso no cubierto se resuelve agregando un tipo.
2. Fórmulas libres: más flexible, pero exige un intérprete seguro y una fórmula mal escrita liquida mal en silencio.
3. Conceptos fijos en código: más rápido, pero cada convenio nuevo exige programar.

## 3. Modelo

Módulo `apps/api/src/sueldos/`. Todos los modelos de empresa en `MODELOS_DE_EMPRESA`.

- **Convenio** `{ id, nombre, codigo, horasMensuales (default 200), activo }` — precargado `Comercio (CCT 130/75)`.
- **Categoria** `{ id, convenioId, nombre, orden, activa }` — precargadas para Comercio: Maestranza A, B, C; Administrativo A, B, C, D, E, F; Cajero A, B, C; Auxiliar A, B, C; Auxiliar especializado A, B; Vendedor A, B, C, D.
- **Escala** `{ id, categoriaId, anio, mes, basico Decimal(18,2) }` único por `(categoriaId, anio, mes)`. El básico de un mes es el de la escala vigente más reciente con `(anio, mes) ≤` el mes liquidado; sin escala → la liquidación de ese empleado da error `Falta la escala de <categoría> para MM/AAAA`. Carga a mano y por Excel/CSV (`Categoría;MM/AAAA;Básico`).
- **Empleado** `{ id, legajo (correlativo, único por empresa), apellido, nombre, cuil (validado con el dígito verificador de CUIT/CUIL), domicilio, fechaIngreso, fechaEgreso?, categoriaId, centroCostoId?, sucursalId?, afiliadoSindicato Boolean, obraSocial (texto), formaPago: EFECTIVO | TRANSFERENCIA, cbu?, activo }`. Antigüedad = años completos entre `fechaIngreso` y el último día del período.
- **Concepto** `{ id, convenioId? (null = todos), codigo, nombre, clase: REMUNERATIVO | NO_REMUNERATIVO | DESCUENTO, tipo, parametros JSON, orden, soloAfiliados Boolean, activo }` — ver §4.
- **Novedad** `{ id, liquidacionId, empleadoId, conceptoId?, tipo: HORAS_EXTRA_50 | HORAS_EXTRA_100 | AUSENCIA_INJUSTIFICADA | IMPORTE, cantidad Decimal?, importe Decimal?, detalle? }`.
- **Liquidacion** `{ id, numero, tipo: MENSUAL | SAC, anio, mes (SAC: 6 o 12), fechaPago, estado: BORRADOR | CERRADA, ultimoDepositoFecha?, ultimoDepositoBanco?, ultimoDepositoPeriodo?, creadoPor, cerradoPor?, cerradoEn? }` única por `(tipo, anio, mes)`.
- **ReciboSueldo** (el nombre `Recibo` ya es el de cobranzas) `{ id, liquidacionId, empleadoId, numero (al cerrar), datos del empleado al momento (snapshot: apellido, nombre, cuil, categoría, básico, fechaIngreso, antigüedad), totalRemunerativo, totalNoRemunerativo, totalDescuentos, neto }` y **ReciboSueldoRenglon** `{ reciboId, conceptoId, codigo, nombre, clase, cantidad?, base?, porcentaje?, importe, orden }`.

## 4. Tipos de concepto

Todos los importes se redondean a 2 decimales por renglón.

| Tipo | Parámetros | Cálculo |
|---|---|---|
| `BASICO` | — | Básico de la escala × días trabajados / 30 (mes completo = 30). |
| `ANTIGUEDAD` | `pctPorAnio` | Básico proporcional × `pctPorAnio` % × años de antigüedad. |
| `PORCENTAJE` | `pct`, `base`: `BASICO_MAS_ANTIGUEDAD` \| `REMUNERATIVO` \| `BRUTO`, `pierdeConAusencia` Boolean | `pct` % de la base; con `pierdeConAusencia` y alguna ausencia injustificada en el mes → 0. |
| `HORAS_EXTRA` | `recargoPct` (50 o 100) | Cantidad de horas de la novedad × valor hora × (1 + recargo/100); valor hora = (básico + antigüedad) / `horasMensuales` del convenio. |
| `AUSENCIA` | — | Descuento remunerativo negativo: −(básico + antigüedad) / 30 × días de ausencia de la novedad. |
| `FIJO` | `importe` | Importe fijo (o el de la novedad `IMPORTE` del concepto si existe). |
| `DESCUENTO_LEY` | `pct`, `base`: `REMUNERATIVO` \| `REMUNERATIVO_MAS_NO_REMUNERATIVO`, `tope`? | `pct` % de la base (con tope de base opcional, importe fijo editable en el concepto). |

**Orden de cálculo:** remunerativos en `orden` (BASICO, ANTIGUEDAD, HORAS_EXTRA, AUSENCIA, PORCENTAJE, FIJO remunerativos) → total remunerativo → no remunerativos → descuentos (base = total remunerativo) → neto = remunerativo + no remunerativo − descuentos. `soloAfiliados` aplica el concepto solo a empleados afiliados. Un concepto con importe 0 no genera renglón.

**Conceptos precargados (Comercio, editables):** `100 Sueldo básico` (BASICO), `110 Antigüedad` (ANTIGUEDAD 1 %), `120 Presentismo` (PORCENTAJE 8,33 % sobre básico + antigüedad, pierde con ausencia), `130 Horas extra 50 %` y `131 Horas extra 100 %` (HORAS_EXTRA), `140 Ausencias injustificadas` (AUSENCIA), `500 Jubilación` (DESCUENTO_LEY 11 %, base remunerativo), `510 Ley 19.032` (3 %, base remunerativo), `520 Obra social` (3 %), `530 FAECYS` (0,5 %), `540 Sindicato` (2 %, solo afiliados) — estos tres con base remunerativo + no remunerativo, como se aplica a las sumas no remunerativas de los acuerdos de Comercio.

## 5. Liquidación

- **Mensual:** empleados activos con ingreso ≤ último día del mes y sin egreso antes del primer día. Días trabajados = días calendario del mes en que estuvo empleado, con mes completo = 30 (ingreso el 16 de un mes de 30 días → 15 días; egreso el 10 → 10 días).
- **SAC (junio y diciembre):** por empleado, 50 % de la mayor remuneración (total remunerativo de las liquidaciones mensuales **cerradas**) del semestre, × días trabajados en el semestre / días del semestre. Genera renglón `200 SAC` (remunerativo) y los descuentos de ley sobre él. Sin liquidaciones mensuales cerradas en el semestre → `No hay liquidaciones mensuales cerradas en el semestre`.
- **Borrador:** al crear la liquidación se calculan todos los recibos; cada cambio de novedades o un "Recalcular" rehace los recibos del borrador. Permite agregar o quitar empleados.
- **Cerrar:** numera los recibos (correlativo por empresa), fija los datos y la deja de solo lectura. **Reabrir** vuelve a borrador (hasta que la parte 2 registre asiento o pago).
- **Errores por empleado** (falta de escala, categoría inactiva) se informan en la liquidación (`errores: [{ empleadoId, mensaje }]`) y bloquean el cierre.

## 6. API

Permisos `sueldos.ver` ("Ver sueldos") y `sueldos.liquidar` ("Liquidar sueldos"); en la demo, Administrador y Contador.

- Maestros: `GET/POST/PUT /api/sueldos/convenios`, `…/categorias`, `GET/PUT /api/sueldos/escalas?convenioId&anio&mes`, `POST /api/sueldos/escalas/importar`, `GET/POST/PUT /api/sueldos/conceptos`, `GET/POST/PUT /api/sueldos/empleados`.
- Liquidaciones: `GET/POST /api/sueldos/liquidaciones { tipo, anio, mes, fechaPago }`, `GET /api/sueldos/liquidaciones/:id` (recibos con renglones, errores, totales), `PUT …/:id/novedades { empleadoId, novedades[] }`, `POST …/:id/recalcular`, `POST …/:id/cerrar`, `POST …/:id/reabrir`, `PUT …/:id/deposito { fecha, banco, periodo }`, `DELETE …/:id` (solo borrador).
- Salidas: `GET …/:id/recibos.pdf?empleadoId` (uno o todos), `GET …/:id/resumen?formato=xlsx|pdf` (por concepto y por empleado).

## 7. Recibo (art. 140 LCT)

Una hoja por empleado, original y duplicado en la misma hoja: empleador (razón social, CUIT, domicilio); empleado (legajo, apellido y nombre, CUIL, categoría, fecha de ingreso, antigüedad, básico); período liquidado y tipo; tabla de conceptos con columnas Cantidad/Base, Remunerativo, No remunerativo, Descuentos; totales; neto en números y en letras; fecha y banco del último depósito de aportes; lugar y fecha de pago; forma de pago; espacio "Firma del empleado". Borrador: marca de agua "BORRADOR".

## 8. Web

Menú **Sueldos** (`sueldos.ver`): Empleados (lista, alta, edición), Convenios y escalas (categorías, escala por mes, importar), Conceptos, Liquidaciones (lista y nueva; detalle con tabla de empleados y netos, panel de novedades por empleado, errores, Recalcular, Cerrar/Reabrir, recibos PDF, resumen Excel/PDF, datos del último depósito).

## 9. Ejemplo que fija el cálculo

Escala noviembre 2026: Vendedor B = 1.000.000,00. Empleado afiliado, ingreso 01/03/2021 (5 años al 30/11/2026), mes completo, 4 horas extra al 50 %, sin ausencias:

| Concepto | Importe |
|---|---|
| Básico | 1.000.000,00 |
| Antigüedad 1 % × 5 | 50.000,00 |
| Presentismo 8,33 % × 1.050.000 | 87.465,00 |
| Horas extra 50 %: 4 × (1.050.000 / 200) × 1,5 | 31.500,00 |
| **Total remunerativo** | **1.168.965,00** |
| Jubilación 11 % | 128.586,15 |
| Ley 19.032 3 % | 35.068,95 |
| Obra social 3 % | 35.068,95 |
| FAECYS 0,5 % | 5.844,83 |
| Sindicato 2 % | 23.379,30 |
| **Descuentos** | **227.948,18** |
| **Neto** | **941.016,82** |

Con 1 día de ausencia injustificada: ausencia −35.000,00 (1.050.000 / 30), presentismo 0, horas extra 31.500,00 → remunerativo 1.046.500,00.

SAC diciembre: mejor remunerativo del semestre 1.168.965,00 → SAC 584.482,50 (semestre completo); ingreso 01/10 → × 92/184 = 292.241,25.

## 10. Pruebas

Cálculo puro de cada tipo con los valores del ejemplo; proporcional por ingreso/egreso; antigüedad en el aniversario; afiliado/no afiliado; liquidación mensual del ejemplo vía API; recalcular tras novedades; errores por falta de escala que bloquean el cierre; cerrar numera y fija; reabrir; SAC completo y proporcional; recibo PDF con neto en letras; resumen; permisos; CUIL inválido; e2e: el contador crea un empleado, carga la escala, liquida, cierra y descarga recibos.

## 11. Decisiones de construcción (tomadas por el implementador, revisables)

Surgieron de la revisión del documento; el usuario delegó estas decisiones.

1. **Mes incompleto (ingreso o egreso en el mes):** el básico se proratea (× días / 30); la antigüedad se calcula sobre el básico proporcional; la base `BASICO_MAS_ANTIGUEDAD` del presentismo es básico proporcional + antigüedad. El **valor hora** de las horas extra y el **descuento por ausencia** usan el básico y la antigüedad del mes completo (el valor de una hora o un día no cambia por haber ingresado a mitad de mes).
2. **Bases de `PORCENTAJE`:** `REMUNERATIVO` = suma de los remunerativos de menor `orden` (acumulado hasta ese punto, sin circularidad); `BRUTO` = remunerativos + no remunerativos calculados hasta ese punto; `BASICO_MAS_ANTIGUEDAD` = antes de descontar ausencias.
3. **Descuentos de ley:** base configurable (`REMUNERATIVO` o `REMUNERATIVO_MAS_NO_REMUNERATIVO`); el tope es un importe fijo editable en el concepto (su actualización mensual queda para la parte 2 junto con las contribuciones).
4. **SAC:**
   - Entran los empleados activos al último día del semestre con algún día trabajado en él; quien egresó en el semestre cobra su SAC en la liquidación final (fuera de alcance).
   - Usa las liquidaciones mensuales **cerradas** del semestre; si la del mes del SAC (junio o diciembre) no está cerrada, la respuesta trae `aviso: 'La liquidación mensual de MM/AAAA no está cerrada: no se considera en la mejor remuneración'` y se puede seguir.
   - Una liquidación mensual usada por un SAC cerrado no se puede reabrir: `La liquidación se usó en el SAC de MM/AAAA: reábralo primero`.
   - Los días del semestre son días calendario desde el ingreso (las ausencias no se descuentan).
5. **Numeración de recibos:** el número se asigna en el primer cierre y queda en el recibo; reabrir y volver a cerrar lo conserva; un empleado agregado después recibe el siguiente número; un recibo de un empleado quitado de una liquidación reabierta se elimina y su número queda sin usar.
