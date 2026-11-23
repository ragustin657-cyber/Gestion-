# Entrega 49 — Pulido de Impuestos (menores de las entregas 43 a 48)

## Intención
Las entregas 43 a 48 dejaron menores diferidos. Se arreglan los que un usuario encuentra: errores 500, datos que se pierden sin aviso, números equivocados o archivos que ARCA rechaza. Quedan afuera los cosméticos y los que dependen de datos a verificar con los organismos.

## Enfoques
1. **Elegido: un pulido por entrega de origen, cada arreglo con su prueba que falla primero** (como la entrega 42).
2. Arreglar todos los menores, incluidos los cosméticos: más trabajo sin efecto para el usuario.
3. Dejarlos para cuando aparezcan: algunos dan 500 o números equivocados.

## Qué se arregla
**SIRE y Ganancias exterior (E43)**
- Alícuota de un régimen exterior: menor que 100 (con acrecentamiento, 100 % dividía por cero y daba 500): `La alícuota debe ser menor que 100`.
- F.2003: la fecha del comprobante (orden de pago) no puede ser posterior a la de retención; se informa la menor de las dos (ARCA exige C10 ≤ C8).
- Certificado SIRE: solo en retenciones de IVA, SUSS y Ganancias exterior (`La retención no se informa en el SIRE`), auditado.
- Detalle de la retención al exterior (tooltip): códigos sin formato de moneda y convenio/acrecentamiento en castellano; con acrecentamiento la orden de pago muestra «(asumida por la empresa)».

**Amortización impositiva (E44)**
- Ficha del bien: vida útil impositiva con campo numérico (un texto no se envía como vacío).
- Bajar el valor de origen de un bien por debajo de su terreno: `El terreno no puede superar el valor de origen`.
- Con automóviles y el tope por defecto (20.000): aviso `El tope de automóviles es el valor por defecto: verifíquelo en Configuración de impuestos`.
- Excel de la planilla: columnas deducible y costo computable de la baja, y total deducible.

**Ajuste por inflación impositivo (E45)**
- Plan de cuentas: `ajusteImpositivo` solo en activo y pasivo (`Solo las cuentas de activo y pasivo tienen ajuste impositivo`); al cambiarlo en una cuenta padre se aplica a sus subcuentas.
- `ejercicioId` mal formado en las planillas de E44, E45 y E46: 404 `Ejercicio no encontrado` (como un id inexistente) (hoy 500).
- La alerta de error de las partidas no se repite.

**DJ de Ganancias (E46)**
- La primera consulta de la DJ no da 409 con dos pestañas a la vez (alta idempotente).
- Reabrir un ejercicio con la DJ de Ganancias presentada: `La DJ de Ganancias del ejercicio está presentada: anule la presentación antes de reabrir`.
- Escala: quitar un tramo.

**Bienes Personales (E47)**
- Año fuera de 2000–2100: 400 `Año inválido` (hoy 500 con valores enormes).
- Ajuste, participaciones o copia en un año sin ejercicio: 400 `No hay un ejercicio que cierre en <A>` (hoy deja filas sueltas).
- Socio repetido en las participaciones: 400 `El socio está repetido` (hoy 409 genérico).
- Ajuste del patrimonio con tope de `Decimal(18,2)` y 2 decimales.

**Otras jurisdicciones de IIBB (E48)**
- Formato de padrón: vigencia desde y hasta juntas o ninguna; columna acorde al separador (número en delimitado, «desde-hasta» en ancho fijo; columna ≥ 1).
- Período del padrón validado al cargar (`Período inválido (AAAAMM)`), antes de procesar.
- Importación SIRCREB: se ignoran las líneas en blanco y la marca de inicio (BOM) antes del encabezado.

## Fuera de alcance
- Diseños a verificar (SIRCAR, F.2003, tope de automóviles, escalas): siguen en `docs/pendientes.md` §2.
- Los demás menores cosméticos de los informes.
