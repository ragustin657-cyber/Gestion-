# Sistema de Gestión

ERP para medianas empresas argentinas, pensado para crecer a grandes empresas. Funciona como SaaS multiempresa y también se puede instalar en el servidor de cada cliente.

- **Diseño:** `docs/superpowers/specs/2026-11-05-sistema-gestion-design.md`
- **Plan de la Entrega 1:** `docs/superpowers/plans/2026-11-05-entrega-1-base.md`

## Qué incluye hoy (Entrega 1: base)

- Login, selección de empresa y aislamiento total de datos entre empresas.
- Usuarios, roles con permisos por acción y auditoría de cambios.
- Proveedores y clientes con CUIT validado y datos impositivos (Ganancias, IVA, IIBB por jurisdicción).
- Artículos, plan de cuentas jerárquico con modelo argentino precargado, monedas y cotizaciones.
- Bancos, cuentas bancarias (CBU validado), chequeras físicas y e-cheq, y cajas.
- Centros de costo, depósitos, puntos de venta y numeración de comprobantes.
- Interfaz web con menú en árbol: Registraciones, Consultas, Maestros y Administración.

## Circuito de compras (Entrega 2)

- **Orden de compra:** borrador → confirmación → aprobación por monto. Bajo el límite configurado se aprueba sola; arriba la aprueba otro usuario con permiso. Incluye PDF para el proveedor.
- **Informe de recepción:** desde una o varias OC aprobadas, con recepciones parciales y control de remito duplicado.
- **Factura de proveedor:** desde recepciones, desde OC (servicios) o directa.
  - Valida la letra según la condición de IVA.
  - Exige que el total cargado coincida con el del papel.
  - Hace el control de 3 vías con tolerancias.
  - Genera el movimiento en la cuenta corriente (en pesos y dólares) y el asiento automático.
- **Consultas:** órdenes, recepciones, comprobantes, cuenta corriente, antigüedad de deuda, Libro IVA Compras (con exportación a Excel), buscador y pendientes.
- **Configuración** (Administración → Configuración de compras): monto límite de aprobación, tolerancias, modo avisar o bloquear y cuentas contables por concepto.

Usuarios demo:

| Usuario | Contraseña | Rol |
|---|---|---|
| admin@demo.com | admin1234 | Administrador |
| aprobador@demo.com | aprobador1234 | Aprobador de OC y OP (Gerente) |
| tesorero@demo.com | tesorero1234 | Tesorero (paga las OP aprobadas) |
| cajero.rosario@demo.com | cajero1234 | Cajero de la Sucursal Rosario (solo opera su sucursal) |
| contador@demo.com | contador1234 | Contador (asientos manuales, cierres y libros legales) |

En la empresa demo hay una orden de compra en cada estado, recepciones, una factura en pesos, una en dólares y una nota de crédito. El límite de aprobación es de $ 1.000.000.

## Órdenes de pago y retenciones (Entrega 3)

- **Orden de pago:**
  - Se eligen los comprobantes con saldo del proveedor (facturas, notas de débito y crédito, anticipos), en pesos o dólares, con pagos parciales. También se puede hacer un pago a cuenta (anticipo).
  - Lo que ya está en otra OP abierta no se puede volver a tomar.
  - La aprobación es por monto, con un límite propio, y quien carga no aprueba.
- **Pago** (lo hace quien tiene permiso de tesorería):
  - Medios: transferencia, cheque propio (e-cheq o físico, al día o diferido) y efectivo, en pesos o dólares.
  - Las retenciones se recalculan con la fecha de pago.
  - Medios + retenciones tienen que igualar el total al centavo.
  - Genera los certificados numerados, baja la cuenta corriente y registra el asiento con la diferencia de cambio.
- **Retenciones:**
  - Ganancias (RG 830) por régimen, con acumulado mensual, mínimo no sujeto, escala para honorarios y mínimo de retención.
  - IIBB por jurisdicción, con la alícuota tomada del padrón, de la ficha del proveedor o de un valor por defecto.
  - Se configuran en Administración → Retenciones.
- **Padrones de IIBB:** se cargan en Administración → Padrones de IIBB los archivos mensuales de ARBA (902) y AGIP (901). Se procesan en segundo plano y son comunes a todas las empresas.
- **Anulación:** una OP pagada se anula con reversión completa: saldos, cheques, certificados, tesorería y contra-asiento.
- **Consultas:** órdenes de pago, pagos a realizar y retenciones practicadas, con exportación a Excel y PDF de la OP y de cada certificado.

> ⚠️ **Valores de Ganancias a verificar.** Los mínimos, alícuotas y escala precargados son de referencia. El contador tiene que verificarlos contra la normativa vigente antes de operar. La pantalla los marca hasta que se editan.

## Tesorería (Entrega 4A)

- **Sucursales:** casa central y sucursales (Maestros → Bancos y cajas → Sucursales). Cada caja pertenece a una sucursal. A un usuario se le puede asignar una sucursal en Administración → Usuarios: solo ve y opera las cajas y valores de esa sucursal, y no ve los bancos.
- **Ingreso de valores:** cobros a clientes u otros ingresos con efectivo, cheques de terceros (físicos o e-cheq) y transferencias recibidas. Cada sucursal numera sus ingresos. Avisa si un cheque está vencido para depositar (más de 30 días) y rechaza cheques duplicados.
- **Traslados:** la sucursal envía cheques y efectivo a otra caja; quedan en tránsito hasta que el destino los recibe, total o parcialmente (lo no recibido vuelve al origen).
- **Depósitos y acreditaciones:** el depósito registra el banco y el asiento; la acreditación confirma la fecha. Las transferencias recibidas entran al banco al acreditarse.
- **Cheques:** rechazo (con gastos bancarios y la deuda vuelve al cliente, o al proveedor si estaba endosado), devolución, endoso como medio de pago en la orden de pago ("Cheque de terceros") y débito de cheques propios diferidos.
- **Bancos y cajas:** gastos e ingresos bancarios, transferencias entre cuentas propias (con diferencia de cambio entre monedas), movimientos de caja y arqueos con registro de faltantes y sobrantes.
- **Consultas:** saldos a una fecha, cartera de cheques con historial, valores en tránsito, pendientes de acreditar, cheques propios, movimientos de una cuenta o caja y flujo de fondos proyectado.
- Todas las operaciones generan su asiento y se pueden anular mientras los valores no se hayan movido.

En la empresa demo hay un cobro de Rosario en tránsito hacia casa central, cheques en cartera, un cheque depositado pendiente de acreditar, una transferencia pendiente y un e-cheq propio diferido a debitar.

## Conciliación bancaria (Entrega 4B)

- **Formatos de extracto:** cada cuenta bancaria tiene el formato de su homebanking (CSV o Excel, columnas, fecha, decimales, importe con signo o débito/crédito). Se configura en Maestros → Bancos y cajas → Formatos de extracto, partiendo de un modelo (Nación, Galicia, Santander, Macro, BBVA o genérico).
- **Importación:** vista previa con errores por fila; las líneas ya importadas se saltean, así se pueden subir extractos superpuestos. Una importación se puede deshacer mientras no tenga líneas conciliadas.
- **Conciliación por período** (Registraciones → Tesorería → Conciliación bancaria): saldo inicial y final del extracto, el extracto y los movimientos del sistema lado a lado y la diferencia en vivo.
  - "Buscar coincidencias" propone vínculos exactos (por referencia o fecha), probables (fecha cercana) y agrupados (varios movimientos contra una línea); se confirman con un clic.
  - La conciliación manual admite varios contra varios, siempre que los importes sumen igual.
  - Las líneas que el sistema no tiene (impuesto 25.413, comisiones, IVA, percepciones, intereses) se registran desde la conciliación como movimiento bancario con su asiento. Las reglas de Administración → Reglas de conciliación proponen la cuenta contable.
- **Cierre:** con diferencia cero y todas las líneas conciliadas, registradas o ignoradas. Lo conciliado queda bloqueado: no se puede anular ni registrar con fecha del período sin reabrir la conciliación (con permiso de anular). Los movimientos pendientes pasan solos al período siguiente.
- **Reporte** de conciliación en PDF y Excel, con las partidas pendientes de cada lado.

> ⚠️ **Formatos de extracto a verificar.** Los modelos de cada banco son una estimación. Antes de operar, importe un extracto real de cada cuenta y revise la vista previa.

El seed genera un extracto de ejemplo del Banco Nación en `apps/api/prisma/demo/extracto-demo-nacion.csv`, con los movimientos de la demo más el impuesto 25.413, una comisión y su IVA.

## Contabilidad general (Entrega 5)

- **Ejercicios y meses:** cada empresa tiene sus ejercicios de 12 meses (según el mes de inicio). Ningún asiento, automático o manual, se graba con fecha fuera de un ejercicio o en un mes cerrado: una factura, un pago o un depósito con esa fecha se rechaza entero.
- **Asientos manuales** (Registraciones → Contabilidad General): se modifican o eliminan mientras su mes está abierto; después se anulan con contraasiento. Los automáticos se anulan desde su comprobante.
- **Cierre de meses**, en orden: al cerrar, los asientos reciben su **número definitivo** dentro del ejercicio, en orden de fecha, y quedan inalterables. Se puede reabrir el último mes cerrado, con motivo.
- **Consultas:** Libro Diario (con enlace al comprobante de origen), Mayor (con saldo inicial y por centro de costo) y Balance de sumas y saldos, exportables a Excel y PDF.
- **Cierre del ejercicio:** genera la refundición de resultados contra "3.2.02 Resultado del ejercicio", el asiento de cierre y la apertura del ejercicio siguiente. Se puede reabrir mientras el ejercicio nuevo no tenga meses cerrados.
- **Estados contables:** estado de situación patrimonial y estado de resultados, con comparativo del ejercicio anterior.
- **Libros legales:** Libro Diario y Libro de Inventarios y Balances en PDF, con folios correlativos y transporte entre páginas, para hojas móviles rubricadas.

> ⚠️ **Moneda histórica.** Los estados contables no incluyen el ajuste por inflación (RT 6 / RT 54): ese ajuste se carga como asiento manual hasta que tenga su propia entrega.

## Ventas y factura electrónica ARCA (Entrega 6)

- **Comprobantes de venta** (Registraciones → Ventas y Cuentas a Cobrar): factura, nota de débito y nota de crédito, con IVA por alícuota. La letra (A, B o C) sale de la condición de IVA de la empresa y del cliente. Los renglones pueden ser artículos o texto libre. En **Servicios** se cargan el período facturado y el vencimiento del pago.
- **CAE de ARCA:**
  - Al **Emitir**, el sistema pide el CAE. Recién con la autorización el comprobante recibe su número, entra en la cuenta corriente y genera el asiento.
  - Si ARCA no responde, queda **pendiente de CAE** con un botón **Reintentar**. Si ARCA autorizó pero la respuesta se perdió, el reintento recupera ese CAE en vez de pedir otro.
  - Un comprobante autorizado no se anula: se corrige con una nota de crédito.
- **PDF** con el código QR de ARCA. En Simulado y Homologación lleva la leyenda "SIN VALIDEZ FISCAL".
- **Recibos:**
  - valores (efectivo, cheques y transferencias, que entran a la caja como en Tesorería);
  - retenciones sufridas (IVA, Ganancias, IIBB, SUSS);
  - comprobantes a cancelar. Lo que sobra queda como pago a cuenta.
- **Aplicación de cobros:** cancela facturas con saldos a favor (pagos a cuenta, cobros de Tesorería, notas de crédito). Una factura en dólares cobrada en pesos registra la **diferencia de cambio**.
- **Consultas:** comprobantes, recibos, cuenta corriente y saldos de clientes por antigüedad.

**Modos de ARCA** (Administración del sistema → Factura electrónica ARCA):

| Modo | Uso |
|---|---|
| Simulado | Pruebas y demo. No se conecta con ARCA; numera y devuelve CAE de prueba. Es el modo inicial de toda empresa. |
| Homologación | El ARCA de prueba. Requiere un certificado de homologación del CUIT de la empresa. |
| Producción | Facturación real. Requiere el certificado de producción. |

**Para usar Homologación:**
1. Generá una clave privada y un pedido de certificado (CSR):
   ```bash
   openssl genrsa -out empresa.key 2048
   openssl req -new -key empresa.key -subj "/C=AR/O=Mi Empresa/CN=gestion/serialNumber=CUIT 30712345671" -out empresa.csr
   ```
2. En el sitio de ARCA, con la clave fiscal, entrá a "WSASS – Autogestión Certificados Homologación". Creá el certificado con el CSR, descargá el `.crt` y autorizalo para el servicio **wsfe**.
3. Dá de alta en ARCA un punto de venta del tipo "web services". En el sistema, marcalo como electrónico (Administración → Empresa → Puntos de venta).
4. Cargá el `.crt` y el `.key` en la pantalla de ARCA, elegí Homologación y usá **Probar conexión**.

> ⚠️ El servidor necesita la variable `ARCA_CLAVE_MAESTRA` (32 bytes en base64, por ejemplo `openssl rand -base64 32`) para guardar los certificados cifrados. Si se pierde, hay que volver a cargar los certificados.

Usuario demo de facturación: **facturacion@demo.com** / **facturacion1234**.

## Libros IVA y presentaciones impositivas (Entrega 7)

- **Libros IVA Ventas y Compras** (Consultas → Impuestos): en pantalla, Excel y PDF, con columnas por alícuota. Si el IVA del libro no coincide con el Mayor de la cuenta de IVA, se muestra un aviso.
- **Generar presentación** (Registraciones → Impuestos):

| Presentación | Archivo |
|---|---|
| Libro IVA Digital | ZIP con los 4 archivos de ventas y compras (cabeceras y alícuotas) |
| SICORE (Ganancias, impuesto 217) | TXT de 145 posiciones, del mes o de la primera quincena |
| ARBA A-122R (IIBB Buenos Aires) | Lote `ER-CUIT-AAAAMMQ-ACTIVIDAD-LOTEnnnnn.zip` con el alta de retenciones |
| AGIP e-ARCIBA (IIBB CABA) | TXT de retenciones de 215 posiciones. Exige la situación y el número de IIBB de cada proveedor (maestro de proveedores, pestaña Impuestos). |

- **Presentaciones:**
  - Historial con nueva descarga de cada archivo.
  - Si después de generar cambian los datos del período (una factura cargada tarde, una OP anulada), avisa que corresponde rectificar.
  - Generar no bloquea nada.
- **Control con ARCA:** se sube el CSV de "Mis Comprobantes" (recibidos o emitidos) y el sistema muestra lo que está en ARCA y no en el sistema, lo que está en el sistema y no en ARCA, y las diferencias de importes.

**Contexto normativo** (noviembre de 2026):
- **RG 5707/2025:** el Libro IVA Digital es obligatorio solo para los exentos en IVA. Los Responsables Inscriptos liquidan con IVA Simple sobre "Mis Comprobantes": por eso el control con ARCA.
- **RG 5921/2026:** las retenciones de IVA pasan a SIRE desde abril de 2027. Ganancias sigue en SICORE.
- **ARBA, RN 22/25:** ARBA emite el comprobante de retención al procesar el lote. Al proveedor se le entrega el de ARBA.

> ⚠️ **Verificar la primera importación en cada aplicativo.**
> - **Diseños:** se tomaron de las publicaciones oficiales, guardadas en `docs/superpowers/specs/referencias/entrega-7/`.
> - **SICORE:** las posiciones 45 a 145 siguen el formato estándar de mercado.
> - **Valores a confirmar con el contador** (Administración → Configuración de impuestos): la actividad de ARBA ("6"), el código de norma de AGIP ("029") y los códigos de operación del Libro IVA Digital.

## Ajuste por inflación contable (Entrega 9)

RT 6 / RT 54, método directo: las cuentas no monetarias se reexpresan movimiento por movimiento con el índice de cada mes, y la diferencia va contra el RECPAM.

1. **Índices** (Administración → Índices de inflación, solo el administrador general): IPC FACPCE mensual, compartido por todas las empresas. Se carga a mano o importando un CSV `AAAA-MM;valor` (también `MM/AAAA`, con coma o punto decimal). No viene con valores precargados.
2. **Plan de cuentas:** cada cuenta es *monetaria* o *no monetaria*. Por defecto son no monetarias el patrimonio neto, los resultados y los bienes de uso. Una cuenta puede tener una *cuenta de ajuste* (Capital social → 3.1.02 Ajuste de capital). El RECPAM es la cuenta 4.2.03.
3. **Configuración** (Administración → Configuración del ajuste por inflación): el primer ejercicio que se ajusta y la anticuación de su apertura (el mes de origen de cada parte de los saldos iniciales). Lo no anticuado se toma al inicio del ejercicio, con aviso. La reexpresión de la apertura va contra Resultados no asignados.
4. **Ajuste** (Registraciones → Contabilidad General → Ajuste por inflación): se elige un fin de mes y se ve la vista previa por cuenta (saldo contable, reexpresado, ajuste) con el RECPAM, también en Excel. *Generar* registra el asiento. Se puede ajustar cualquier mes: cada asiento agrega solo lo que falta, incluso si después se cargó un asiento con fecha anterior. Solo se anula el último ajuste.
5. **Cierre del ejercicio:** si la empresa ajusta, no se cierra sin un ajuste al último día que esté al día.
6. **Estados contables:** la casilla *Comparativo reexpresado* lleva el ejercicio anterior a moneda de la fecha de los estados.

Fuera de alcance: ajuste impositivo (Ganancias), segregación de componentes financieros, valores corrientes y método indirecto.

## Stock (Entrega 10)

Stock por depósito con costo promedio ponderado móvil (uno por artículo para toda la empresa) y su contabilización automática.

- **Artículos:** la casilla *Controla stock* activa el control. Los servicios no controlan stock.
- **Compras:**
  - el **informe de recepción** entra la mercadería al depósito al precio de la OC: Mercaderías / Mercadería recibida a facturar;
  - la **factura del proveedor** cancela ese pasivo; la diferencia de precio ajusta el costo (o va al costo de lo vendido si la mercadería ya se vendió);
  - una factura **sin recepción** pide depósito y entra al precio facturado;
  - las notas de crédito y débito de compra ajustan el costo.
- **Ventas:** la factura sale del depósito del punto de venta (o el elegido); al emitir se registra Costo de mercaderías vendidas / Mercaderías. La nota de crédito *con devolución de mercadería* la reingresa al costo con que salió.
- **Stock negativo** (Administración → Configuración de stock): *Bloquear* (por defecto) o *Permitir con aviso*.
- **Registraciones → Stock:** transferencia entre depósitos, inventario físico (sobrantes y faltantes), inventario inicial (con o sin asiento) y salida manual. Todo se anula con movimientos inversos y contraasiento.
- **Consultas → Stock:** existencias por depósito, kardex con saldos de cantidad y valor, valuación a una fecha con el control contra el Mayor de Mercaderías (pantalla, Excel y PDF).
- La cuenta Mercaderías (1.1.05.001) es no monetaria: se reexpresa en el ajuste por inflación.

Fuera de alcance: lotes, series, vencimientos, producción, remitos, reservas, listas de precios y costo por depósito.

## Ventas completas (Entrega 11)

Circuito comercial previo a la factura: presupuesto → pedido → remito → factura, con precios desde listas.

- **Listas de precios** (Maestros → Listas de precios): varias listas en pesos o dólares, una por defecto; cada cliente puede tener la suya. Precios netos por artículo, editables, importables desde Excel/CSV (código y precio), con **aumento masivo** por porcentaje y redondeo (vista previa) e historial de cambios. El precio de la lista se sugiere al cargar un artículo en pedidos y facturas (convertido si la moneda difiere).
- **Pedidos de venta** (Registraciones → Ventas → Pedido de venta): nacen como *Presupuesto* (editable, con PDF para enviar) y al confirmarlos pasan a *Pedido*; avisan si falta stock. Se cierran (lo pendiente se cancela) o se anulan si no tienen entregas.
- **Remitos** (Registraciones → Ventas → Remito): entregan lo pendiente de uno o varios pedidos del cliente (o renglones sueltos). Descuentan stock y registran el costo de lo vendido; PDF sin precios, original y duplicado. Se anulan mientras no estén facturados.
- **Factura desde remitos y pedidos:** en el comprobante de venta, *Agregar desde remitos y pedidos* trae lo pendiente de facturar del cliente. La factura de un remito no vuelve a mover stock; desde el pedido se facturan servicios. Lo facturado se registra recién al autorizar la factura.
- **Consultas → Ventas:** pedidos (pendiente de entregar y de facturar) y remitos (pendiente de facturar).

Fuera de alcance: listas derivadas, precio desde el costo, comisiones, descuentos por cantidad, reservas de stock, COT de ARBA y remitos de devolución.

## Pulido (Entrega 12)

Correcciones de las entregas 9 a 11: validaciones de depósitos, listas y clientes; importaciones de índices y precios más tolerantes (separador de miles, comillas, fórmulas de Excel, número de línea exacto); costos de compra que nunca dejan valor negativo ni centavos en Mercadería recibida a facturar; valuación de stock con el ajuste por inflación aparte; PDF de pedidos con encabezado en cada página y presupuesto B con IVA incluido.

> **Para empresas migradas desde antes de la Entrega 9:** los conceptos RECPAM, Resultados no asignados y Costo de mercaderías vendidas se asociaron por código. Si su plan usa esos códigos para otras cuentas, revise la asociación en Administración → Configuración de compras (cuentas por concepto).

## Informes de gestión (Entrega 13)

- **Tablero de dirección** (inicio para quien tiene el permiso *Ver informes de gestión*): ventas y margen bruto del período con variación contra el período anterior y el año anterior, cobranzas vencidas, deuda vencida con proveedores y stock valorizado; gráfico de ventas y margen de los últimos 12 meses y rankings de 10 clientes y 10 artículos. Cada tarjeta lleva a su informe.
- **Informes** (menú *Informes de gestión*): Ventas por cliente, artículo o mes; Márgenes; Antigüedad de saldos de clientes y proveedores por tramos (a vencer, 1–30, 31–60, 61–90, más de 90, a favor); Rotación de stock y días de cobertura. Orden por columna, totales y exportación a Excel y PDF.
- **Cómo se calcula:** ventas = neto sin IVA de los comprobantes autorizados en pesos (NC restan); costo = movimientos de stock de la venta o del remito facturado; margen y porcentaje solo sobre lo que tiene costo (la *cobertura* indica qué parte de las ventas lo tiene). Coincide con el Mayor de Ventas y Costo de mercaderías vendidas.
- **En moneda de hoy:** reexpresa cada mes con los índices de inflación cargados; si falta alguno, muestra importes nominales y avisa qué meses faltan.

## Bienes de uso (Entrega 14)

- **Rubros** (Maestros → *Rubros de bienes de uso*): cuenta de valor de origen, de amortización acumulada y de gasto, y vida útil. Vienen Muebles y útiles (10 años), Rodados (5) y Equipos de computación (3).
- **Altas:** al registrar una factura de proveedor con un renglón a la cuenta de un rubro, se cargan descripción, vida útil y residual del bien; el bien queda con el valor en pesos de ese renglón. También alta manual (con asiento contra la cuenta que se elija) y carga inicial de bienes que ya estaban en la apertura (con su amortización acumulada).
- **Amortización del mes** (Registraciones → Contabilidad General): lineal por meses, desde el mes de alta y sin amortizar el mes de baja. Vista previa, Generar y Anular la última. Un bien cargado tarde recupera los meses que le faltaban en la siguiente generación. El cierre del ejercicio exige la amortización del mes de cierre.
- **Bajas y ventas:** baja por desuso, siniestro o robo (el residual va a *Bajas de bienes de uso*); venta desde el comprobante de venta con *Agregar bien de uso* (el neto y el residual van a *Resultado por venta de bienes de uso*, fuera de los informes de ventas).
- **Inflación:** los asientos de amortización y de baja llevan la fecha de alta del bien, y el ajuste por inflación los reexpresa desde ese mes.
- **Planilla de bienes de uso** (Consultas → Contabilidad General): por rubro, valores de origen y amortizaciones al inicio, altas, bajas, del ejercicio y al cierre, con el control contra el Mayor; en moneda de cierre opcional; Excel y PDF.

## Finanzas (Entrega 15)

- **Flujo de fondos proyectado** (Tesorería → *Flujo de fondos*): parte del saldo de bancos y cajas (los dólares a la cotización del día) y proyecta, por día, semana o mes, los cheques en cartera y en tránsito, las transferencias a acreditar y las **cobranzas** por vencimiento de las facturas de clientes, menos los cheques propios diferidos, las OP aprobadas y los **pagos a proveedores** por vencimiento (sin contar dos veces lo que ya está en una OP). Lo vencido va al primer período en líneas propias, y la casilla *Incluir vencidos* decide si suma al saldo. Alerta en el primer período con saldo negativo, gráfico, detalle de cada período, Excel y PDF.
- **Antigüedad de saldos a una fecha:** el saldo de cada comprobante se reconstruye a la fecha de corte con las aplicaciones de cobros y pagos, así que al elegir un mes pasado se ve lo que realmente se debía ese día. Lo usan el informe de antigüedad, las tarjetas de vencidos del tablero y la antigüedad de deuda de Compras, que coinciden entre sí.

## Requisitos

- Node 22 y pnpm 10 (`corepack enable`)
- PostgreSQL 16, local o con `docker compose up -d postgres`

## Desarrollo

```bash
pnpm install
cp .env.example apps/api/.env      # ajustar DATABASE_URL y JWT_SECRET
pnpm --filter @gestion/api prisma migrate deploy
pnpm seed                          # crea la empresa demo
pnpm dev                           # API en :3000 y web en http://localhost:5173
```

Usuario demo: **admin@demo.com** / **admin1234** (empresa "Demo S.A."). Cambiá la contraseña desde el botón **Contraseña** del encabezado antes de usarlo en serio.

## Con Docker

```bash
export JWT_SECRET="$(openssl rand -hex 32)"   # obligatorio, mínimo 32 caracteres
docker compose up --build
```

La web queda en http://localhost:8080. Para cargar la empresa demo dentro del contenedor:

```bash
docker compose exec api pnpm seed
```

## Tests

```bash
pnpm test        # shared + API (contra la base gestion_test) + web
pnpm e2e         # prueba en el navegador (usa la base gestion_e2e)
```

Los tests de la API recrean el esquema de la base indicada en `DATABASE_URL_TEST`, por defecto `gestion_test`. Por seguridad solo aceptan bases cuyo nombre termine en `_test`.

## Estructura

```
packages/shared   validaciones y constantes compartidas (CUIT, CBU, permisos, IVA)
apps/api          backend NestJS + Prisma (un módulo por dominio)
apps/web          frontend React + Mantine
e2e               pruebas Playwright
```

## Reglas para nuevos módulos

1. **Datos por empresa:** todo modelo de negocio lleva `empresaId`. Se agrega a `apps/api/src/prisma/modelos-empresa.ts`, y los servicios usan siempre `TenantPrisma.db` o `TenantPrisma.transaccion`, nunca `PrismaService`. Así el filtro por empresa es automático.
2. **Auditoría:** toda escritura llama a `AuditoriaService.registrar(tx, …)` dentro de la misma transacción.
3. **Permisos:** cada endpoint declara `@RequierePermiso('modulo.accion')`, y el permiso se agrega en `packages/shared/src/permisos.ts`.
4. **Validación:** el body se valida con zod (`ZodValidationPipe`) y los mensajes se escriben en castellano.
5. **Numeración:** se usa `NumeracionService.siguiente(tx, tipo, puntoVenta)`.
6. **Asientos:** se generan con `AsientosService.generar(tx, …)` dentro de la misma transacción que el comprobante. Si el asiento no balancea, la operación entera se revierte. Para anular se usa `contraasiento`.
   - **Cuenta corriente:** los saldos se cancelan con `AplicacionCuentaCorriente`, que guarda el importe en moneda original y en pesos históricos. Nunca se modifica el importe original del comprobante.
7. **Importes:** se calculan con las funciones de `packages/shared/src/compras` (decimal.js), las mismas en el servidor y en la web. Nunca se usa `number` para hacer cuentas con dinero.
8. **Concurrencia:** los comprobantes con estados llevan `version` (bloqueo optimista, 409 si cambió). Los renglones que se consumen (recibido o facturado) se bloquean con `FOR UPDATE`.
