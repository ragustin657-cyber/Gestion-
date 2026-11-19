# Entrega 33 — Pulido de Ganancias (menores diferidos de la E32)

## Intención
Corregir los 9 hallazgos menores que la revisión final de la E32 dejó diferidos. No cambian lo que ya se presenta; cierran casos borde que podían retener de más, perder un empleado del F.1359 o dejar un error sin explicación.

## Alcance (aprobado)
1. **Ajuste ya aplicado:** se cuenta por `anioAjusteGanancias` con cualquier concepto `GANANCIAS_AJUSTE` (sin filtrar por el concepto activo). Si hay saldos pendientes de anuales cerradas y ningún concepto `GANANCIAS_AJUSTE` activo, crear/recalcular la liquidación avisa: `Hay saldos de la liquidación anual de Ganancias sin aplicar: active un concepto de ajuste anual de Ganancias`.
2. **Concurrencia de la anual:** calcular, cerrar y reabrir toman el mismo lock que el cierre de liquidaciones (`ConfiguracionSueldos FOR UPDATE`); el primer `calcular` simultáneo no da 500 (upsert del encabezado).
3. **Rubro exento en PUT:** sin `exentoGanancias` en el cuerpo se usa el valor actual del concepto; el rubro se conserva.
4. **Conceptos (web):** al cambiar la clase a DESCUENTO se desmarca exento y se borra el rubro.
5. **SICORE:** las retenciones de empleados se netean por empleado (CUIL) dentro del período; una línea por empleado con neto > 0 (fecha y número de comprobante: los de su última liquidación del período; importe y base: suma de brutos).
6. **F.1359 con «Total deducciones generales» = 0:** la descarga (anual, final, distracto) da 400 `El F.1359 no admite deducciones generales en cero (sin aportes): <Apellido, Nombre>, …`.
7. **SAC en el acumulado:** los códigos 200, 201, 311, 321 y 331 suman a la cuota de SAC según el mes de pago (enero–junio: 1.ª; julio–diciembre: 2.ª).
8. **Ajuste anual:** solo en liquidaciones MENSUAL y FINAL. El tope sigue compartiendo el 35 % con la retención del mes (decisión: el total de Ganancias de un recibo nunca supera el 35 % del bruto).
9. **Egreso de enero a marzo con la final pagada desde el 1/4:** la anual deja afuera a los egresados del año y, de los egresados de enero a marzo siguientes, solo a quienes ya tienen su fila de distracto; el resto entra en la anual (con la anual cerrada antes del pago de su final, el ajuste se aplica en la final). El distracto se decide por la final pagada de enero a marzo, como hoy.

## Enfoques
- **Elegido:** una entrega de pulido con un cambio y su prueba por punto, sobre el código de la E32.
- Descartados: dejar los menores sin tratar (riesgo de retener dos veces y de archivos rechazados); un distracto fuera de plazo para el punto 9 (ARCA no lo recibe después del 31/3).

## No objetivos
Verificar con ARCA los códigos provisionales (§14 de la E32); cambios de diseño de la anual o del F.1359.

## Para el constructor
Mensajes exactos arriba; el resto (estructura interna, nombres de helpers) queda a su criterio. Cada punto con una prueba que falle antes.
