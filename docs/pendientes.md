# Todo lo que falta hacer

Relevamiento al 20/11/2026, después de mergear la entrega 35. Sale de cuatro fuentes:
- **Temas no construidos:** el diseño general del sistema y las secciones de alcance excluido, no objetivos y pendientes a verificar de todas las specs (`docs/superpowers/specs`).
- **Menores diferidos:** las 231 observaciones menores que las revisiones finales dejaron diferidas de la entrega 1 a la 35. Se cruzaron con lo que resolvieron las entregas de pulido (17, 22, 26, 29, 33 y 34).
- **Datos provisionales:** marcados así en el código.
- **Decisiones con costo:** las que las propias entregas registraron.

Antes de arrancar cada ítem conviene confirmarlo en el código. La clasificación de los menores como resueltos o pendientes se hizo comparando con las specs de los pulidos, no revisando el código uno por uno.

---

## 1. Temas nuevos que no están construidos

### 1.1 Impuestos (lo más cercano a lo que ya existe)

1. **Posición mensual de IVA y datos para la DJ F.2002.** Débito fiscal − crédito fiscal − retenciones y percepciones sufridas − saldo a favor anterior → saldo a pagar o a favor. Hoy hay libros de IVA y Libro IVA Digital, pero no el saldo del mes. *(Recomendado como próximo.)*
2. **Ingresos Brutos por Convenio Multilateral.**
   - Coeficientes anuales (CM05).
   - Base imponible e impuesto por jurisdicción de cada mes, para cargar en SIFERE (CM03).
3. **Percepciones practicadas en las facturas de venta**, de IVA y de IIBB (excluidas en las entregas 6 y 7).
4. **Otras jurisdicciones de IIBB.** Hoy solo están ARBA (902) y AGIP (901). Faltan SIRCAR, SIRCREB y los padrones de otras provincias.
5. **Prorrateo del crédito fiscal de IVA**, para empresas con operaciones exentas y gravadas.
6. **Importaciones con despacho de aduana:** IVA, percepciones y su lugar en el Libro IVA.
7. ~~**Notas de crédito de retenciones y anulaciones por lote en el SIRE.**~~ Hecho en la entrega 43.
8. ~~**F.2003 del SIRE:** Ganancias a beneficiarios del exterior.~~ Hecho en la entrega 43.
9. **Ganancias de sociedades y Bienes Personales (acciones y participaciones).** Hoy no está ni la DJ, ni los anticipos, ni el responsable sustituto.
10. ~~**Ajuste por inflación impositivo** (Título VI de Ganancias).~~ Hecho en la entrega 45.
11. ~~**Amortización impositiva** de bienes de uso.~~ Hecho en la entrega 44.
12. **Presentación automática en los sitios de los organismos.** Hoy se generan los archivos y el usuario los sube.

### 1.2 Ventas y facturación

13. **Factura de crédito electrónica MiPyME (FCE).** Además, sus códigos (201, 206 y otros) no se emparejan en el control con «Mis Comprobantes».
14. **Factura de exportación (E).**
15. **Facturación por lotes.**
16. **Descuentos y bonificaciones** en la factura, por renglón y por cantidad.
17. **Listas de precios derivadas y precio calculado desde el costo.**
18. **COT de ARBA** (código de operación de traslado para los remitos).
19. **Remitos de devolución** con circuito propio.
20. **Reservas de stock.**

### 1.3 Stock y producción

21. **Lotes, números de serie y vencimientos.**
22. **Producción:** fórmulas y órdenes de producción.
23. **Costo por depósito.**
24. **Devolución física al proveedor ligada a la nota de crédito de compra.** Hoy se registra como salida manual.

### 1.4 Compras, pagos y tesorería

25. **Pagos masivos** y **pago por archivo bancario** (interbanking).
26. **e-cheq y extractos por API bancaria.** Hoy los extractos se importan en CSV o XLSX.
27. **Extractos en PDF** para la conciliación.
28. **Conciliación de cajas**, y conciliación con conversión entre monedas.
29. **Fondos fijos con rendición formal.**
30. **Aprobación multinivel** de órdenes de compra y de pago.
31. **Validación de CAE de comprobantes de compra contra ARCA.**

### 1.5 Contabilidad y gestión

32. **Estados contables completos:** evolución del patrimonio neto, flujo de efectivo, notas y anexos. Hoy salen como datos para el contador.
33. **Consolidación de empresas.**
34. **Distribución automática de resultados.** Hoy se hace con un asiento manual.
35. **Presupuesto financiero y de cuentas patrimoniales**, en moneda de hoy, con circuito de aprobación y por artículo o cliente.
36. **Informes en dólares, envíos programados y tableros configurables.**
37. **Escenarios en el flujo de fondos**, con impuestos y sueldos proyectados y la demora habitual de cada cliente.
38. **Bienes de uso:** revalúo técnico, bienes en moneda extranjera, componentes, mejoras que extienden la vida útil y centro de costo por bien.

### 1.6 Sueldos

39. **Generación del VEP** del F.931.
40. **Embargos y asignaciones familiares** pagadas por el empleador.
41. **Reducciones de contribuciones** por regímenes promocionales. Hoy solo se informa el código.
42. **Liquidación final:** faltan el certificado de trabajo (art. 80), las multas e indemnizaciones agravadas, el descuento por falta de preaviso del empleado, el fallecimiento (art. 248) y la jubilación.
43. **Vacaciones:** fraccionadas o adicionales por convenio, licencias especiales, solicitudes con aprobación, calendario de feriados y cómputo en días hábiles.
44. **Liquidaciones quincenales, por día o por hora.**
45. **Libro de Sueldos Digital:** registros 05 (eventuales) y 06 (observaciones), y el envío rectificativo `RE`.
46. **Ganancias de cuarta:**
   - presentación informativa (tipo 3);
   - rectificativas del F.1359 y envío por webservice;
   - regímenes especiales: actores, petroleros de pozo, Tierra del Fuego, Antártida, poder judicial, jubilados y zona patagónica;
   - deducción del 10 % del alquiler;
   - autorretención;
   - retribuciones no habituales separadas;
   - beneficios y ajustes del F.572 (secciones 5 y 6).

### 1.7 Cobranzas, comisiones, tarjetas y correo

47. **Comisiones:**
   - escalas por monto;
   - porcentaje por artículo o rubro;
   - comisión sobre lo facturado o sobre el margen;
   - varios vendedores por factura;
   - objetivos de venta;
   - asiento contable propio.
48. **Cobranzas:** cobradores asignados por cliente, y bloqueo de ventas por deuda o por límite de crédito.
49. **Intereses:** tasas por cliente o por tramo, interés compuesto e intereses sobre cheques rechazados.
50. **Tarjetas:**
   - importar liquidaciones (Prisma, Fiserv, Mercado Pago);
   - conciliación automática;
   - contracargos;
   - cuotas con tasa a cargo del comercio;
   - pagos con tarjeta corporativa.
51. **Correo:** envíos programados, servicios de envío masivo, confirmación de lectura y mails con facturas o recibos.

### 1.8 Plataforma

52. **Monedas además de ARS y USD.**
53. **App móvil.**

---

## 2. Datos provisionales o a verificar con los organismos

1. **SIRE:**
   - códigos de régimen de IVA (impuesto 216) y de SUSS (impuesto 353), que se cargan a mano porque no se pudo descargar la tabla de ARCA;
   - porcentajes y mínimos precargados;
   - qué regímenes de IVA exigen el campo CONDICIÓN.
2. **SiRADIG (F.572):**
   - etiquetas del XML;
   - códigos de tipo de deducción, de parentesco y de pagos a cuenta.

   Se verifican con un XML real.
3. **F.1359:** el signo de los importes negativos del registro 08. Se verifica con la primera presentación real.
4. **SICORE:**
   - posiciones 45 a 145 del formato de importación, que siguen el estándar de mercado y hay que verificar en el aplicativo;
   - códigos para sueldos (comprobante 7, régimen 160, documento 86).
5. **F.931:** el diseño contra el manual de ARCA. Quedó fuera de alcance en la entrega 22. El Libro de Sueldos Digital sí se verificó en la entrega 30.
6. **Ganancias:** topes y porcentajes del art. 85 y de la RG 4003, y las tablas semestrales. Se cargan en pantalla.
7. **Regímenes de Ganancias (RG 830), su escala y la configuración de IIBB precargados:** la pantalla ya pide verificarlos.
8. **Percepciones en ventas (entrega 39):**
   - diseño del lote de percepciones de ARBA (61 posiciones: CUIT con guiones, fecha, tipo y número de comprobante, base e importe con signo, tipo de operación), contra el instructivo de ARBA;
   - códigos de tributo de ARCA para el CAE (7 percepción de IIBB, 6 percepción de IVA), contra `FEParamGetTiposTributos`;
   - archivo de notas de crédito de e-ARCIBA (hoy se cargan a mano con el informe de percepciones practicadas);
   - lote del SIRE para las percepciones de IVA (hoy se cargan a mano con el informe) y el código de régimen de percepción de IVA.
9. **Prorrateo del crédito fiscal (entrega 40):** cómo se declara el prorrateo en el Libro IVA Digital (hoy el archivo lleva el IVA entero de cada compra y la generación avisa declarar el prorrateo global con el coeficiente).
10. **Despachos de importación (entrega 41):** en el Libro IVA Digital, si el importe total del despacho es lo liquidado o incluye la base, y si derechos y tasa van en «otros tributos»; y el diseño del archivo de alícuotas de importaciones (COMPRAS_IMPORTACIONES: despacho, base, alícuota, impuesto).
11. **SIRE completo (entrega 43):**
    - tabla de motivos de anulación del F.2005 (hoy se configura un código, por defecto 1);
    - códigos de régimen del impuesto 218 y de las tablas ALICUOTA_SIN_CDI y ALICUOTA_CON_CDI (se cargan a mano en cada régimen exterior);
    - tabla PAIS del SIRE (los códigos de país se cargan a mano en la ficha del proveedor);
    - cómo devuelve ARCA los números de certificado al procesar el lote (hoy se cargan a mano en *Retenciones practicadas*), y el formato del número de nota de crédito (hoy `00001-` + número de la orden de pago).
12. **Amortización impositiva (entrega 44):**
    - tope de costo de automóviles vigente (art. 88 inc. l; hoy 20.000 por defecto, configurable) y si la amortización no deducible reduce el costo computable en la venta;
    - criterio de año completo de alta para muebles y de trimestres para inmuebles, contra el decreto reglamentario vigente;
    - que el coeficiente de actualización sea el cociente de IPC del sistema (mes de cierre / mes de alta) y no la tabla de ARCA;
    - bienes de ejercicios iniciados antes de 2018: hoy sin actualización.
13. **Ajuste por inflación impositivo (entrega 45):**
    - lista de activos excluidos del art. 106 y si las previsiones van al pasivo (hoy se marcan a mano en el plan de cuentas; bienes de uso ya excluidos);
    - prueba de los 36 meses con el IPC del sistema (mes de cierre contra 36 meses antes, umbral 100 %);
    - momento del ajuste de los dividendos (hoy la fecha del asiento) y de las ventas de bienes excluidos (hoy el valor neto contable que sale del Mayor);
    - valuación impositiva de bienes de cambio y moneda extranjera: hoy partidas manuales.

---

### Menores de las entregas 38 a 41 que siguen pendientes (después del pulido de la entrega 42)
- Cadena de borradores de más de 24 meses (IVA e IIBB) y costo del borrador del último mes con prorrateo (rendimiento).
- Meses de IVA cerrados antes de la entrega 38 sin el IVA de tarjetas (ajuste manual).
- Saldo inicial de IIBB al mover el año de inicio: sin aviso.
- Alícuota de percepción con 4 decimales y ARCA con 2.
- Migraciones que reusan una cuenta existente con el mismo código (5.2.14, 5.1.02, etc.).
- Letra C en el coeficiente de prorrateo.
- Fecha contable del despacho distinta de la oficialización; volver a cargar un despacho anulado con el mismo número.
- Pruebas e2e del ajuste julio–junio y del no computable negativo (cubiertas por pruebas unitarias).

## 3. Observaciones menores pendientes (139 de las 231)

Son observaciones menores de las revisiones finales que todavía no resolvió ningún pulido. Están agrupadas por módulo.

### 3.1 Sueldos
- *Ver cálculo de Ganancias* no se cierra al cambiar de recibo.
- `GET /sueldos/cargas-sociales/pagos` con un mes no numérico da error 500.
- Recibo en PDF de altura fija: con más de unos 25 renglones pisa el duplicado.
- Al crear un concepto todavía se acepta uno de descuento marcado como exento y con rubro. Solo la edición lo corrige.
- Al volver a descargar una liquidación vieja, la fecha de inicio puede tomar la de un reingreso posterior.
- El aviso de final ya cerrada en la anual mira solo las finales pagadas en el año siguiente.
- El error de cantidad fuera de rango no nombra el concepto.
- La marca de exento de Ganancias de un concepto se aplica también a recibos ya cerrados.
- El panel de novedades muestra conceptos fijos de todos los convenios: los de otro convenio se guardan pero no se liquidan.
- Horas extra o vacaciones sin cantidad guardada salen con `00000` en el Libro, y ARCA exige la cantidad.
- La web guarda el Libro como `LSD-AAAAMM.txt`, así que dos del mismo mes se pisan en Descargas.
- Mover un período de vacaciones entre meses bloquea en dos tandas: hay un posible bloqueo mutuo con una edición inversa (un 500 y reintento).
- Las observaciones de vacaciones no tienen el límite de 200 caracteres en la web.
- Si el concepto 560 no tiene cuenta, el asiento usa la de cargas sociales sin avisar.
- Si la mensual se borra entre el bloqueo y la lectura, sale un 500.
- El GET de un borrador puede devolver «Borrador» si esperó a un cierre en curso.
- *'descuenta'* se interpreta distinto en el código ARCA por defecto, el cálculo y la migración para valores no booleanos.
- Faltan pruebas:
  - reabrir y volver a cerrar la anual con la final de abril;
  - que el distracto no muestre aviso;
  - el SICORE con tres liquidaciones el mismo día.

  Además, la prueba de dos «Calcular» simultáneos depende de cómo se intercalen.
- El PDF de presupuesto tiene solapamiento al final de página, no repite el encabezado en la continuación y en el presupuesto B muestra precios netos.
- La importación CSV no acepta separador de miles, `;` al final, comillas, ni encabezado después de una línea vacía.
- En un CSV separado por coma, `"1.234"` entre comillas se lee como 1,234.

### 3.2 Ganancias y retenciones
- Las retenciones de IVA y SUSS:
  - una factura pagada en dos órdenes puede retener 0,01 más que pagada entera;
  - el PDF dice «factura» también en las notas de débito y muestra la fecha en formato ISO;
  - el tooltip muestra la exclusión con formato de moneda.
- Faltan pruebas:
  - una factura en dólares con cotizaciones distintas;
  - generar el SIRE, anular la orden de pago y volver a generarlo;
  - una nota de crédito sin factura asociada, probada a nivel API.
- El XML del F.572 pierde sin aviso parentescos desconocidos y períodos sin mes. Al confirmar, una presentación más vieja puede reemplazar a una corregida.
- La hoja de Ganancias no muestra el impuesto calculado ni por qué una devolución quedó limitada.
- Las pantallas de tablas y de F.572 muestran «sin cargar» ante un error de red, en vez del error.
- No se valida el depósito en la factura de compra ni en la nota de crédito con devolución: un identificador ajeno crea un saldo fantasma.

### 3.3 Contabilidad, ajuste por inflación y bienes de uso
- Configuración del ajuste:
  - al cambiar de ejercicio no se limpian la anticuación ni el asiento;
  - el tramo por defecto 12/(año − 1) y un importe vacío dan 400.
- Libro IVA:
  - las filas en dólares pueden diferir en centavos del total en pesos;
  - las facturas anuladas desaparecen de su período original;
  - una factura en dólares con dos alícuotas puede diferir en 0,01 entre el libro y el mayor, y dar un aviso falso.
- La cuenta corriente con fecha «desde»:
  - no tiene saldo inicial y omite los pagos de documentos anteriores;
  - para abrir las filas de órdenes de pago hace falta el permiso `op.ver`.
- El control de valuación incluye los asientos de ajuste por inflación, así que después del ajuste no da 0.
- El rol Facturación de demos ya existentes no recibe `intereses.liquidar`. Solo el Administrador lo recibe por migración.
- Un índice único parcial podría borrarse en una migración futura generada automáticamente.
- La anulación de un ajuste se numera en el Diario antes que el ajuste.
- La configuración se puede editar con ajustes vigentes, sin bloqueo ni auditoría.
- Migraciones que asocian cuentas por código sin verificar el nombre:
  - RECPAM y resultados no asignados;
  - cuentas hijas bajo un 2.1.03 existente;
  - 1.1.05 marcada como no monetaria;
  - costo de mercaderías vendidas asociado a 5.1.01;
  - subcuentas colgadas de una 1.2.02 preexistente con otro uso;
  - la migración no agrega 150 y 151 a empresas que ya usan esos códigos, y no avisa.
- La prueba de numeración simula el talonario en vez de correr la migración.
- El orden de los imports en `bienes.service.ts`.
- Plan de cuentas:
  - la pantalla no permite crear cuentas raíz;
  - se pueden cambiar cuentas que ya están referenciadas;
  - se pueden quitar todos los permisos de administración.
- Redondeo:
  - la reexpresión redondea por renglón antes de sumar;
  - los totales del comparativo reexpresado se redondean aparte de las filas.
- Las rutas web de índices y de ajuste por inflación son distintas de las de la spec.
- La huella del Libro IVA Digital toma los bytes del ZIP: una actualización de la biblioteca podría marcar como cambiadas presentaciones viejas.
- El asiento de diferencia de cambio de la aplicación automática de una nota de crédito usa la fecha de la nota, no la corrida cuando su mes se cerró durante la emisión.
- Un ajuste complementario del año N con ajustes en N+1 no se puede anular sin anular antes los de N+1.
- Una cuenta de ajuste puede pasar después a monetaria o tener otro tipo que su cuenta.
- El año anterior de un febrero bisiesto omite el 29.

### 3.4 Compras, pagos, tesorería y conciliación
- El «disponible» se compara con valor absoluto: podría admitir importes si lo comprometido superara el saldo.
- `CorreoModule` se importa dos veces. Es inofensivo.
- Los códigos FCE MiPyME de «Mis Comprobantes» no se emparejan con compras cargadas como factura A o B.
- La edición de una orden de pago no controla la versión: dos personas editando se pisan.
- Por API se puede dejar un tercero sin marcar como proveedor ni como cliente.
- El selector de cheques suma pesos y dólares bajo un mismo total.
- Una factura en dólares puede tomar renglones de una orden de compra en pesos, y el selector muestra esos precios con «$».
- Una caja con efectivo o cheques todavía puede cambiar de moneda o de sucursal desde maestros.
- Una transferencia recibida no se puede anular sin anular el ingreso completo.
- Un lote vacío de ARBA consume un número de lote sin avisar.
- Anular o cerrar una orden de compra puede cruzarse con una recepción simultánea.
- La periodicidad de ARBA se guarda, pero no limita ni sugiere la quincena.
- El arqueo ignora su propia fecha y admite cajas inactivas.
- Parámetros de consulta inválidos dan 500 en vez de 400 en listados y pendientes, y también en los filtros de la lista de órdenes de pago.
- Los usuarios de una sucursal pueden acreditar transferencias recibidas de su sucursal.
- Crear una conciliación no toma bloqueo, y los períodos pueden quedar con huecos entre sí.
- El 400 de validación interna no incluye la ruta del campo.
- El selector de endoso del pago de una orden lista todos los cheques en cartera visibles.
- Faltan pruebas:
  - un usuario sin alcance con cupones de dos sucursales;
  - anular con un movimiento conciliado;
  - rechazar un cheque en tránsito;
  - el bloqueo de anulación de una orden de pago en un período cerrado;
  - vincular una línea de otra cuenta bancaria.
- La importación de extractos XLSX:
  - no maneja fórmulas;
  - pierde los ceros de los códigos numéricos;
  - el número de línea no considera el encabezado;
  - no acepta CSV con comillas.
- La e2e de intereses:
  - no cambia la tasa desde la pantalla;
  - no destilda a otros clientes en una base reutilizada;
  - si falla, saltea el grupo general.
- Más decimales que la escala de la columna se guardan redondeados, mientras el importe usa el valor completo.
- El número de IIBB acepta texto libre sin validar el formato: los errores aparecen recién en AGIP.
- El control de sobregiro compara contra el total de hoy, no contra el saldo a la fecha del movimiento.
- El rechazo de un cheque endosado valida la fecha contra la emisión, no contra la fecha de pago de la orden.
- Las coincidencias por referencia en las sugerencias de conciliación no tienen ventana de fechas.
- Cambiar el código de un régimen de Ganancias desvincula sin aviso a los proveedores que lo usan.
- Se pueden crear dos órdenes de pago a la vez sobre el mismo saldo. La revalidación al pagar evita el impacto en dinero.
- Dos importaciones simultáneas del mismo archivo pueden insertar las dos.
- Deshacer una importación puede cruzarse con una vinculación.
- Los errores de configuración de ARCA, como un punto de venta no habilitado, se muestran como «No se pudo conectar con ARCA».
- WSAA:
  - «ya posee un TA válido» bloquea los logins hasta que vence el ticket viejo, tras una respuesta perdida o una recarga de certificado;
  - el guardado del token no es atómico (posible 500).

### 3.5 Ventas, stock y precios
- `GET /ventas/precio` no valida los identificadores (500).
- La aplicación automática de una nota de crédito calcula el mínimo con saldos leídos antes del bloqueo: un recibo simultáneo la hace fallar y revierte la autorización (al reintentar se recupera).
- Listas de precios:
  - carrera al marcar una como «por defecto»;
  - una lista por defecto inactiva deja sin sugerencia.
- Centro de costo, depósito, artículo y comprobante asociado no se validan contra la empresa.
- El costo de un remito facturado en partes redondea por parte (±1 centavo contra el Mayor).
- La cotización tipeada se manda sin procesar al precio sugerido.
- Intereses:
  - el cálculo lee todos los renglones de intereses con nota;
  - recorre toda la historia de facturas en cada consulta;
  - en meses viejos la lista de «posteriores» puede ser grande.
- El kardex calcula el saldo inicial por fecha pero ordena por registro.
- En el PDF de la factura B, los importes por renglón usan el IVA de cada renglón y pueden diferir en centavos del total.
- Facturar una recepción en partes puede dejar centavos en «Mercadería recibida a facturar».
- Faltan pruebas:
  - las pruebas web del precio sugerido en el pedido;
  - dos pruebas de revisión que arman el caso con atajos (saldo cargado por base de datos, un cobro aplicado dos veces);
  - la de saldo inicial concurrente acepta 400, y debería exigir 200 con una sola fila.
- `hoy()` en hora UTC en el servicio de precios.
- La nota de débito hereda el vendedor y el porcentaje de su comprobante asociado, y eso no está documentado.
- La lista de precios del pedido no se valida (podría ser de otra empresa).
- Un pedido sin depósito no avisa el stock.
- Notas de crédito pendientes de distintos puntos de venta contra la misma factura pueden pasar el control de límite en paralelo.
- Precios e historial piden `venta.ver` en lugar de «`venta.ver` o `pedido.gestionar`».
- El remito no verifica que el cliente esté activo.
- El selector de facturación está limitado a 300 pedidos.
- Una nota de crédito o débito de compra mayor que el valor del stock puede dejar valor y promedio negativos.
- Una factura con renglones de pedidos de distinto vendedor toma uno cualquiera.
- Las columnas `vinculoId` no tienen clave foránea ni índice.
- La carrera al desactivar «Controla stock», sin bloqueo del artículo.
- En la factura, cualquier duplicado de base de datos se informa como «Este comprobante ya fue cargado».
- Ventas web: modificar un borrador no devuelve advertencias, y al recargar queda fijo el depósito del punto de venta.

### 3.6 Gestión: presupuesto, informes y flujo
- `actualizadoEn` se actualiza dos veces al guardar una línea y al modificar.
- La regularización de salidas por remito no entra al costo del informe.
- `saldosAFecha` recorre todas las aplicaciones y movimientos sin filtrar: puede volverse lento con mucho historial.

### 3.7 Seguridad, validaciones y web común
- El tiempo de respuesta del login permite averiguar qué emails existen, y no hay límite de intentos.
- Al agregar un email ya existente se muestra el nombre de ese usuario aunque sea de otra empresa.
- `UsuarioEmpresa.sucursalId` no tiene clave foránea.
- La extensión multiempresa no cubre `updateManyAndReturn` ni las escrituras anidadas.
- La web ignora la marca de superadmin, y los permisos quedan en caché hasta volver a elegir la empresa.
- La aplicación de cobros no verifica que los dos movimientos sean de cliente: por API se podría aplicar un recibo a una compra de un tercero que es proveedor y cliente.
- Los filtros de fecha de la auditoría dan 500 ante una fecha inválida, y no queda clara la zona horaria de «desde» y «hasta».
- Los endpoints de libros sin «desde» y «hasta» devuelven toda la historia, o un 500 en Excel y PDF.
- Fechas inexistentes como `2026-02-30` se aceptan y se corren al mes siguiente.
- Los caracteres fuera de latin1 (’ – €) en nombres se escriben mal en los archivos.
- Con el CUIT de la empresa vacío o inválido, el registro 01 da 500 en vez de 400.
- La web toma la fecha por defecto de algunos formularios de la hora local del navegador.
- La prueba web de `hoy()` no demuestra el arreglo en una máquina con hora argentina.
- La prueba de «cálculo acotado» de intereses verifica el resultado, no que la consulta esté acotada.
- Falta la prueba de la clave de correo vacía como texto (la de clave omitida sí está).
- La tabla de ABM:
  - no vuelve a la página 1 al cambiar el filtro;
  - no maneja respuestas que no son JSON;
  - tiene un aviso de React por claves duplicadas.
- La sección de pendientes bancarios del informe muestra la suma con signo.
- Un rechazo puede descontarse un mes antes que el cobro aplicado después: se compensa solo.

---

## 4. Ya resueltos (89 de los 231 menores)

Las entregas de pulido resolvieron:
- **E17:** bienes de uso, presupuestos, saldos a una fecha, flujo semanal y tablero.
- **E22:** sueldos: neto negativo, ausencias, bloqueos, copias al cerrar, conceptos de Comercio y web de novedades y vacaciones.
- **E26:** tarjetas, comisiones y cobranzas.
- **E29:** comisiones, cupones, intereses, correo y fechas.
- **E33 y E34:** Ganancias.

El detalle de cada uno está en sus specs, en `docs/superpowers/specs/*pulido*`.

---

## 5. Decisiones tomadas que podrían revisarse

Son casos aceptados a propósito en las entregas.
- **Retenciones de IVA y SUSS:**
  - la parte de una factura cubierta por un anticipo no retiene;
  - las notas de crédito reparten su sobrante sobre lo que queda de cada factura;
  - las facturas M no fuerzan el 100 %;
  - el «exento de IVA» no tiene vencimiento;
  - el PDF es una constancia, porque el certificado oficial lo emite el SIRE, y no se guarda el número de certificado del SIRE.
- **Ganancias:**
  - el tope del ajuste anual comparte el 35 % con la retención del mes;
  - una final de abril cerrada antes de la anual queda con un aviso, y el saldo se maneja fuera del sistema;
  - la tabla 5 de ARCA se reproduce con una tolerancia de un centavo.
- **Comisiones:** un rechazo puede descontarse un mes antes que su cobro, y se compensa solo.
