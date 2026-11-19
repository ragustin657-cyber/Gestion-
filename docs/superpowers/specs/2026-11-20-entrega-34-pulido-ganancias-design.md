# Entrega 34 — Pulido de Ganancias (menores diferidos de la E33)

## Intención
Corregir los 6 menores que la revisión de la E33 dejó diferidos.

## Alcance (aprobado)
1. **SICORE determinístico:** si un empleado tiene dos liquidaciones con la misma fecha de pago, la línea toma la de mayor número; los renglones se leen ordenados. Se corrige el comentario de `sicore.ts`.
2. **F.1359 sin deducciones generales:** los nombres salen de los empleados de las filas (por `empleadoId`); si no se encuentra uno, se muestra su CUIL. No se cargan todos los empleados.
3. **Concurrencia de la anual:** el encabezado se crea con `upsert` (dos «Calcular» simultáneos no dan 500 aunque no haya `ConfiguracionSueldos`).
4. **Concepto pasado a DESCUENTO por API:** el servidor fuerza `exentoGanancias = false` y rubro nulo.
5. **Aviso de ajuste sin concepto:** dos consultas agrupadas (filas cerradas de todos los empleados y lo aplicado agrupado por empleado y año), sin consultas por empleado.
6. **Final ya cerrada sin ajuste:** en la anual, la fila de un empleado no distracto con una final cerrada pagada en el año siguiente, cuando la anual no está cerrada o se cerró en la fecha de pago o después, lleva el aviso `Su final ya está cerrada: el saldo se retiene o devuelve fuera del sistema` (campo `aviso` en `ver()`), y la pantalla lo muestra en la fila.

## Enfoques
- Elegido: una entrega de pulido con un cambio y su prueba por punto.
- Descartado para el punto 6: reabrir automáticamente la final (toca una liquidación cerrada con asiento y pago).

## No objetivos
Cambios de comportamiento de la anual o del F.1359 más allá de lo listado.
