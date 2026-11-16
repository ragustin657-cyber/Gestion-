# Entrega 21: Vacaciones

## 1. Objetivo y alcance

**Problema hoy:** la liquidación mensual no sabe cuándo un empleado se toma vacaciones, así que el plus vacacional se paga afuera. Nadie lleva cuántos días le corresponden ni cuántos se tomó cada empleado. La liquidación final proporciona todo el año aunque el empleado ya haya gozado parte.

**Qué agrega esta entrega:** un registro de períodos de vacaciones por empleado, del que salen:
- el saldo de cada año (corresponden, tomados y pendientes);
- el pago en la mensual del mes en que empiezan;
- las vacaciones no gozadas reales de la liquidación final.

**Criterio de éxito.** Con la demo:
- registro que un Vendedor B se toma 14 días desde el 09/11/2026 por las vacaciones 2026;
- veo su saldo (le corresponden 21, tomó 14, quedan 7);
- la mensual de noviembre muestra los renglones 150 Vacaciones y 151 Descuento días de vacaciones;
- si después lo doy de baja, las no gozadas descuentan esos 14 días.

**Decisiones tomadas con el usuario:**
- **Alcance:** liquidar las vacaciones y llevar el saldo por empleado y año. No incluye solicitudes ni aprobación por parte de los empleados.
- **Diseño:** registro de períodos independiente de la liquidación; la mensual los toma solos según la fecha de inicio.
- **Liquidación:** se descuentan los días (básico + antigüedad) ÷ 30 y se pagan (básico + antigüedad) ÷ 25. Un período que cruza de mes se liquida entero en el mes de inicio.

**No objetivos:**
- vacaciones fraccionadas o adicionales por convenio;
- licencias especiales;
- solicitudes y aprobación;
- calendario de feriados (los días son corridos);
- cálculo por días hábiles.

**Anti-objetivos:**
- pagar dos veces un período;
- editar un período ya pagado en una mensual cerrada;
- que la liquidación final pague días de vacaciones ya gozados.

## 2. Modelo

**`VacacionPeriodo`:**
- Campos: `{ id, empresaId, empleadoId, anio (al que corresponden), desde, hasta, dias (corridos: hasta − desde + 1), observaciones?, creadoPor, creadoEn }`.
- **Validaciones** (400):
  - `hasta ≥ desde`;
  - `desde ≥ ingreso`;
  - sin superposición con otro período del empleado: `El período se superpone con otro del empleado (dd/mm/aaaa al dd/mm/aaaa)`;
  - `anio` entre el año de ingreso y el año de `desde`.
- **Avisos** (se graba igual, y la respuesta trae `avisos`):
  - `Supera el saldo de AAAA (quedan N días)`;
  - `Comienza fuera del período legal (1/10 al 30/4)`.

**`VacacionSaldoInicial`:**
- Campos: `{ id, empresaId, empleadoId, anio, dias }`.
- Único `(empleadoId, anio)`.
- Reemplaza lo que "corresponden" calcula para ese año: es lo que el empleado traía pendiente antes del sistema, o un ajuste.

**Configuración:** `ConfiguracionSueldos.anioInicioVacaciones Int`. La migración pone 2026 y cada empresa nueva, su año de alta. Los años anteriores cuentan solo con saldo inicial; sin él, se consideran sin días pendientes.

Los dos modelos van en `MODELOS_DE_EMPRESA`.

## 3. Saldo

Función pura `diasVacacionesCorresponden(ingreso: Date, egreso: Date | null, anio: number): number`:
- **Años de antigüedad al 31/12 del año** (`antiguedadAnios` de la Entrega 18): < 5 → 14; < 10 → 21; < 20 → 28; ≥ 20 → 35.
- **Medio año:** si los días corridos trabajados en el año (del 1/1 o el ingreso al 31/12 o el egreso) son menos de 183, corresponde `floor(díasTrabajados / 20)`.
- Sin días trabajados en el año, 0.

**Saldo de un empleado en un año:**
- `corresponden`:
  - el saldo inicial, si existe;
  - si no, para años desde `anioInicioVacaciones`, la función anterior;
  - si no, 0.
- `tomados` = suma de `dias` de sus períodos con ese `anio`.
- `pendientes` = `corresponden − tomados` (puede ser negativo: se muestra en rojo).

**Endpoints:**
- `GET /api/sueldos/vacaciones?anio` (`sueldos.ver`) → por empleado activo, o con egreso en ese año o después: `{ empleadoId, legajo, nombre, corresponden, saldoInicial (null o días), tomados, pendientes, periodos: [{ id, desde, hasta, dias, liquidado: boolean }] }`.
- `GET /api/sueldos/empleados/:id/vacaciones` → sus saldos por año y sus períodos.

## 4. Períodos

**Endpoints** (`sueldos.liquidar`):
- `POST /api/sueldos/vacaciones { empleadoId, anio, desde, hasta, observaciones? }` → `{ id, avisos }`;
- `PUT /api/sueldos/vacaciones/:id` (mismos campos);
- `DELETE /api/sueldos/vacaciones/:id`;
- `PUT /api/sueldos/vacaciones/saldo-inicial { empleadoId, anio, dias | null }` (null lo borra).

**Período liquidado:** un período está liquidado si existe un recibo de una mensual **cerrada** del mes de su `desde` con su renglón 150 (se identifica por `ReciboSueldoRenglon.vacacionPeriodoId`, campo nuevo opcional).
- Un período liquidado no se puede modificar ni eliminar: `El período ya se pagó en la liquidación mensual de MM/AAAA: reábrala para modificarlo`.
- Reabrir la mensual lo vuelve editable.

**Mensual en borrador:** al crear, modificar o borrar un período cuyo mes de inicio tiene una mensual en borrador, esa liquidación se recalcula.

## 5. Liquidación mensual

`liquidarMes` recibe `vacaciones: { periodoId: string; dias: number }[]` (los períodos del empleado con `desde` en el mes).

Por cada período, con el básico y la antigüedad del mes completo:
- **150 Vacaciones**, remunerativo: `(básico + antigüedad) ÷ 25 × días`, cantidad = días.
- **151 Descuento días de vacaciones**, remunerativo negativo: `−(básico + antigüedad) ÷ 30 × días`, cantidad = días.
- El básico (100), la antigüedad (110) y el presentismo (120) no cambian: las vacaciones no son ausencias.
- Los descuentos de ley se calculan sobre el remunerativo resultante.

**Conceptos nuevos:** los renglones 150 y 151 tienen tipo nuevo `VACACIONES`, con conceptos precargados en Comercio:
- `150 Vacaciones`, con parámetros `{ divisor: 25 }`;
- `151 Descuento días de vacaciones`, con parámetros `{ divisor: 30 }`.

La migración los agrega a las empresas existentes. Si están inactivos, no se liquidan vacaciones.

**Combinaciones:**
- **Período que cruza de mes:** todos sus días se liquidan en el mes de inicio.
- **Empleado que ingresó en el mes:** se liquida igual, con los valores del mes completo.
- **Vacaciones dentro de una liquidación final** (empiezan en el mes del egreso): se liquidan igual en la final (renglones 150 y 151) y cuentan como tomadas.

### Ejemplo

Vendedor B, básico 1.000.000,00, ingreso 01/03/2021 (5 años en 11/2026), afiliado. Vacaciones 2026: 14 días desde el 09/11/2026. Sin otras novedades.

| Renglón | Importe |
|---|---|
| 100 Sueldo básico | 1.000.000,00 |
| 110 Antigüedad | 50.000,00 |
| 120 Presentismo | 87.465,00 |
| 150 Vacaciones (1.050.000 ÷ 25 × 14) | 588.000,00 |
| 151 Descuento días de vacaciones (1.050.000 ÷ 30 × 14) | −490.000,00 |
| **Remunerativo** | **1.235.465,00** |
| 500 Jubilación 135.901,15 · 510 Ley 19.032 37.063,95 · 520 Obra social 37.063,95 · 530 FAECYS 6.177,33 · 540 Sindicato 24.709,30 | **240.915,68** |
| **Neto** | **994.549,32** |

**Saldo 2026:** corresponden 21 (5 años al 31/12/2026), tomados 14, pendientes 7.

**Medio año:** con ingreso 01/09/2026, 2026 da 122 días trabajados, o sea `floor(122 / 20)` = 6 días.

## 6. Liquidación final

El renglón 330 (vacaciones no gozadas) pasa a usar los días pendientes:

```
días = Σ pendientes de los años anteriores al del egreso (desde anioInicioVacaciones o con saldo inicial, nunca negativos)
     + max(0, corresponden proporcional del año del egreso − tomados de ese año)
```

- **Corresponden proporcional del año del egreso:**
  - con saldo inicial de ese año: `saldo inicial × díasTrabajadosEnElAño / 365`;
  - si no: la banda por antigüedad al egreso × `díasTrabajadosEnElAño / 365`, como hasta ahora.
- **Importe:** `mejorRemuneración ÷ 25 × días`. El 331 sigue siendo `330 ÷ 12`.
- `liquidarFinal` recibe `diasVacacionesPendientesAnteriores: number` y `diasVacacionesTomadosAnio: number`, ambos con default 0.

Sin períodos registrados, el resultado de la Entrega 20 no cambia: los años anteriores a 2026 no cuentan y en el año no hay tomados.

**Ejemplo:** el despido del 15/11/2026 de la Entrega 20, con 14 días tomados en 2026.
- Días: `max(0, 21 × 319/365 − 14)` = 4,3534.
- Importe: `1.137.465 ÷ 25 × 4,3534...` = 198.074,73.
- El 331 da 16.506,23.

## 7. F.931

- Campo 40 (Vacaciones): suma de los renglones 150.
- Campo 36 (Sueldo + adicionales): incluye los 151, negativos.
- El total de remuneración no cambia.

## 8. Web

**Sueldos → Vacaciones:**
- selector de año y tabla por empleado: legajo, nombre, corresponden (con el saldo inicial editable), tomados y pendientes (en rojo si es negativo);
- al abrir un empleado, sus períodos con Alta, Editar y Eliminar (deshabilitados si están liquidados) y los avisos al guardar.

**Ficha del empleado:** pestaña "Vacaciones" con los saldos por año y los períodos.

**Recibo:** los renglones 150 y 151 con su cantidad de días.

## 9. Pruebas

**Cálculo puro:**
- el ejemplo de la mensual;
- período que cruza de mes;
- bandas de 14, 21, 28 y 35 días por antigüedad al 31/12;
- medio año (6 días);
- empleado que ingresa en el año siguiente (0).
- **Final:**
  - el ejemplo con 14 tomados (330 = 198.074,73);
  - sin registros, igual que la Entrega 20 (835.055,13);
  - con saldo inicial de 2025 de 10 días pendientes, suma 10 días.

**API:**
- alta de período con avisos (saldo excedido, fuera del período legal);
- superposición → 400;
- `desde` antes del ingreso → 400;
- la mensual en borrador del mes se recalcula y muestra 150/151;
- cerrar → período liquidado; editar → 400 con el mensaje;
- reabrir → editable;
- saldos por año con saldo inicial;
- la final descuenta los tomados;
- F.931 campo 40;
- permisos;
- migración de los conceptos y la configuración en empresas existentes.

**Web:** tabla de saldos (pendientes negativos en rojo); diálogo de período con avisos.

**E2E:** el contador registra 14 días de vacaciones de un empleado, ve el saldo y la mensual con el renglón de vacaciones.

## 10. Lo que queda al builder

- **Pantallas:** su distribución.
- **Errores:** textos de errores secundarios.
- **Avisos:** cómo se muestran en la web.
