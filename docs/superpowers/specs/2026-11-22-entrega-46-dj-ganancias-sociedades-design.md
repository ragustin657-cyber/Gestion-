# Entrega 46 — DJ de Ganancias de sociedades y anticipos

## 1. Intención
Con la amortización impositiva (E44) y el ajuste por inflación impositivo (E45) ya calculados, falta el papel de trabajo de la **declaración jurada anual de Ganancias de la sociedad** (F.713): partir del resultado contable, llevarlo al resultado impositivo, aplicar la escala del art. 73 y restar los pagos a cuenta; y el **plan de anticipos** del ejercicio siguiente.

**Éxito:**
- El contador elige un ejercicio y ve la determinación completa: resultado contable, ajustes automáticos (amortizaciones, ajuste por inflación), ajustes manuales, quebrantos, ganancia neta imponible, impuesto, pagos a cuenta y saldo; y los 10 anticipos del ejercicio siguiente.
- La marca como **presentada**: queda congelada (los importes no cambian aunque después cambie el Mayor o un índice) y bloquea las partidas del ajuste impositivo de ese ejercicio.

**No objetivos:** no genera el F.713 ni se presenta en ARCA (es un formulario web); no contabiliza la provisión del impuesto; no calcula los anticipos de personas humanas.

## 2. Enfoques
1. **Elegido: papel de trabajo calculado, con ajustes manuales y foto al presentar.** Una función pura arma la determinación con lo que ya calculan el Mayor, la E44 y la E45, más los datos que carga el contador; al presentar se guarda la foto.
2. Planilla manual (el contador carga cada renglón): repite lo que el sistema ya sabe.
3. Generar el archivo del F.713: no hay diseño de importación (es un formulario web de ARCA).

## 3. Determinación (ejercicio E)
1. **Resultado contable antes del ajuste contable:** Σ (haber − debe) de las cuentas de resultado (`RESULTADO_POSITIVO` y `RESULTADO_NEGATIVO`) de los asientos del ejercicio, sin refundición ni cierre, y **sin** los asientos de ajuste por inflación contable (tipo u origen `AJUSTE_INFLACION`, incluido el RECPAM).
2. **Ajustes automáticos:**
   - Amortizaciones: `− diferencia` de la planilla impositiva de bienes de uso (E44: deducible − contable).
   - Ajuste por inflación impositivo: `+ totalDj` de la E45 (0 si no corresponde).
3. **Ajustes manuales** (`DjGananciasAjuste`): concepto e importe con signo (positivo suma: gastos no deducibles, provisión del impuesto, diferencia del resultado por venta de bienes de uso, etc.; negativo resta: ingresos exentos o no gravados, etc.).
4. **Resultado impositivo** = 1 + 2 + 3.
5. **Quebrantos de ejercicios anteriores** (dato cargado, ya actualizado): se computan hasta el resultado impositivo positivo. Si el resultado es negativo, se informa como **quebranto del ejercicio**.
6. **Ganancia neta imponible** = máx(0, resultado impositivo − quebrantos computados).
7. **Impuesto determinado** con la **escala de sociedades** del año del inicio del ejercicio (`EscalaSociedades`, de empresa: tramos con desde, monto fijo y alícuota sobre el excedente). Sin escala cargada: `Cargue la escala de Ganancias de sociedades de <año>`. *(Decisión mía)* La escala no se prorratea en ejercicios irregulares (distintos de 12 meses): se aplica entera y la planilla avisa `El ejercicio no es de 12 meses: verifique la escala aplicada`.
8. **Pagos a cuenta:**
   - retenciones de Ganancias sufridas (`ReciboRetencion` tipo `GANANCIAS` con fecha en el ejercicio);
   - percepciones de Ganancias (despachos de importación: `ComprobanteCompra.percepcionGanancias` con fecha contable en el ejercicio);
   - anticipos ingresados y saldo a favor del ejercicio anterior (datos cargados);
   - impuesto sobre débitos y créditos bancarios computable como pago a cuenta (ley 25.413; dato cargado);
   - otros pagos a cuenta (dato cargado).
9. **Saldo** = impuesto determinado − pagos a cuenta: a pagar (positivo) o a favor (negativo).
10. **Anticipos del ejercicio siguiente** (RG 5211): base = impuesto determinado − retenciones − percepciones − impuesto sobre débitos y créditos computable (no menor que 0). *(Decisión mía)* Los anticipos ingresados, el saldo a favor anterior y los otros pagos a cuenta no reducen la base. 10 anticipos: el primero 25 %, los nueve siguientes 8,33 % (el último ajusta el redondeo para que sumen el 100 %). Vencimientos: la DJ vence en el 5.º mes siguiente al cierre y los anticipos desde el 6.º, uno por mes (se informa el mes; el día depende de la terminación de la CUIT).
- Redondeo a 2 decimales por renglón.

## 4. Datos y estados (`DjGananciasSociedades`, uno por ejercicio)
- Datos cargados: quebrantos computables, anticipos ingresados, saldo a favor anterior, impuesto sobre débitos y créditos computable, otros pagos a cuenta; ajustes manuales (tabla aparte).
- *(Decisión mía)* Si la amortización impositiva o el ajuste por inflación impositivo no se pueden calcular (por ejemplo, faltan índices), la DJ entera devuelve ese error: no se calcula a medias. Los avisos (vida útil contable, apertura inicial, ejercicio irregular) se muestran y no bloquean.
- Estados: `BORRADOR` (se calcula al vuelo) y `PRESENTADA`.
- *(Decisión mía)* Cada presentación se guarda aparte (`DjGananciasPresentacion`: número 0 = original, 1, 2… = rectificativas; foto completa de la determinación y los anticipos; quién y cuándo; si se anuló, cuándo, quién y el motivo). Anular no borra la foto: queda el historial de la original y las rectificativas.
- *(Decisión mía)* Solo se puede marcar como presentada con el ejercicio contable **cerrado** (`Cierre el ejercicio antes de presentar la DJ`), para que la foto no cambie después.
- Presentada: no se modifican sus datos ni sus ajustes (`La DJ de Ganancias del ejercicio está presentada`) ni las partidas del ajuste impositivo de ese ejercicio (mismo mensaje). Se puede **anular la presentación** con un motivo (vuelve a borrador; auditado).
- Permisos: ver `impuestos.ver`; cargar, presentar y anular `impuestos.presentar`.

## 5. Escala
- `EscalaSociedades` (de empresa): año, tramos ordenados `{ desde, fijo, alicuota }`. Se carga en *Impuestos › Configuración*, pestaña o sección *Escala de sociedades*, por año; con un botón para copiar los tramos de la ley 27.630 (2021: hasta 5.000.000 al 25 %; de 5.000.000 a 50.000.000, 1.250.000 más 30 %; más de 50.000.000, 14.750.000 más 35 %) como punto de partida, que el contador actualiza con los valores de ARCA del año.

## 6. Pantallas
- *Impuestos › DJ de Ganancias (sociedades)*: ejercicio; determinación renglón por renglón con enlaces a las planillas de amortización impositiva y de ajuste por inflación; datos cargados y ajustes manuales (alta, edición y baja); impuesto, pagos a cuenta y saldo; plan de anticipos; botones *Marcar como presentada* y *Anular presentación*; exportar a Excel.

## 7. Fuera de alcance
- Archivo o envío del F.713; contabilización de la provisión y de los anticipos; anticipos de personas humanas; reducción de anticipos; ajuste automático del resultado por venta de bienes de uso (va como ajuste manual); quebrantos específicos (acciones, derivados, fuente extranjera).

## 8. Datos a verificar (van a `docs/pendientes.md` §2)
- Escala vigente de cada año (ARCA la actualiza por IPC).
- Porcentajes y vencimientos de los anticipos de sociedades (RG 5211).
- Qué percepciones y retenciones se computan como pago a cuenta y en qué ejercicio.
