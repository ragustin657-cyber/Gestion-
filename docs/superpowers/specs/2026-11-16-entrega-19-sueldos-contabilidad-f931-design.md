# Entrega 19: Sueldos parte 2 (contribuciones, asiento, pagos y F.931)

## 1. Objetivo y alcance

La Entrega 18 deja liquidar, cerrar e imprimir recibos, pero la liquidación no llega a la contabilidad, no se paga desde el sistema y el F.931 se sigue armando afuera. Esta entrega cierra el circuito mensual. Una liquidación cerrada:
- genera su asiento con las contribuciones patronales;
- se paga desde Tesorería;
- deja la deuda de cargas sociales para pagarla después;
- produce el archivo de importación de SICOSS para presentar el F.931 sin tipear.

**Criterio de éxito.** Con la demo:
- cierro la liquidación de noviembre y veo su asiento, con las contribuciones por centro de costo;
- pago los netos desde una cuenta bancaria;
- descargo el F.931 y lo importo en SICOSS;
- pago las cargas sociales;
- Sueldos a pagar y Cargas sociales a pagar quedan en cero en el Mayor.

**Decisiones tomadas con el usuario:**
- **Alcance:** el circuito completo:
  - contribuciones patronales configurables;
  - asiento al cerrar;
  - pago de netos;
  - deuda y pago de cargas sociales y retenciones sindicales;
  - archivo F.931 (SICOSS).

  El Libro de Sueldos Digital y la liquidación final quedan para entregas propias.
- **F.931:** el archivo de importación de SICOSS completo, con códigos ARCA nuevos en el empleado (con valores por defecto).
- **Diseño técnico:**
  - contribuciones en una tabla propia de la empresa (no como conceptos del convenio);
  - asiento automático al cerrar;
  - documentos de pago propios del módulo de sueldos.

**No objetivos:**
- Libro de Sueldos Digital.
- Liquidación final e indemnizaciones; vacaciones.
- Ganancias de cuarta categoría.
- Reducciones de contribuciones por regímenes promocionales: solo se informa el código de actividad o de modalidad que elija el usuario, sin calcular beneficios.
- Generación del VEP.
- Pago por archivo bancario (interbanking).
- Embargos y asignaciones familiares pagadas por el empleador.

**Anti-objetivos:** asientos que no balancean o que quedan de una liquidación reabierta; un F.931 con un largo de línea distinto del diseño (SICOSS lo rechaza entero); pagar dos veces el neto de un empleado.

## 2. Contribuciones patronales

### Modelo
- **`ContribucionPatronal`:** `{ id, empresaId, codigo, nombre, destino, alicuota, importeFijo, aplicaDetraccion, cuentaContableId, desdeAnio, desdeMes, activa }`.
  - `destino`: `SEGURIDAD_SOCIAL | OBRA_SOCIAL | ART | SEGURO_VIDA`.
  - `alicuota`: Decimal(9,4), %.
  - `importeFijo`: Decimal(18,2), por empleado y mes; default 0.
  - `aplicaDetraccion`: Boolean.
  - `cuentaContableId`: la cuenta de deuda; por defecto, Cargas sociales a pagar.
  - Único `(empresaId, codigo, desdeAnio, desdeMes)`.
  - **Vigencia:** para un período rige, por código, la fila con `(desdeAnio, desdeMes)` más reciente que sea ≤ el período (como las escalas).
- **`ParametroPrevisional`:** `{ id, empresaId, anio, mes, baseMaximaAportes, detraccion }`.
  - Único `(empresaId, anio, mes)`.
  - Un período sin fila propia usa la última anterior. Sin ninguna, base máxima sin tope y detracción 0, y la liquidación muestra el aviso `No hay parámetros previsionales cargados`.
- **`ReciboSueldoContribucion`:** `{ id, empresaId, reciboId (cascade), codigo, nombre, destino, base, alicuota, importe, cuentaContableId }`.
  - Es una copia al cerrar.
- Los tres modelos van en `MODELOS_DE_EMPRESA`.

### Precarga
La precarga se hace en empresas nuevas y, por migración, en las existentes. Rige desde 01/2026 y todo es editable:

| Código | Nombre | Destino | Alícuota | Fijo | Detracción |
|---|---|---|---|---|---|
| SIPA | Jubilación (SIPA) | SEGURIDAD_SOCIAL | 10,77 | 0 | sí |
| PAMI | INSSJP (Ley 19.032) | SEGURIDAD_SOCIAL | 1,59 | 0 | sí |
| FNE | Fondo Nacional de Empleo | SEGURIDAD_SOCIAL | 0,94 | 0 | sí |
| AAFF | Asignaciones familiares | SEGURIDAD_SOCIAL | 4,70 | 0 | sí |
| OS | Obra social | OBRA_SOCIAL | 6,00 | 0 | no |
| ART | ART | ART | 2,50 | 1.500,00 | no |
| SCVO | Seguro colectivo de vida obligatorio | SEGURO_VIDA | 0 | 1.000,00 | no |

Notas sobre la precarga:
- **SIPA, PAMI, FNE y AAFF** suman el 18 % del régimen general.
- **El 20,40 %** se carga editando las alícuotas.
- **ART y SCVO** son valores de ejemplo, y la pantalla lo dice: "Ajuste ART y seguro de vida a su contrato".

**Parámetro previsional precargado:** 01/2026, base máxima 3.500.000,00, detracción 7.003,68, también editables.

### Cálculo por recibo
El cálculo es una función pura en `calculo.ts`.

**Base:**
- La base es el total remunerativo del recibo (las contribuciones no tienen tope).
- Si `aplicaDetraccion`, la base se reduce en la detracción, proporcionada como sigue y nunca por debajo de 0:
  - **mensual:** `detraccion × díasTrabajados / 30`;
  - **SAC:** `detraccion × 50 %`.

**Importe:** `base × alicuota / 100 + importeFijo`, redondeado a 2 decimales.
- El fijo es entero en el mensual con días trabajados > 0.
- En el SAC el fijo es 0: ART y SCVO no se cobran sobre el aguinaldo como fijo mensual.
- El SAC sí lleva las alícuotas.

**Recibos con días trabajados 0:** no generan contribuciones.

### Tope de aportes del mes
Los conceptos `DESCUENTO_LEY` admiten `tope: 'BASE_MAXIMA'`. En ese caso la base del descuento se limita con la `baseMaximaAportes` del período, y en el SAC con la mitad. La precarga cambia jubilación, Ley 19.032 y obra social a `tope: 'BASE_MAXIMA'`: con una migración en las empresas existentes, solo donde el concepto no tiene un tope numérico propio. El tope numérico de la Entrega 18 sigue valiendo.

## 3. Asiento de la liquidación

**Cuentas nuevas** en el plan modelo. La migración las agrega en las empresas existentes cuando el código está libre; si está ocupado, se usa el siguiente libre del mismo rubro.
- `2.1.03 Deudas sociales` (rubro).
- `2.1.03.001 Sueldos a pagar`.
- `2.1.03.002 Cargas sociales a pagar`.
- `2.1.03.003 Retenciones sindicales a pagar`.
- `5.2.09 Sueldos y jornales`.
- `5.2.10 Contribuciones patronales`.

**Configuración de cuentas de sueldos:** `ConfiguracionSueldos` es uno por empresa: `{ cuentaSueldosId, cuentaContribucionesId, cuentaSueldosAPagarId, cuentaCargasSocialesId, cuentaRetencionesSindicalesId }`, con las cuentas anteriores por defecto.

**Descuentos:** los conceptos `DESCUENTO` llevan `cuentaContableId?`. Sin cuenta, el descuento va a Cargas sociales a pagar. En la precarga, sindicato y FAECYS van a Retenciones sindicales a pagar.

**Al cerrar** (misma transacción que la numeración), `origenTipo 'LIQUIDACION_SUELDO'`, fecha el último día del mes liquidado (en el SAC, el 30/06 o el 31/12). La descripción es `Liquidación de sueldos MM/AAAA` o `SAC 1.er semestre AAAA`.
- **Debe Sueldos y jornales:** remunerativo + no remunerativo, por centro de costo del empleado (sin centro, sin centro).
- **Debe Contribuciones patronales:** total de contribuciones, por centro de costo.
- **Haber Sueldos a pagar:** suma de netos, sin centro.
- **Haber cuenta de cada descuento:** suma por cuenta.
- **Haber cuenta de cada contribución:** suma por cuenta.

Las ausencias (importe negativo remunerativo) ya están netas en el remunerativo.

**Validaciones al cerrar** (400, nada se graba):
- Período contable cerrado o fuera de ejercicio: el mensaje del servicio de asientos.
- Configuración incompleta: `Configure las cuentas de sueldos`.

**Reabrir:**
- **Bloqueos:**
  - con pagos de sueldos no anulados: `La liquidación tiene pagos: anúlelos antes de reabrir`;
  - con el período contable del asiento cerrado: el mensaje del servicio.
- **Anulación:** genera el contraasiento con la misma fecha del asiento y borra las contribuciones copiadas.
- **Al volver a cerrar:** asiento nuevo.

**Liquidaciones cerradas antes de esta entrega** (sin asiento): `POST /api/sueldos/liquidaciones/:id/contabilizar` (`sueldos.liquidar`) calcula las contribuciones y genera el asiento. Si ya tiene asiento: `La liquidación ya está contabilizada`.

**`GET :id`** agrega:
- `asiento: { id, numero } | null`;
- `contribuciones: { porEmpleado, totales por destino, total }`;
- `pagos` (ver §4);
- `pendientePago` (neto aún no pagado).

En borrador, las contribuciones se muestran calculadas sin grabar.

## 4. Pagos

### Pago de sueldos
- **Modelo `PagoSueldos`:** `{ id, empresaId, numero (talonario PAGO_SUELDOS), liquidacionId, fecha, cuentaBancariaId?, cajaId?, importe, anulado, asientoId, creadoPor, creadoEn }`.
- **Modelo `PagoSueldosRecibo`:** `{ pagoId, reciboId, importe }`.

**`POST /api/sueldos/liquidaciones/:id/pagos { fecha, cuentaBancariaId | cajaId, reciboIds? }`** (`sueldos.liquidar`):
- Por defecto paga todos los recibos aún no pagados, por su neto completo. No hay pagos parciales de un recibo.
- **Requisitos** (400):
  - liquidación cerrada y contabilizada: `La liquidación no está cerrada` / `La liquidación no está contabilizada`;
  - recibos de la liquidación no pagados en otro pago vigente: `El recibo del legajo N ya está pagado`;
  - moneda ARS;
  - fecha en período contable abierto.
- **Efectos:**
  - `MovimientoTesoreria` de egreso (`origenTipo 'PAGO_SUELDOS'`) sobre la cuenta o la caja, por el total;
  - asiento: debe Sueldos a pagar, haber la cuenta contable de la cuenta bancaria o la caja (las que ya usa Tesorería).

**`POST /api/sueldos/pagos/:id/anular`:**
- Contraasiento con la fecha del día y movimiento de Tesorería anulado.
- Libera los recibos.

**`GET /api/sueldos/liquidaciones/:id`** devuelve `pagos: [{ id, numero, fecha, cuenta, importe, anulado, empleados }]` y en cada recibo `pagado: boolean`.

### Pago de cargas sociales y retenciones
- **Modelo `PagoCargasSociales`:** `{ id, empresaId, numero (talonario PAGO_CARGAS), fecha, cuentaContableDeudaId, anio, mes, cuentaBancariaId?, cajaId?, importe, detalle?, anulado, asientoId, creadoPor, creadoEn }`.

**`GET /api/sueldos/cargas-sociales?anio&mes`:**
- Por cada cuenta de deuda de sueldos (Cargas sociales a pagar, Retenciones sindicales a pagar y las de los descuentos o contribuciones con cuenta propia): devengado del período (de los asientos `LIQUIDACION_SUELDO` vigentes de liquidaciones de ese mes, mensual y SAC), pagado (pagos vigentes del período) y pendiente.
- Para Cargas sociales a pagar, el detalle por destino: aportes SS, aportes OS, contribuciones SS, contribuciones OS, ART y SCVO, que es lo que muestra el F.931.

**`POST /api/sueldos/cargas-sociales/pagos { anio, mes, cuentaContableDeudaId, importe, fecha, cuentaBancariaId | cajaId, detalle? }`:**
- `importe > 0` y `≤ pendiente`; si no: `El importe supera lo pendiente (pendiente $ X)`.
- Movimiento de Tesorería de egreso.
- Asiento: debe la cuenta de deuda, haber banco o caja.

**`POST /api/sueldos/cargas-sociales/pagos/:id/anular`:** como el de sueldos.

Los modelos nuevos van en `MODELOS_DE_EMPRESA`. Los talonarios nuevos se crean por empresa con `NumeracionService`.

## 5. F.931: archivo de importación de SICOSS

### Datos del empleado nuevos
Defaults entre paréntesis, editables en la ficha:
- `codigoSituacion` (1 Activo);
- `codigoCondicion` (1 Servicios comunes mayor de 18 años);
- `codigoActividad` (49 Actividades no clasificadas);
- `codigoModalidad` (8 Tiempo indeterminado / permanente);
- `codigoZona` (0; por defecto el de la empresa: `Empresa.codigoZonaSicoss`, default 0);
- `codigoObraSocial` (texto de 6, default `'000000'`, y la liquidación avisa `Falta el código de obra social de <legajo>`);
- `conyuge` Boolean (false);
- `cantidadHijos` Int (0);
- `adherentesObraSocial` Int (0);
- `trabajadorConvencionado` Boolean (true);
- `codigoSiniestrado` (0).

El tipo de empresa SICOSS va en `Empresa.tipoEmpresaSicoss` (default 1, Decreto 814/01 art. 2 inc. B: comercio o servicios) y el régimen en `Empleado.regimen` (1 SIPA).

### Archivo
**`GET /api/sueldos/f931?anio&mes`** (`sueldos.ver`):
- Toma las liquidaciones **cerradas** de ese mes (la mensual y, si existe, el SAC de ese mes) y devuelve un `.txt` con una línea por empleado.
- Si un empleado está en ambas, sus importes se suman y el SAC va en su campo.
- Sin liquidaciones cerradas: 400 `No hay liquidaciones cerradas de MM/AAAA`.
- Nombre del archivo: `F931-AAAAMM.txt`.

**Diseño de registro:** SICOSS versión 42 o posterior vigente.
- 60 campos y 499 caracteres por línea, separadas por CRLF, en latin1 (Windows-1252).
- Lo define una tabla declarativa en `apps/api/src/sueldos/f931-diseno.ts`: `{ numero, nombre, largo, tipo: 'N' | 'C' | 'I', valor(datos) }`. Con ella cambiar a otra versión es editar la tabla.
- Cada línea se verifica antes de devolver el archivo: si una no mide 499, responde 500 `Error interno: línea de largo N`.

| # | Campo | Largo | Tipo | Origen |
|---|---|---|---|---|
| 1 | CUIL | 11 | N | empleado |
| 2 | Apellido y nombre | 30 | C | `APELLIDO NOMBRE`, mayúsculas, sin tildes, recortado |
| 3 | Cónyuge | 1 | N | 1/0 |
| 4 | Cantidad de hijos | 2 | N | |
| 5 | Código de situación | 2 | N | |
| 6 | Código de condición | 2 | N | |
| 7 | Código de actividad | 3 | N | |
| 8 | Código de zona | 2 | N | |
| 9 | Porcentaje de aporte adicional SS | 5 | I | 0 |
| 10 | Código de modalidad de contratación | 3 | N | |
| 11 | Código de obra social | 6 | C | |
| 12 | Cantidad de adherentes | 2 | N | |
| 13 | Remuneración total | 12 | I | remunerativo + no remunerativo |
| 14 | Remuneración imponible 1 | 12 | I | remunerativo con tope de base máxima |
| 15 | Asignaciones familiares pagadas | 9 | I | 0 |
| 16 | Importe aporte voluntario | 9 | I | 0 |
| 17 | Importe adicional OS | 9 | I | 0 |
| 18 | Importe excedentes aportes SS | 9 | I | 0 |
| 19 | Importe excedentes aportes OS | 9 | I | 0 |
| 20 | Provincia / localidad | 50 | C | domicilio de la empresa, recortado |
| 21 | Remuneración imponible 2 | 12 | I | remunerativo (base de contribuciones SS, sin tope) |
| 22 | Remuneración imponible 3 | 12 | I | remunerativo (base contribuciones OS) |
| 23 | Remuneración imponible 4 | 12 | I | remunerativo con tope (base aporte OS) |
| 24 | Código de siniestrado | 2 | N | |
| 25 | Marca de corresponde reducción | 1 | N | 0 |
| 26 | Capital de recomposición LRT | 9 | I | 0 |
| 27 | Tipo de empresa | 1 | N | empresa |
| 28 | Aporte adicional OS | 9 | I | 0 |
| 29 | Régimen | 1 | N | empleado |
| 30 | Situación de revista 1 | 2 | N | código de situación |
| 31 | Día inicio situación de revista 1 | 2 | N | 1 o el día de ingreso si ingresó en el mes |
| 32 | Situación de revista 2 | 2 | N | 0 |
| 33 | Día inicio situación de revista 2 | 2 | N | 0 |
| 34 | Situación de revista 3 | 2 | N | 0 |
| 35 | Día inicio situación de revista 3 | 2 | N | 0 |
| 36 | Sueldo + adicionales | 12 | I | renglones remunerativos de tipo BASICO, ANTIGUEDAD, PORCENTAJE, AUSENCIA |
| 37 | SAC | 12 | I | renglón 200 |
| 38 | Horas extras (importe) | 12 | I | renglones HORAS_EXTRA |
| 39 | Zona desfavorable | 12 | I | 0 |
| 40 | Vacaciones | 12 | I | 0 |
| 41 | Cantidad de días trabajados | 9 | I | días trabajados del mensual |
| 42 | Remuneración imponible 5 | 12 | I | remunerativo con tope (base aportes INSSJP) |
| 43 | Trabajador convencionado | 1 | N | 1/0 |
| 44 | Remuneración imponible 6 | 12 | I | 0 |
| 45 | Tipo de operación | 1 | N | 0 |
| 46 | Adicionales | 12 | I | 0 |
| 47 | Premios | 12 | I | 0 |
| 48 | Remuneración imponible 8 (Dec. 788/05) | 12 | I | remunerativo |
| 49 | Remuneración imponible 7 | 12 | I | 0 |
| 50 | Cantidad de horas extras | 3 | N | horas de novedades 50 % + 100 % |
| 51 | Conceptos no remunerativos | 12 | I | no remunerativo |
| 52 | Maternidad | 12 | I | 0 |
| 53 | Rectificación de remuneración | 9 | I | 0 |
| 54 | Remuneración imponible 9 | 12 | I | remunerativo (base LRT) |
| 55 | Contribución tarea diferencial | 9 | I | 0 |
| 56 | Horas trabajadas | 3 | N | 0 |
| 57 | Seguro colectivo de vida obligatorio | 1 | N | 1 si la empresa tiene SCVO activo |
| 58 | Importe a detraer (Ley 27.430) | 12 | I | detracción aplicada |
| 59 | Incremento salarial | 12 | I | 0 |
| 60 | Remuneración imponible 11 | 12 | I | remunerativo − detracción (base contribuciones con detracción) |

**Formatos:**
- **N:** numérico entero, ceros a la izquierda.
- **C:** texto alineado a la izquierda, completado con espacios, recortado al largo.
- **I:** importe con 2 decimales y coma decimal, sin separador de miles, alineado a la derecha y completado con espacios a la izquierda (`   1168965,00`). Si el importe no entra en el largo: error `El importe de <campo> del legajo N excede el largo del archivo`.

Las posiciones salen de la suma de los largos y la tabla se verifica en una prueba: 60 campos y 499 caracteres; cónyuge en la posición 42, hijos en la 43, situación en la 45.

> **Para el builder:** el diseño reproduce el de SICOSS versión 42 según la documentación pública disponible. Antes de dar por terminada la entrega, conviene contrastar los formatos de importe y los campos 48–60 con el manual oficial de ARCA (no accesible desde esta sesión). La tabla declarativa hace que una corrección sea local.

## 6. Web

- **Sueldos → Contribuciones** (`sueldos.ver`; edición con `sueldos.liquidar`):
  - tabla de contribuciones con su vigencia (alta de una nueva vigencia copiando la anterior);
  - parámetros previsionales por mes;
  - configuración de cuentas;
  - el aviso de ART y seguro de vida.
- **Ficha del empleado:** sección "Datos para el F.931" con los códigos (selects con los valores más usados y un campo libre para otros).
- **Liquidación:**
  - tarjeta de contribuciones (total por destino);
  - enlace al asiento;
  - botón "Contabilizar" para las cerradas sin asiento;
  - pestaña Pagos: pagar todos o los elegidos (cuenta o caja, fecha), lista de pagos con Anular, marca de pagado en cada recibo;
  - "Descargar F.931" del mes.
- **Sueldos → Cargas sociales:**
  - mes;
  - tabla por cuenta de deuda (devengado, pagado, pendiente) con el detalle F.931;
  - Pagar (importe sugerido = pendiente);
  - lista de pagos con Anular.

## 7. Pruebas

### Ejemplo que fija el cálculo
Es el empleado del ejemplo de la Entrega 18: Vendedor B, 1.000.000,00, noviembre 2026, 4 horas al 50 %, remunerativo 1.168.965,00, neto 941.016,82. Los parámetros son los de la precarga.

Base con detracción: 1.168.965,00 − 7.003,68 = 1.161.961,32.

| Contribución | Base | Importe |
|---|---|---|
| SIPA 10,77 % | 1.161.961,32 | 125.143,23 |
| PAMI 1,59 % | 1.161.961,32 | 18.475,18 |
| FNE 0,94 % | 1.161.961,32 | 10.922,44 |
| AAFF 4,70 % | 1.161.961,32 | 54.612,18 |
| OS 6 % | 1.168.965,00 | 70.137,90 |
| ART 2,50 % + 1.500 | 1.168.965,00 | 30.724,13 |
| SCVO fijo | — | 1.000,00 |
| **Total** | | **311.015,06** |

**Asiento** (sin centro de costo):

| Cuenta | Debe | Haber |
|---|---|---|
| 5.2.09 Sueldos y jornales | 1.168.965,00 | |
| 5.2.10 Contribuciones patronales | 311.015,06 | |
| 2.1.03.001 Sueldos a pagar | | 941.016,82 |
| 2.1.03.002 Cargas sociales a pagar | | 509.739,11 (aportes 198.724,05 + contribuciones 311.015,06) |
| 2.1.03.003 Retenciones sindicales a pagar | | 29.224,13 (sindicato 23.379,30 + FAECYS 5.844,83) |
| **Totales** | **1.479.980,06** | **1.479.980,06** |

### API
- Contribuciones del ejemplo.
- Ingreso a mitad de mes: detracción proporcional y fijo entero.
- SAC: detracción al 50 % y sin fijos.
- Vigencia de una contribución nueva desde 12/2026.
- Tope de base máxima en los aportes; el SAC con la mitad.
- Asiento del ejemplo, y con dos centros de costo.
- Cierre con el período contable cerrado → 400 sin numerar.
- Reabrir: contraasiento.
- Reabrir con pago → 400.
- Contabilizar una cerrada sin asiento.
- Pago de todos y de algunos.
- Pagar dos veces el mismo recibo → 400.
- Anular un pago.
- Pago de cargas sociales con pendiente, de más (400) y anulación.
- Cargas sociales con mensual + SAC del mismo mes.
- F.931:
  - largo de cada línea 499;
  - campos del ejemplo en sus posiciones (CUIL, remuneración total `  1168965,00`, imponible 1 con tope cuando corresponde, SAC en el campo 37 para diciembre);
  - nombre sin tildes;
  - error sin liquidaciones cerradas.
- Migración: empresa existente con contribuciones y cuentas precargadas.
- Permisos.

### Web
- Tabla de contribuciones con vigencias.
- Panel de pagos (pagar los elegidos, recibo pagado marcado).
- Tabla de cargas sociales con pendiente.

### E2E
El contador cierra la liquidación, ve el asiento, paga los netos desde el banco, descarga el F.931 y paga las cargas sociales.

## 8. Lo que queda al builder

- **Pantallas:** distribución de las pantallas dentro del estilo de la Entrega 18.
- **Errores:** textos de errores secundarios.
- **Orden de las pruebas.**
- **Contraste del F.931:** comparar el diseño del F.931 con el manual oficial (§5).
