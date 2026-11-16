# Entrega 22: Pulido de sueldos

## 1. Objetivo y alcance

Corregir los pendientes menores de las Entregas 18 a 21 que pueden dar importes incorrectos, perder datos o trabar al usuario. Son arreglos puntuales en los módulos existentes, cada uno con su prueba que falla antes. No hay modelos nuevos; solo dos columnas de copia.

**Fuera de alcance:**
- consultas N+1 del listado de saldos de vacaciones;
- verificación del F.931 contra el manual de ARCA;
- Libro de Sueldos Digital.

## 2. Arreglos

### A. Importes

1. **Neto negativo.**
   - `montoEnLetras` admite importes negativos: `menos pesos … con NN/100`. El recibo PDF muestra el neto negativo con signo.
   - Los recibos con neto ≤ 0 no cuentan como pendientes de pago: no suman a `pendientePago`, figuran en la web como "Sin neto a pagar" y "Pagar todos" no los ofrece.
2. **Ausencias topeadas.** Los días de ausencia injustificada no pueden superar los días trabajados del mes. Al guardar novedades con más: 400 `Las ausencias (N días) superan los días trabajados del mes (M)`.
3. **"Veintiún millones"** con tilde (21.000.000, 121.000.000, etc.).

### B. Concurrencia

4. **Bloqueos que faltan:**
   - `EgresosService.modificar` y la eliminación de una final bloquean la fila de la liquidación y releen su estado;
   - crear, modificar y eliminar un período de vacaciones bloquean la mensual (y la final del empleado, si existe) de su mes de inicio antes de validar;
   - `reabrir` ya bloquea la configuración; además, `pagarCargas` bloquea las liquidaciones del mes antes de leer lo devengado.
5. **Ver un borrador al mismo tiempo.** El recálculo de un borrador al consultarlo (GET) bloquea la fila de la liquidación, así dos consultas simultáneas no chocan con el índice único (liquidación, empleado). Dos GET simultáneos responden 200.

### C. Copias al cerrar

6. **Forma de pago en el recibo.** `ReciboSueldo.formaPago` (copia, nullable) se graba al calcular. El PDF la usa. Los recibos existentes se completan con la del empleado en la migración.
7. **Parámetros del F.931.** `Liquidacion.baseMaximaAportes` y `Liquidacion.detraccion` (copia, nullable) se graban al cerrar. El F.931 los usa si están; si no (liquidaciones cerradas antes de esta entrega), los vigentes.

### D. Datos y validaciones

8. **Conceptos de Comercio por convenio.** Los conceptos 120, 530 y 540 (presentismo, FAECYS y sindicato) quedan con el `convenioId` de Comercio: en la precarga y, por migración, en las empresas existentes, solo si siguen sin convenio. Así no se aplican a un segundo convenio.
9. **Cuenta del concepto.** Al crear o modificar un concepto con `cuentaContableId`, la cuenta debe ser imputable y activa: `Cuenta contable inválida: debe ser imputable y activa`.
10. **Novedades de una final.** Solo para su empleado: `La liquidación final es de otro empleado`.
11. **Saldo inicial de vacaciones.**
    - El año debe ser igual o posterior al de ingreso: `El año es anterior al ingreso del empleado`.
    - Si dos cargas chocan con el índice único, se responde 400 `Reintente: el saldo se modificó al mismo tiempo` en vez de 500.
12. **Vacaciones y liquidación final.**
    - Un período cuyo mes de inicio tiene la final del empleado cerrada se rechaza (salvo `liquidadoAfuera`): `La liquidación final de MM/AAAA ya está cerrada: marque el período como liquidado fuera del sistema o reábrala`.
    - Con la mensual cerrada y la final del empleado en borrador en ese mes, el período se acepta: lo paga la final.
13. **Eliminar una final con la mensual del mes cerrada.** Se rechaza: `La liquidación mensual de MM/AAAA ya está cerrada: el empleado quedaría sin recibo de ese mes. Reábrala antes de eliminar la final`.
14. **Ingreso un 29/02.** `sumarMeses` usa el mismo criterio que el aniversario: un 29/02 en un año no bisiesto pasa al 1/3.
15. **Migración de cuentas hijas** (la de la Entrega 19 ya corrió y no se toca). Las migraciones nuevas de esta entrega verifican nombre y tipo de la cuenta padre antes de crear cuentas debajo. Esta entrega no crea cuentas: queda como regla en `docs/` y no lleva código.
16. **Aviso de conceptos de vacaciones faltantes.** `GET /api/sueldos/conceptos/avisos` (`sueldos.ver`) devuelve `string[]`.
    - Incluye `Faltan los conceptos de vacaciones (pago y descuento): las vacaciones no se liquidan` cuando falta el concepto de vacaciones de pago o el de descuento, o uno de los dos está inactivo.
    - La pantalla de conceptos muestra los avisos.
    - Es un endpoint aparte para no cambiar la forma de la lista de conceptos.

### E. Web

17. **Novedades de importe:** el panel de novedades permite cargar importes para los conceptos `FIJO` del convenio (lista de conceptos fijos con su importe).
18. **"Pagar seleccionados"** limpia la selección solo al confirmar el pago, no al abrir el diálogo.
19. **Vacaciones:** campo de observaciones en el período y confirmación al eliminar (`¿Eliminar el período del dd/mm al dd/mm?`).
20. **Ficha del empleado:** también muestra los años que solo tienen saldo inicial.
21. **Refresco:** un pago de sueldos invalida la consulta de cargas sociales.

### F. Textos y documentación

22. **Asiento del pago de una final:** `Pago de sueldos N° X - Final MM/AAAA - Apellido, Nombre`.
23. **README, sección de desarrollo:**
    - el índice parcial `Liquidacion_mensual_sac_unica` que `prisma migrate diff` propone borrar (hay que quitar ese DROP a mano);
    - la regla de verificar la cuenta padre en las migraciones de datos.

## 3. Pruebas

Una prueba por arreglo, que falla antes:
- unitarias para 1 (letras), 3 y 14;
- e2e de API para el resto;
- de web para 17 a 21.

Al final, suites completas en verde: API en dos mitades, web y build, y e2e con base nueva.

## 4. Lo que queda al builder

- **Pruebas:** el orden y el agrupamiento.
- **Textos:** los de errores secundarios.
