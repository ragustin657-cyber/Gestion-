# Entrega 44 — Amortización impositiva de bienes de uso

## 1. Intención
Hoy el sistema calcula la amortización **contable** de los bienes de uso (mensual, por vida útil en meses, con asiento). Para la DJ de Ganancias de sociedades (entrega 46) hace falta la amortización **impositiva** (ley de Ganancias, arts. 83, 87 y 88; decreto reglamentario), que sigue otras reglas y no se contabiliza.

**Éxito:**
- El contador elige un ejercicio y ve, por bien y por rubro, la amortización impositiva del año, la acumulada y el valor residual impositivo, con la actualización por IPC que corresponda, y la diferencia con la amortización contable del mismo ejercicio.
- La entrega 46 usa el mismo cálculo para el ajuste de la DJ (amortización impositiva en lugar de la contable) y para el costo computable de los bienes vendidos.

**No objetivos:**
- No genera asientos: la impositiva es extracontable.
- No reemplaza ni modifica la amortización contable.
- No presenta nada ante ARCA (eso es la DJ de la entrega 46).

## 2. Enfoques
1. **Elegido: cálculo al vuelo.** La planilla impositiva de un ejercicio se calcula cada vez con los datos del bien, el rubro y los índices, con una función pura (`amortizacionImpositiva`) que la entrega 46 reutiliza. No hay proceso ni tablas de cuotas: no hay nada que anular ni reprocesar. Si cambia un índice, cambia el resultado; la DJ de la entrega 46 congela los importes al generarse.
2. Proceso anual que guarda las cuotas (como el contable): estabilidad del número, pero suma procesos, anulaciones y bloqueos sin que nadie los necesite (la impositiva no afecta saldos).
3. Cargar a mano la amortización impositiva por bien: sin cálculo, propenso a errores.

## 3. Reglas del cálculo (ejercicio fiscal = ejercicio contable del sistema)
- **Datos impositivos del rubro** (`RubroBienUso`): `vidaUtilImpositivaAnios Int?` (vacío: la vida útil contable redondeada hacia arriba a años), `tipoImpositivo` (`MUEBLE` | `INMUEBLE` | `AUTOMOVIL` | `NO_AMORTIZABLE`, por defecto `MUEBLE`).
- **Por bien** (`BienUso`): `vidaUtilImpositivaAnios Int?` (pisa al rubro), `valorTerreno Decimal @default(0)` (solo inmuebles: la parte del costo que es terreno, no se amortiza).
- **Años y ejercicios** *(decisión mía)*: la cuota es siempre **anual**, aunque el ejercicio dure menos o más de 12 meses (el primero o un cambio de cierre): no se prorratea. Se cuentan **ejercicios fiscales**. Los ejercicios anteriores al primero cargado en el sistema se suponen de 12 meses con el mismo mes de cierre que el primero (así se cuentan los años de los bienes con alta anterior al sistema).
- **Bienes muebles** (`MUEBLE` y `AUTOMOVIL`): cuota anual = valor actualizado / vida útil en años. El **ejercicio del alta se amortiza completo** y el **ejercicio de la baja no se amortiza** (criterio del decreto reglamentario). Años amortizados = ejercicios desde el del alta hasta el anterior al consultado; la cuota del último año es el remanente (no se pasa del valor).
- **Inmuebles** (`INMUEBLE`): cuota anual = (valor actualizado − terreno actualizado) × 2 % (50 años, art. 83), salvo que el rubro o el bien indiquen otra vida útil. En el ejercicio del alta se computan los **trimestres** desde el del alta inclusive (trimestres del ejercicio); el de la baja no se amortiza.
- **No amortizable** (terrenos, obras en curso): sin cuota; aparece en la planilla con valor residual = valor actualizado.
- **Automóviles** (art. 88 inc. l) *(decisión mía)*: deducible = cuota × mín(1, tope / valor de origen histórico), es decir la amortización que correspondería a un automóvil que costó el tope (proporcional, comparando contra el costo histórico neto de IVA). Un solo **tope** configurado (`ConfigImpuestos.topeAutomovilesCosto`, por defecto 20.000, a verificar), el vigente al consultar. La diferencia con la cuota total es **no deducible**. El tope **no** cambia el valor residual: la acumulada incluye la parte no deducible.
- **Actualización** (art. 87 y 93, bienes adquiridos en ejercicios iniciados desde el 1/1/2018): coeficiente = IPC del mes de cierre del ejercicio consultado / IPC del mes de alta (índices de *Contabilidad › Índices*). *(Decisión mía)* Se mira el **inicio del ejercicio del alta** (el del sistema, o el supuesto según la regla de años y ejercicios); si empezó antes del 1/1/2018: coeficiente 1 (sin actualización). Si falta un índice: error `Faltan los índices de: mm/aaaa, …`.
  - La cuota del año = valor de origen actualizado / vida útil; la acumulada anterior se informa en valores actualizados al cierre (cuota del año × años amortizados, con el tope del valor actualizado).
- **Valor residual impositivo** al cierre = valor actualizado − acumulada actualizada (incluida la del año). Para los dados de baja en el ejercicio: valor residual a la fecha de baja = valor actualizado al mes de la baja − acumulada hasta el ejercicio anterior **recalculada con el mismo coeficiente del mes de la baja** *(decisión mía: misma unidad de medida en los dos términos)* (sin cuota del año de baja); es el costo computable de la venta.
- Bienes con alta en el sistema por saldo inicial (`origen` inicial): se calculan igual, desde su fecha de alta; los datos contables iniciales (`amortizacionInicial`) no intervienen.
- Redondeo a 2 decimales en cada cuota.

## 4. Planilla impositiva (`GET /api/bienes-uso/planilla-impositiva?ejercicioId=`)
- Permiso `bienes.ver` (el mismo de la planilla contable).
- Por bien (agrupado por rubro, con subtotales y total): número, descripción, fecha de alta, fecha de baja, tipo, vida útil en años, valor de origen, coeficiente, valor actualizado, años amortizados antes, amortización acumulada anterior, cuota del ejercicio, no deducible (automóviles), acumulada al cierre, valor residual, **amortización contable del ejercicio** (de los procesos vigentes, **en valores nominales**, como la planilla contable sin reexpresar) *(decisión mía: es el gasto de amortización que está en el Mayor; el ajuste por inflación contable y el impositivo se tratan en las entregas 45 y 46)* y **diferencia** (impositiva deducible − contable).
- Total del ejercicio: impositiva deducible, contable y diferencia (lo que usará la DJ de la entrega 46).
- Exportar a Excel (`formato=xlsx`).
- Avisos: bienes de rubros sin vida útil impositiva que usan la contable redondeada (`Se usa la vida útil contable de: <rubros>`), inmuebles sin terreno cargado (`Revise el valor del terreno de: <bienes>`).

## 5. Pantallas
- *Bienes de uso › Planilla impositiva*: elegir ejercicio, tabla por rubro con los totales, avisos, exportar a Excel.
- *Bienes de uso › Rubros*: vida útil impositiva (años) y tipo impositivo.
- Ficha del bien: vida útil impositiva (años) y valor del terreno (si el rubro es inmueble).
- *Impuestos › Configuración*: tope de costo de automóviles.

## 6. Fuera de alcance
- Reemplazo de bienes (art. 67, opción de afectar el resultado de la venta al costo del nuevo bien).
- Amortización acelerada de regímenes promocionales.
- Bienes con alta anterior a 2018 actualizados por las tablas antiguas (quedan sin actualización).
- La DJ de Ganancias (entrega 46).

## 7. Datos a verificar (van a `docs/pendientes.md` §2)
- Tope de costo de automóviles vigente (art. 88 inc. l) y si se actualiza.
- Criterio del trimestre de alta para inmuebles y año completo para muebles contra el decreto reglamentario vigente.
- Si la amortización no deducible de automóviles reduce o no el costo computable en la venta.
- Que el índice de actualización sea el IPC mensual del sistema (tabla de ARCA de coeficientes por mes de alta y mes de cierre).
