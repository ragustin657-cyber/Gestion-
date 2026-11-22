# Entrega 47 — Bienes Personales: acciones y participaciones (responsable sustituto)

## 1. Intención
Las sociedades (ley 19.550) liquidan e ingresan el impuesto sobre los Bienes Personales que corresponde a sus acciones y participaciones cuando los titulares son personas humanas (del país o del exterior), sucesiones indivisas o sociedades y entes del exterior (ley 23.966, artículo sin número a continuación del 25). La base es el **valor patrimonial proporcional** del último balance cerrado al 31 de diciembre del año. Hoy el sistema no lo calcula.

**Éxito:**
- El contador elige el año, ve el patrimonio neto del balance que corresponde, la lista de socios con su participación y, para cada uno, el valor patrimonial proporcional y el impuesto; y el total a ingresar.
- La marca como presentada: queda la foto (con historial de rectificativas, como la DJ de Ganancias) y la liquidación no cambia aunque después cambie el Mayor o un socio.

**No objetivos:** no presenta en ARCA (es un formulario web); no contabiliza el impuesto ni el crédito contra los socios (derecho de reintegro); no calcula el impuesto de las personas humanas por sus otros bienes.

## 2. Enfoques
1. **Elegido: liquidación anual calculada con el patrimonio neto del balance y un registro de socios, con foto al presentar** (como la DJ de Ganancias de la entrega 46).
2. Planilla manual (el contador carga el patrimonio y los importes): repite lo que el sistema sabe.
3. Generar el archivo del aplicativo: no hay diseño de importación disponible.

## 3. Socios (`Socio`, de empresa)
- Nombre o razón social, tipo y número de documento (CUIT, CUIL, DNI o identificación del exterior), **tipo de titular**: `PERSONA_HUMANA_PAIS`, `PERSONA_HUMANA_EXTERIOR`, `SUCESION_INDIVISA`, `SOCIEDAD_EXTERIOR` (pagan) o `SOCIEDAD_PAIS` (no paga: persona jurídica del país), **participación** en % (hasta 4 decimales), activo.
- Pantalla *Impuestos › Socios* (permiso `impuestos.presentar` para editar, `impuestos.ver` para ver).
- *(Decisión mía)* **Participaciones por año** (`BienesPersonalesParticipacion`: año, socio, tipo de titular y participación al 31/12 de ese año). La primera vez que se abre un año se copian del registro de socios (los activos); después se editan en la liquidación de ese año sin tocar el registro, y el registro se puede cambiar sin tocar los años ya armados. Botón *Volver a copiar del registro* mientras no esté presentada. Así una venta de acciones, un fallecimiento (persona humana → sucesión indivisa) o una mudanza al exterior posteriores no cambian un año anterior.

## 4. Liquidación del año A (`GET /api/impuestos/bienes-personales?anio=`)
- **Balance** *(decisión mía)*: el ejercicio cuyo cierre cae en el año A, abierto o cerrado (si hay más de uno, el último); con el ejercicio abierto la liquidación es una vista previa. Si no hay: `No hay un ejercicio que cierre en <A>`. Se usa el **patrimonio neto total** del estado de situación a la fecha de cierre (el mismo que muestra *Estados contables*, incluido el resultado del ejercicio y, si se hace, el ajuste por inflación contable).
- **Ajuste manual del patrimonio** (dato cargado, con signo, y su concepto) para las diferencias que pide la ley.
- **Participaciones:** las del año; deben sumar 100 %. *(Decisión mía)* Si no suman, la liquidación se muestra con el aviso `Las participaciones suman <x> %: deben sumar 100 %` y no se puede presentar (mismo mensaje).
- Por socio: `VPP = patrimonio × participación / 100` (2 decimales); impuesto = `VPP × alícuota / 100` si el tipo paga, 0 si es `SOCIEDAD_PAIS`.
- **Alícuota:** `ConfigImpuestos.alicuotaBienesPersonalesAcciones` (por defecto 0,5 %).
- Total del impuesto = suma de los socios. Vencimiento: se informa el mes de junio del año siguiente (a verificar).
- Sin socios que paguen: total 0 con aviso `Ningún socio paga el impuesto como responsable sustituto`.

## 5. Estados y presentación (igual que la entrega 46)
- `BienesPersonalesAcciones` por año: ajuste del patrimonio y su concepto; estado `BORRADOR` o `PRESENTADA`.
- `BienesPersonalesPresentacion`: número 0 original, 1… rectificativas; foto de la liquidación completa (incluidos los socios con su participación); anulación con motivo.
- Presentada: no se modifican el ajuste ni las participaciones del año (`La liquidación de Bienes Personales del año está presentada`); los cambios en el registro de socios no la afectan. Para presentar, el ejercicio del balance debe estar cerrado (`Cierre el ejercicio antes de presentar la liquidación`).
- Permisos: ver `impuestos.ver`; cargar, presentar y anular `impuestos.presentar`. Excel con `formato=xlsx`.

## 6. Pantallas
- *Impuestos › Socios*: ABM.
- *Impuestos › Bienes Personales (acciones)*: año; patrimonio del balance y ajuste; tabla por socio (tipo, participación, VPP, impuesto); total; avisos; presentar, anular e historial; Excel.
- *Impuestos › Configuración*: alícuota de acciones y participaciones.

## 7. Fuera de alcance
- Contabilización del impuesto y del reintegro de los socios; acciones con distintos derechos o clases; exenciones particulares (convenios de doble imposición); anticipos.

## 8. Datos a verificar (van a `docs/pendientes.md` §2)
- Alícuota vigente (0,5 %) y vencimiento.
- Qué patrimonio neto se toma (con o sin ajuste por inflación contable, ajustes que pide la ley).
- Tratamiento de las sucesiones indivisas y de los socios del exterior con convenio.
