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
