# Entrega 48 — Otras jurisdicciones de IIBB: padrones, SIRCAR y SIRCREB

## 1. Intención
Hoy Ingresos Brutos funciona completo solo para CABA (901, AGIP) y Buenos Aires (902, ARBA):
- se pueden configurar retenciones y percepciones de las 24 jurisdicciones del Convenio Multilateral, pero el **padrón** solo se carga para 901 y 902;
- las **presentaciones** de agente son solo ARBA y AGIP; las jurisdicciones adheridas a **SIRCAR** (el sistema de recaudación del Convenio para agentes de retención y percepción) no tienen archivo;
- las **recaudaciones bancarias** (SIRCREB) que el banco debita no entran a la liquidación de IIBB (CM03) como pago a cuenta; solo hay una regla de conciliación que las lleva a la cuenta de retenciones sufridas.

**Éxito:**
- El administrador carga el padrón de cualquier jurisdicción con un formato de archivo configurable.
- El contador genera el archivo SIRCAR del mes con las retenciones y percepciones practicadas en las jurisdicciones adheridas.
- El contador carga las recaudaciones SIRCREB del mes por jurisdicción (a mano o importando la consulta) y la liquidación de IIBB las resta como pago a cuenta.
- Las constancias y pantallas muestran el nombre de cualquier jurisdicción, no solo CABA y Buenos Aires.

**No objetivos:** no se presenta nada en los sitios de los organismos; no se agregan regímenes provinciales propios fuera de SIRCAR (cada provincia con su aplicativo: Córdoba, Santa Fe, Mendoza, etc. siguen con el informe de retenciones practicadas); no se contabiliza cada débito de SIRCREB por jurisdicción (el débito bancario ya va a la cuenta 1.1.03.003 por conciliación; la liquidación lo cancela).

## 2. Enfoques
1. **Elegido: formato de padrón configurable por jurisdicción + archivo SIRCAR + registro de recaudaciones SIRCREB que alimenta la liquidación.** Cubre las tres faltas con piezas genéricas, sin un parser por provincia.
2. Un parser fijo por provincia para cada padrón: más exacto, pero 22 diseños que no tenemos ni podemos verificar.
3. Solo exportar las retenciones de otras jurisdicciones a Excel: no resuelve SIRCREB ni los padrones.

## 3. Padrones de otras jurisdicciones
- `FormatoPadron` (**común a todas las empresas**, uno por jurisdicción distinta de 901 y 902; *(decisión mía)* como el padrón, que hoy es común y lo carga el administrador general: los padrones son datos públicos de cada provincia): separador (`;`, `,`, `|`, tabulador o ancho fijo), si tiene fila de encabezado, y para cada campo la columna (o posición desde–hasta en ancho fijo): CUIT, alícuota de percepción, alícuota de retención (al menos una de las dos), vigencia desde y hasta (opcionales: si faltan, la vigencia es el mes elegido al cargar), formato de fecha (`DDMMAAAA`, `DD/MM/AAAA`, `AAAAMMDD`, `AAAA-MM-DD`), separador decimal (`.` o `,`).
- La carga usa el mismo proceso que hoy (`PadronCarga`/`PadronIibb`, en segundo plano, con errores por línea); 901 y 902 siguen con sus parsers fijos.
- Sin formato configurado: `Configure el formato del padrón de <jurisdicción>`. El formato lo configura el administrador general en *Pagos › Padrones* (mismo permiso que la carga).
- La configuración de la jurisdicción permite *usa padrón* para cualquier jurisdicción con formato (hoy solo 901 y 902).

## 4. SIRCAR (presentación `SIRCAR`, mensual)
- *(Decisión mía)* **Dos presentaciones mensuales**, `SIRCAR_RETENCIONES` y `SIRCAR_PERCEPCIONES` (como ARBA y ARBA percepciones), cada una con su archivo; sin quincenas.
- Jurisdicciones adheridas: lista configurable en *Impuestos › Configuración* (`ConfigImpuestos.jurisdiccionesSircar String[]`), vacía por defecto.
- `SIRCAR_RETENCIONES`: las **retenciones** de IIBB practicadas en órdenes de pago pagadas del mes; `SIRCAR_PERCEPCIONES`: las **percepciones** practicadas en comprobantes de venta del mes (las notas de crédito con signo negativo); solo de las jurisdicciones adheridas.
- Diseño por renglón (a verificar contra el instructivo de SIRCAR; campos separados por coma, decimales con punto):
  número de renglón (5), tipo de comprobante (`OP`, `FA`, `NC`, `ND`), número de comprobante (12), CUIT (11, sin guiones), fecha (`DD/MM/AAAA`), monto sujeto (base), alícuota, monto retenido o percibido, tipo de régimen (3), jurisdicción (3).
- *(Decisión mía)* El tipo de régimen sale de dos campos nuevos de la jurisdicción (`JurisdiccionIibb.regimenSircarRetencion` y `regimenSircarPercepcion`, 3 dígitos), leídos al generar; `000` si están vacíos.
- Sin movimientos: archivo vacío con aviso `No hay retenciones ni percepciones de SIRCAR en <mm/aaaa>`. Sin jurisdicciones adheridas: `Configure las jurisdicciones adheridas a SIRCAR`.
- Las anuladas después del mes siguen la regla de la entrega 43 (se mantienen en su mes original).
- Se agrega a *Generar presentación* y al historial como cualquier otra presentación.

## 5. Recaudaciones bancarias (SIRCREB)
- `RecaudacionBancaria` (de empresa): período (`AAAAMM`), jurisdicción, importe, cuenta bancaria (opcional), referencia; una fila por período, jurisdicción y cuenta.
- Carga a mano y por importación de un CSV con columnas `periodo;jurisdiccion;importe[;cbu]` (la consulta de SIRCREB que se baja del sitio del Convenio, a verificar).
- La liquidación de IIBB (entrega 38) suma las recaudaciones del período como pago a cuenta de cada jurisdicción (nueva columna *Recaudaciones bancarias* en la planilla y en el CM03), con el aviso de la entrega 38 si la jurisdicción no está en el Convenio del año.
- *(Decisión mía)* El asiento de la liquidación acredita las recaudaciones en un concepto contable nuevo `RECAUDACION_BANCARIA_IIBB` (por defecto la cuenta 1.1.03.003, adonde la regla de conciliación lleva hoy los débitos SIRCREB), así esa cuenta se cancela con la liquidación.
- Con la posición de IIBB del período cerrada, no se modifican las recaudaciones de ese período (`La liquidación de IIBB de <mm/aaaa> está cerrada`).
- Pantalla *Impuestos › Recaudaciones bancarias (SIRCREB)*: período, tabla por jurisdicción y cuenta, alta, edición, baja e importación.

## 6. Nombres de jurisdicciones
- Las constancias de retención, los informes y la liquidación usan el nombre de la tabla del Convenio (`JURISDICCIONES_CM`) para todas las jurisdicciones (hoy solo CABA y Buenos Aires tienen nombre).

## 7. Pantallas
- *Pagos › Padrones*: la jurisdicción se elige entre todas; para las que no son 901/902, enlace al formato.
- *Pagos › Padrones* (administrador general): formato del padrón por jurisdicción.
- *Configuración de retenciones › Ingresos Brutos*: *usa padrón* habilitado cuando la jurisdicción tiene formato; códigos de régimen SIRCAR de retención y de percepción.
- *Impuestos › Configuración*: jurisdicciones adheridas a SIRCAR.
- *Impuestos › Recaudaciones bancarias (SIRCREB)*.
- *Impuestos › Generar presentación*: *SIRCAR retenciones* y *SIRCAR percepciones*.

## 8. Fuera de alcance
- Aplicativos provinciales propios (SIRPEI, e-SICOL, etc.); padrón SIRCREB de alícuotas; contabilización de SIRCREB por jurisdicción; regímenes especiales de cada provincia.

## 9. Datos a verificar (van a `docs/pendientes.md` §2)
- Diseño del archivo SIRCAR (campos, separador, signos de notas de crédito) y lista de jurisdicciones adheridas.
- Formato de la consulta de recaudaciones SIRCREB.
- Formatos de los padrones de cada provincia que use la empresa.
