# Entrega 42 — Pulido de las entregas 38 a 41

## 1. Intención
Corregir los menores diferidos en las revisiones de las entregas 38 (IIBB CM), 39 (percepciones en ventas), 40 (prorrateo de IVA) y 41 (despachos) que afectan lo que ve o carga el usuario o la consistencia de los datos. Cada uno con una prueba que falla antes.

## 2. Correcciones

### Configuración e impuestos
1. **Cambios de configuración contra cierres simultáneos (E38, E40).** `ConfigImpuestosService.guardar` corre en una transacción que toma los locks exclusivos `posicion-iva:<empresa>` y `posicion-iibb:<empresa>` antes de contar posiciones cerradas: un cierre simultáneo espera o ve el cambio. Prueba: con el lock tomado por otra transacción, `guardar` espera (o: el conteo se hace dentro de la transacción; prueba de concurrencia con `Promise.all` de cerrar y cambiar el inicio: nunca queda un mes cerrado con un inicio posterior a él).
2. **Liquidación de IIBB cerrada sin avisos (E38).** `PosicionIibb.avisos Json @default("[]")` guarda los avisos del cierre (por ejemplo, el saldo de una jurisdicción que sale del Convenio) y la vista del mes cerrado los muestra.
3. **Tabla de meses de IIBB (E38).** Muestra *A pagar* y *A favor* juntos cuando hay los dos (no solo uno).
4. **Informe por provincia: fila Total (E38).** El porcentaje del total es la suma de los porcentajes de las filas (o `0,00 %` con total 0), no un 100 fijo.
5. **Coeficiente con ventas netas negativas (E40).** Aviso `Las ventas del ejercicio son negativas: el coeficiente se acota a 1` (o a 0) cuando el acumulado gravado o el total son negativos.
6. **Cambiar el destino del crédito de una compra anulada (E40).** 400 `Solo se cambia el destino de una compra confirmada`.
7. **Exportación de la posición de IVA (E40).** Las filas del prorrateo van junto al crédito fiscal (después de *Total crédito fiscal*), como en pantalla.

### Ventas y percepciones (E39)
8. **Formulario de la factura con percepciones viejas.** Si los renglones cambiaron desde lo guardado, la grilla no suma las percepciones guardadas y muestra `Las percepciones se recalculan al guardar`.
9. **Un solo régimen de percepción de IVA activo.** El alta y la modificación toman un advisory lock `regimen-percepcion-iva:<empresa>`; dos altas simultáneas no quedan activas a la vez.
10. **Orden de las percepciones en el PDF.** Por tipo, jurisdicción y tramo, como en el CAE.
11. **Clave repetida en la grilla.** La clave de cada percepción incluye el tramo.

### Despachos (E41)
12. **Despacho duplicado simultáneo.** El índice único traduce a `Ya existe el despacho <número>` (no el 409 genérico).
13. **Primeros despachos simultáneos.** La búsqueda o alta del tercero de la Aduana toma un advisory lock `aduana:<empresa>`: los dos despachos se registran.
14. **Alícuotas del despacho.** Solo 21 % y 10,5 % (spec E41): `El despacho admite alícuotas de 21 % y 10,5 %`.
15. **Tipo legible en el Excel/PDF del Libro IVA Compras de impuestos.** Columna comprobante con la etiqueta (`Factura A 00001-…`, `Despacho <número>`) en lugar del tipo en crudo.
16. **Anular un despacho en un mes abierto.** Prueba de contraasiento y cuenta corriente en cero (hoy sin cobertura).

## 3. Quedan en pendientes (no se hacen)
- Cadena de borradores de más de 24 meses (IVA e IIBB) y costo del borrador del último mes con prorrateo (rendimiento).
- Meses de IVA cerrados antes de la E38 sin el IVA de tarjetas (ajuste manual, documentado).
- Saldo inicial de IIBB al mover el año de inicio (aviso).
- Alícuota de percepción con 4 decimales y ARCA con 2.
- Migraciones que reusan una cuenta existente con el mismo código.
- Letra C en el coeficiente de prorrateo.
- Fecha contable del despacho distinta de la oficialización; volver a cargar un despacho anulado con el mismo número.
- Pruebas e2e del ajuste julio–junio y del no computable negativo (cubiertas por pruebas unitarias).

## 4. Fuera de alcance
Funciones nuevas.
