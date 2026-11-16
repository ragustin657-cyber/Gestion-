# Entrega 20: Liquidación final

## 1. Objetivo y alcance

**Problema hoy:** cuando un empleado se va, el sistema solo le paga los días del mes en la liquidación mensual. El SAC proporcional, las vacaciones no gozadas y, en un despido, la indemnización, el preaviso y la integración se siguen calculando afuera. Además, la liquidación final se paga dentro de los 4 días hábiles, no a fin de mes.

**Qué agrega esta entrega:** una liquidación de tipo **Final** por cada egreso. Se calcula con la causa, se cierra con su asiento, se paga desde Tesorería y aporta su parte remunerativa al F.931 del mes.

**Criterio de éxito.** Con la demo:
- doy de baja a un empleado por despido sin causa el 15/11, sin preaviso;
- veo la liquidación final: días, SAC proporcional, vacaciones no gozadas con su SAC, indemnización por antigüedad, preaviso con su SAC e integración con su SAC;
- la cierro (asiento con la cuenta Indemnizaciones), la pago y descargo el recibo "Liquidación final";
- la liquidación mensual de noviembre ya no lo incluye.

**Decisiones tomadas con el usuario:**
- **Causas:** renuncia, despido sin causa, despido con causa y mutuo acuerdo (art. 241, con gratificación opcional).
- **Diseño:** un tercer tipo de liquidación, `FINAL`, una por egreso y por empleado. Reutiliza novedades, recibo, cierre, asiento, pagos y F.931 de las Entregas 18 y 19.
- **Tratamiento:**
  - días trabajados y SAC proporcional son remunerativos;
  - indemnización, preaviso, integración, vacaciones no gozadas, sus SAC y la gratificación son no remunerativos, no llevan aportes ni contribuciones y no van al F.931.

**No objetivos:**
- certificado de trabajo (art. 80);
- multas e indemnizaciones agravadas (falta de registro, art. 80, embarazo, etc.);
- descuento por falta de preaviso del empleado;
- fallecimiento (art. 248);
- jubilación;
- fin del período de prueba (se carga como renuncia o mutuo acuerdo);
- vacaciones gozadas de antes.

**Anti-objetivos:**
- que un empleado cobre dos veces el mismo mes (mensual y final);
- aportes sobre conceptos indemnizatorios;
- una indemnización sin tope cuando el convenio tiene uno cargado.

## 2. Modelo

**Tipo de liquidación:** `TipoLiquidacion` suma `FINAL`.
- La unicidad `(empresaId, tipo, anio, mes)` pasa a valer solo para `MENSUAL` y `SAC`: índice único parcial.
- Las finales son una por empleado y egreso.

**`EgresoEmpleado`:**
- Campos: `{ id, empresaId, liquidacionId (único, cascade), empleadoId, causa: RENUNCIA | DESPIDO_SIN_CAUSA | DESPIDO_CON_CAUSA | MUTUO_ACUERDO, fechaEgreso, preavisoOtorgado Boolean, mejorRemuneracion Decimal? (corrección manual), gratificacion Decimal default 0, creadoPor, creadoEn }`.
- Va en `MODELOS_DE_EMPRESA`.

**`TopeIndemnizatorio`:**
- Campos: `{ id, empresaId, convenioId, desdeAnio, desdeMes, importe }`.
- Único `(convenioId, desdeAnio, desdeMes)`; rige la vigencia más reciente que sea ≤ al mes del egreso.
- Va en `MODELOS_DE_EMPRESA`.
- Sin tope cargado, no hay tope y la liquidación avisa `No hay tope indemnizatorio cargado para <convenio>`.

**Cuenta nueva** `5.2.11 Indemnizaciones` en el plan modelo:
- La migración la agrega en las empresas existentes si el código está libre.
- `ConfiguracionSueldos.cuentaIndemnizacionesId` es opcional: si falta, los conceptos indemnizatorios van a Sueldos y jornales.

## 3. Alta: dar de baja

`POST /api/sueldos/egresos { empleadoId, causa, fechaEgreso, preavisoOtorgado, mejorRemuneracion?, gratificacion?, fechaPago }` (`sueldos.liquidar`).

**Validaciones** (400):
- empleado activo sin otra final vigente: `El empleado ya tiene una liquidación final`;
- `fechaEgreso ≥ fechaIngreso`;
- el mes del egreso no tiene una mensual cerrada que ya incluya al empleado: `La liquidación mensual de MM/AAAA ya incluye al empleado: reábrala antes de darlo de baja`;
- `gratificacion` solo en `MUTUO_ACUERDO`.

**Efectos:**
- graba `fechaEgreso` en el empleado;
- crea la `Liquidacion` `FINAL` (`anio` y `mes` del egreso, numerada con `LIQUIDACION_SUELDO`) con su `EgresoEmpleado`, y la calcula;
- responde `{ id, numero }`.

**Modificar el egreso:** `PUT /api/sueldos/egresos/:liquidacionId` cambia causa, preaviso, mejor remuneración, gratificación o fecha (solo en borrador) y recalcula.

**Eliminar:** eliminar una final en borrador borra el egreso y vuelve a dejar el empleado sin `fechaEgreso`, activo.

**Liquidación mensual:**
- excluye a quien tiene una liquidación final (en cualquier estado) con egreso en ese mes;
- excluye, desde el mes siguiente al egreso, a todo empleado con `fechaEgreso` anterior al período (como hoy).

**SAC:** excluye a quien tiene una final en el semestre.

## 4. Cálculo

Es la función pura `liquidarFinal(e, conceptos, novedades, d)` en `calculo.ts`.

**Datos que recibe** (`d`):
- `causa`;
- `fechaEgreso`;
- `preavisoOtorgado`;
- `mejorRemuneracion` (ya resuelta, ver abajo);
- `mejorRemuneracionSemestre`;
- `topeIndemnizatorio: Dec | null`;
- `baseMaxima`;
- `gratificacion`.

**Mejor remuneración** (la resuelve el servicio):
- Es la corrección manual, si existe.
- Si no, el máximo entre:
  - el `totalRemunerativo` de los recibos mensuales cerrados del empleado en los 12 meses anteriores al egreso (sin SAC);
  - la remuneración del mes completo del egreso: `liquidarMes` con el mismo empleado sin `fechaEgreso` y sin novedades de ausencia, tomando el remunerativo.
- **Mejor remuneración del semestre:** igual, pero con los recibos mensuales cerrados del semestre del egreso.

**Renglones remunerativos:**

| Código | Concepto | Regla |
|---|---|---|
| (los de la Entrega 18) | días trabajados del mes | `liquidarMes` con `fechaEgreso`, conceptos del convenio y novedades |
| 200 | SAC proporcional | `mejorRemuneracionSemestre / 2 × díasDelSemestreHastaElEgreso / díasDelSemestre` |

**Renglones no remunerativos** (`conceptoId` nulo, como el 200):

| Código | Concepto | Causa | Regla |
|---|---|---|---|
| 300 | Indemnización por antigüedad (art. 245) | despido sin causa | `base × años`. **Años:** completos al egreso, más uno si la fracción supera 3 meses; mínimo 1. **Base:** `mejorRemuneracion`, con estos ajustes: si hay tope y la supera, la base es el tope; si el tope es menor que el 67 % de la mejor remuneración, la base es ese 67 % (doctrina Vizzoti). |
| 310 | Preaviso (art. 232) | despido sin causa sin preaviso | Antigüedad ≤ 3 meses: `mejor / 2`. Hasta 5 años: `mejor`. Más de 5 años: `2 × mejor`. |
| 311 | SAC sobre preaviso | igual que 310 | `310 / 12` |
| 320 | Integración del mes de despido (art. 233) | despido sin causa sin preaviso, con egreso que no es el último día del mes | `mejor / 30 × díasRestantes`, donde `díasRestantes` va del día siguiente al egreso hasta el último día del mes, con 30 como máximo. |
| 321 | SAC sobre integración | igual que 320 | `320 / 12` |
| 330 | Vacaciones no gozadas (art. 156) | todas | `mejor / 25 × díasVacaciones × díasTrabajadosEnElAño / 365`. **Días de vacaciones:** según los años de antigüedad al egreso: < 5 → 14; < 10 → 21; < 20 → 28; ≥ 20 → 35. **Días trabajados en el año:** desde el 1/1 (o el ingreso, si es posterior) hasta el egreso. |
| 331 | SAC sobre vacaciones | todas | `330 / 12` |
| 340 | Gratificación por cese | mutuo acuerdo | el importe cargado |

**Redondeo:** cada importe se redondea a 2 decimales, half-up.

**Descuentos:** los de ley (y FIJO de descuento) se calculan como en la Entrega 18, sobre el remunerativo de los días más el SAC y sobre el no remunerativo **solo de los días** (los 300 a 340 nunca entran en la base). El tope de base máxima es el del mes; el SAC lleva su mitad. Para simplificar, se aplica `baseMaxima × 1,5` a la suma.

**Totales:**
- remunerativo = días + SAC;
- no remunerativo = no remunerativos de los días + 300 a 340;
- neto = remunerativo + no remunerativo − descuentos.

### Ejemplo

Vendedor B, básico 1.000.000,00, ingreso 01/03/2021, afiliado. Despido sin causa el 15/11/2026, sin preaviso, sin novedades y sin recibos cerrados.
- Mejor remuneración = mes completo de noviembre: 1.137.465,00.
- Antigüedad al egreso: 5 años, 8 meses y 14 días, o sea 6 años indemnizables y 21 días de vacaciones.
- Sin tope cargado.

| Renglón | Importe |
|---|---|
| Días (15): 100 básico 500.000,00 + 110 antigüedad 25.000,00 + 120 presentismo 43.732,50 | 568.732,50 |
| 200 SAC proporcional (138 de 184 días) | 426.549,38 |
| **Remunerativo** | **995.281,88** |
| 300 Indemnización (6 × 1.137.465,00) | 6.824.790,00 |
| 310 Preaviso (2 meses) | 2.274.930,00 |
| 311 SAC sobre preaviso | 189.577,50 |
| 320 Integración (15 días) | 568.732,50 |
| 321 SAC sobre integración | 47.394,38 |
| 330 Vacaciones no gozadas (21 × 319/365 días) | 835.055,13 |
| 331 SAC sobre vacaciones | 69.587,93 |
| **No remunerativo** | **10.810.067,44** |
| 500 Jubilación 109.481,01 · 510 Ley 19.032 29.858,46 · 520 Obra social 29.858,46 · 530 FAECYS 4.976,41 · 540 Sindicato 19.905,64 | **194.079,98** |
| **Neto** | **11.611.269,34** |

**Con tope:**
- Con tope 900.000,00, la base de la indemnización es 900.000,00, porque es mayor que el 67 % de 1.137.465,00 (762.101,55). El renglón 300 da 5.400.000,00.
- Con tope 500.000,00, la base es 762.101,55 y el renglón 300 da 4.572.609,30.

**Otras causas:** con renuncia en la misma fecha no hay 300, 310, 311, 320 ni 321, y el neto es 995.281,88 + 904.643,06 − 194.079,98 = 1.705.844,96.

## 5. Cierre, contabilidad, pagos y F.931

**Cierre:** como las demás liquidaciones: numera el recibo, calcula las contribuciones (solo sobre el remunerativo; detracción proporcional a los días del mes) y genera el asiento.
- **Fecha del asiento:** la fecha de egreso.
- **Descripción:** `Liquidación final - <apellido, nombre> - <causa>`.
- **Debe Indemnizaciones** (o Sueldos y jornales si no está configurada): los renglones 300 a 340.
- **Resto del asiento:** igual que en la Entrega 19.

**Reabrir y eliminar:** igual que una mensual.

**Pagos:** iguales, desde la liquidación final.

**F.931:**
- incluye las finales cerradas del mes, sumadas a la mensual del empleado si existiera;
- el SAC de la final va al campo 37;
- los renglones 300 a 340 no se informan;
- un mes con solo finales cerradas genera el archivo, y el error `La liquidación mensual … no está cerrada` sigue valiendo solo cuando hay un SAC cerrado.

**Recibo PDF:**
- título `LIQUIDACIÓN FINAL`, con la causa y la fecha de egreso;
- período `Final MM/AAAA`.

**Resumen:** como el de las demás liquidaciones.

## 6. Web

- **Ficha del empleado:** botón "Dar de baja". Abre un diálogo con:
  - causa;
  - fecha de egreso;
  - preaviso otorgado (solo despido sin causa);
  - gratificación (solo mutuo acuerdo);
  - fecha de pago (por defecto, egreso + 4 días);
  - mejor remuneración opcional.

  Al confirmar, abre la liquidación final.
- **Liquidaciones:** el tipo "Final" con el nombre del empleado en el período (`Final 11/2026 - Pérez, Juan`). En la liquidación final, una tarjeta con los datos del egreso (editable en borrador) y el recibo con los renglones indemnizatorios.
- **Convenios y escalas:** tope indemnizatorio por vigencia.
- **Contribuciones:** cuenta Indemnizaciones en la configuración de cuentas.

## 7. Pruebas

- **Cálculo puro:**
  - el ejemplo completo;
  - tope 900.000 y tope 500.000 (Vizzoti);
  - renuncia;
  - despido con causa (= renuncia);
  - mutuo acuerdo con gratificación 1.000.000 (renglón 340, no remunerativo, sin descuentos);
  - despido con preaviso otorgado (sin 310, 311, 320 ni 321);
  - egreso el último día del mes (sin 320);
  - antigüedad de 2 meses: preaviso de medio mes, indemnización de 1 año mínimo, vacaciones de 14 días proporcionales;
  - fracción de exactamente 3 meses (no suma año) y de 3 meses y 1 día (suma).
- **API:**
  - dar de baja crea la final y el empleado queda con egreso;
  - la mensual del mes no lo incluye;
  - no se da de baja dos veces;
  - mensual cerrada que lo incluye → 400;
  - eliminar la final restituye al empleado;
  - modificar el egreso recalcula;
  - mejor remuneración desde un recibo mensual cerrado mayor que el mes completo;
  - cierre con asiento (300 a 340 en Indemnizaciones, contribuciones solo sobre 995.281,88);
  - pago;
  - F.931 del mes con la final (campo 13 = 995.281,88, campo 37 = SAC);
  - recibo PDF con `LIQUIDACIÓN FINAL`;
  - permisos;
  - migración con la cuenta nueva.
- **Web:** diálogo de baja (campos según la causa); tarjeta del egreso.
- **E2E:** el contador da de baja a un empleado por despido sin causa, ve la indemnización, cierra y paga.

## 8. Lo que queda al builder

- **Pantallas:** su distribución dentro del estilo existente.
- **Errores:** textos de errores secundarios.
- **Recibo:** cómo se muestran los renglones indemnizatorios en el recibo (en la columna No remunerativo).
