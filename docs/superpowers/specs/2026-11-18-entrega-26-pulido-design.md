# Entrega 26: Pulido de tarjetas, comisiones y cobranzas

## 1. Objetivo y alcance

Corregir los pendientes menores de las Entregas 23 a 25 que el usuario puede notar: avisos que hoy salen como error del sistema, datos que se pierden o se muestran mal, y una fecha "de hoy" que depende de la zona horaria del navegador.

**Cómo:**
- son arreglos puntuales;
- cada uno lleva una prueba que falla antes;
- no hay modelos nuevos: solo un índice y una migración de permisos.

**Fuera de alcance:**
- lo que es solo documentación (que la ND hereda vendedor y porcentaje);
- las carreras casi imposibles (que se borre la mensual justo mientras se confirman comisiones);
- el descuento de un rechazo un mes antes que su cobro, que se compensa solo;
- la factura con renglones de varios pedidos de distinto vendedor;
- el aviso de que el repositorio se mudó.

**Decisión del usuario:** hacer el pulido. La lista la eligió el builder y el usuario la aprobó.

## 2. Arreglos

### A. Tarjetas (E23)

1. **Caja en dólares.** En el ingreso de valores, al cambiar a una caja que no es en pesos se vacían los cupones cargados. Hoy quedan ocultos pero se envían, y la API responde 400.
2. **Liquidación tras un refresco.** El formulario envía solo los cupones tildados que siguen en la lista de pendientes. Los que desaparecieron (por ejemplo, porque otro usuario ya los liquidó) se destildan.
3. **Fecha de la liquidación.** Tiene que ser igual o posterior a la del cupón más nuevo, si no: 400 `La liquidación no puede ser anterior al cupón N (dd/mm/aaaa)`.
4. **Tarjetas con el mismo nombre.** Dos altas simultáneas con el mismo nombre dan 400 `Ya existe la tarjeta X` en vez de un error del sistema.

### B. Comisiones (E24)

5. **Concepto configurado.** No se puede desactivar el concepto de comisiones configurado en sueldos: 400 `Es el concepto de comisiones de vendedores: elija otro en la configuración de sueldos antes de desactivarlo`.
6. **Vendedor del pedido.** Un pedido sin vendedor indicado toma el del cliente solo si está activo; si no, queda sin vendedor, igual que la factura.
7. **Índice.** Se agrega un índice en `Novedad(liquidacionComisionesId)`.
8. **Permisos de empresas existentes.** La migración agrega `venta.maestros` y `comisiones.liquidar` a los roles Administrador que no los tengan.
9. **Pantalla de comisiones:**
   - la tabla muestra la columna "%": el porcentaje del vendedor, o "varios" si sus renglones tienen distintos;
   - el diálogo del PDF ofrece solo los vendedores externos que tienen renglones en esa liquidación. Para eso el historial devuelve `externos: { vendedorId, nombre }[]` en cada liquidación.

### C. Cobranzas (E25)

10. **Validaciones de la gestión:**
    - las fechas deben existir: el 30/02 da 400 `Fecha inválida`;
    - el importe prometido tiene como máximo 2 decimales y un tope de 999.999.999.999,99. Si no cumple: 400 `Importe inválido`.
11. **Promesas del mismo día.** Si dos gestiones con promesa tienen la misma fecha, la anterior no pierde los cobros de ese día. Su ventana termina en la próxima gestión con promesa de **fecha posterior**. Si no hay ninguna, la anterior queda sin fin de ventana mientras no sea la vigente.
12. **Datos que faltan en pantalla.** La agenda muestra la columna "Por vencer", y el historial de la ficha muestra el usuario que cargó cada gestión (el nombre, no el id).
13. **Ficha sin datos.** Si el cliente no existe o no hay permiso, la ficha muestra un aviso con el mensaje de la API en vez de quedar en blanco.
14. **Prueba nueva:** un cobro anulado no cumple la promesa.

### D. General

15. **Fecha "de hoy" en la web.** `hoy()` de `apps/web/src/compras/formato.ts` usa la zona `America/Argentina/Buenos_Aires` en vez de la del navegador. Es la misma que usa la API. Así, quien trabaja de noche o fuera del país no carga fechas del día siguiente ni del anterior.

## 3. Pruebas

- Una prueba por arreglo, que falla antes.
- API e2e para 3, 4, 5, 6, 8, 9 (datos del historial), 10, 11 y 14.
- Web para 1, 2, 9 (columna), 12, 13 y 15.
- El índice (7) y la migración de permisos (8) se verifican sobre la demo.
- Al final, suites completas en verde: API en dos mitades, web y build, y e2e con base nueva.

## 4. Lo que queda al builder

- El orden y el agrupamiento de las pruebas.
- Los textos de los errores secundarios.
