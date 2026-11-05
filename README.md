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
| aprobador@demo.com | aprobador1234 | Aprobador de OC (Gerente) |

En la empresa demo hay una orden de compra en cada estado, recepciones, una factura en pesos, una en dólares y una nota de crédito. El límite de aprobación es de $ 1.000.000.

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
7. **Importes:** se calculan con las funciones de `packages/shared/src/compras` (decimal.js), las mismas en el servidor y en la web. Nunca se usa `number` para hacer cuentas con dinero.
8. **Concurrencia:** los comprobantes con estados llevan `version` (bloqueo optimista, 409 si cambió). Los renglones que se consumen (recibido o facturado) se bloquean con `FOR UPDATE`.
