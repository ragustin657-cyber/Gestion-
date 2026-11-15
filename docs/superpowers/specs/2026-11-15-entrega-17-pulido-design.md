# Entrega 17 — Pulido de las entregas 13 a 16

## Intención

Dejar sólido lo construido antes de encarar sueldos: corregir lo que da números incorrectos, pierde datos o deja trabado al usuario, de los pendientes menores registrados en las entregas 13 a 16. El usuario delegó la elección y aprobó este alcance.

## Enfoque

Una entrega de arreglos puntuales, cada uno con una prueba que falla antes y pasa después; sin funcionalidades nuevas. Alternativa descartada: repartir los arreglos en las próximas entregas grandes (se mezclarían con normativa nueva y quedarían más tiempo en uso).

## Alcance

1. **Bienes de uso**
   - Venta de un bien: `fechaBaja` = fecha del comprobante de venta (aunque el asiento vaya al período siguiente).
   - Numeración de bienes sin colisiones (numeración atómica, como el resto de los correlativos).
   - Rubro con bienes: no se cambian sus cuentas (`El rubro tiene bienes: no se pueden cambiar sus cuentas`); nombre, vida útil y activo sí.
   - Web: editar (descripción, vida útil, residual; carga inicial también fecha y valores) y eliminar bienes desde la ficha.
   - Venta de bienes también en nota de débito; la lista de bienes activos para vender la puede ver quien tiene `venta.emitir`.
2. **Fechas en hora argentina**: rango por defecto de presupuesto contra real y "hasta" por defecto del flujo calculados con la fecha argentina.
3. **Ventas → Saldos de clientes a una fecha**: usa `saldosAFecha` (saldo reconstruido, sin movimientos posteriores al corte).
4. **Presupuestos**
   - Un solo vigente por ejercicio garantizado por índice único parcial.
   - Tarjeta del tablero: meses hasta el mes de hoy como máximo; el enlace abre el informe con `desde`/`hasta` de la tarjeta.
   - `actualizadoEn` en repartir, traer real, importar y eliminar línea.
   - `centroCostoId` inválido en eliminar línea → 400.
   - CSV separado por coma: importes con formato argentino entre comillas ("1.234,50").
   - Web: confirmación al eliminar; aviso al agregar una línea existente; repartir exige total; ejercicio cerrado en solo lectura.
5. **Flujo**: `agrupar=semana` admite 52 semanas completas desde hoy (la primera semana parcial no cuenta para el límite).
6. **Informes**: las tarjetas del tablero pasan `reexpresar` al informe; título del Excel "Ventas por artículo".

## Fuera de alcance

Centavos de diferencia en remitos facturados en partes y en la reexpresión; 29 de febrero en el año anterior; rendimiento de `saldosAFecha`; migración de cuentas 1.2.02 preexistentes.

## Pruebas

Cada punto con su prueba API o web que falla antes del arreglo; suites API, web y e2e completas al final; revisión independiente.
