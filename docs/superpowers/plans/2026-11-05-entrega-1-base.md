# Entrega 1 — Base del sistema: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar funcionando la base del ERP: monorepo, login, multi-empresa con aislamiento de datos, usuarios/roles/permisos, auditoría, numeración de comprobantes, maestros (terceros, artículos, plan de cuentas, monedas, tesorería, centros de costo, depósitos) y la interfaz web con menú en árbol y ABMs.

**Architecture:** Monorepo pnpm con `packages/shared` (validaciones y constantes puras), `apps/api` (NestJS, un módulo Nest por dominio, Prisma sobre PostgreSQL) y `apps/web` (React + Vite + Mantine). El aislamiento multi-empresa se resuelve en una sola pieza: un cliente Prisma extendido que inyecta `empresaId` en toda consulta de modelos de negocio a partir del contexto de la request (nestjs-cls).

**Tech Stack:** Node 22, pnpm 10, TypeScript 5 (strict), NestJS 11, Prisma 6, PostgreSQL 16, `@nestjs/jwt`, `@node-rs/argon2`, `nestjs-cls`, `zod`; React 19, Vite 6, Mantine 7, TanStack Query 5, React Router 7; Jest + supertest (api), Vitest (shared, web), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-11-05-sistema-gestion-design.md` (§1, §2, §8, §9 y entrega 1 de §10).

## Global Constraints

- TypeScript `strict: true` en todos los paquetes; nombres de dominio en castellano (`Empresa`, `Tercero`, `CuentaContable`), código técnico en inglés está bien (`controller`, `service`).
- Toda tabla de negocio lleva `empresaId` (uuid) y se filtra automáticamente según la empresa activa del usuario.
- Un usuario puede tener acceso a varias empresas y elegir la activa.
- Permisos por acción con códigos `modulo.accion` (ej. `oc.crear`, `oc.aprobar`, `op.aprobar`, `pago.ejecutar`).
- Auditoría de creación, modificación, aprobación y anulación con usuario y fecha y hora.
- CUIT validado por dígito verificador.
- Monedas iniciales: ARS y USD; cotización por fecha.
- Plan de cuentas jerárquico, imputable / no imputable, con modelo argentino precargado.
- Mensajes de error al usuario en castellano.
- Montos: `Decimal(18,2)`; cotizaciones y alícuotas: `Decimal(18,6)`. Nunca `float` para dinero.
- IDs: `uuid` generados por la base.
- Todo se levanta con `docker compose up` (api + web + postgres).

## Review Focus

1. **Acceso cruzado entre empresas por id:** un usuario de la empresa B que pide `GET/PATCH/DELETE /terceros/:id` con un id de la empresa A debe recibir 404, no el dato. → test en Task 4 y Task 7.
2. **CUIT con guiones, espacios o dígito 10:** `20-12345678-6`, `20 12345678 6` y `20123456786` son el mismo CUIT válido; `20-12345676-X` es inválido para todo X. → tests en Task 1.
3. **CUIT duplicado dentro de la misma empresa:** crear dos terceros con el mismo CUIT en la misma empresa da 409 con mensaje en castellano; en empresas distintas está permitido. → test en Task 7.
4. **Token de una empresa a la que se le quitó el acceso / usuario inactivo:** debe dar 401 aunque el JWT no haya vencido. → test en Task 3.
5. **Numeración concurrente:** dos pedidos simultáneos del próximo número del mismo talonario nunca devuelven el mismo número. → test en Task 6.

---

## Estructura de archivos

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, docker-compose.yml, .env.example, README.md
packages/shared/src/
  cuit.ts                 validar/normalizar/formatear CUIT
  permisos.ts             catálogo de permisos (const) y tipo Permiso
  condicion-iva.ts        enum CondicionIva + etiquetas
  index.ts
apps/api/
  prisma/schema.prisma    todos los modelos de la entrega
  prisma/seed.ts          seed demo (llama a src/seed/*)
  src/main.ts, src/app.module.ts
  src/prisma/             PrismaService (cliente base) + TenantPrisma (cliente extendido)
  src/contexto/           ClsModule config, tipo ContextoRequest
  src/auth/               login, selección de empresa, JwtGuard, PermisosGuard, decoradores
  src/usuarios/           usuarios, roles, asignación a empresas
  src/empresas/           empresa y puntos de venta
  src/auditoria/          AuditoriaService + consulta
  src/numeracion/         NumeracionService
  src/terceros/           proveedores y clientes (una tabla, flags)
  src/articulos/
  src/contabilidad/plan-cuentas/
  src/monedas/
  src/tesoreria/maestros/ bancos, cuentas bancarias, chequeras, cajas
  src/organizacion/       centros de costo, depósitos
  src/seed/               plan-cuentas-modelo.ts, demo.ts
  test/                   setup de DB de test, helpers (crearEmpresaYUsuario, loginComo)
apps/web/src/
  api/cliente.ts          fetch con token, manejo de 401
  auth/                   LoginPage, SeleccionEmpresaPage, AuthContext
  layout/                 AppLayout, MenuArbol, menu.ts (definición del árbol)
  abm/                    componentes genéricos: TablaAbm, FormAbm
  paginas/                una página por maestro
e2e/                      Playwright
```

---

### Task 1: Monorepo + paquete `shared` (CUIT, permisos, condición IVA)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `docker-compose.yml` (solo servicio `postgres:16` por ahora, puerto 5432, db `gestion`)
- Create: `packages/shared/{package.json,tsconfig.json,vitest.config.ts}`, `packages/shared/src/{cuit.ts,permisos.ts,condicion-iva.ts,index.ts}`
- Test: `packages/shared/src/cuit.test.ts`

**Interfaces:**
- Produces:
  - `normalizarCuit(s: string): string` — quita todo lo que no sea dígito.
  - `validarCuit(s: string): boolean` — 11 dígitos, prefijo en `20,23,24,27,30,33,34`, dígito verificador correcto (pesos `5,4,3,2,7,6,5,4,3,2`; `r = 11 - suma % 11`; `r==11 → 0`; `r==10 → inválido`).
  - `formatearCuit(s: string): string` — `XX-XXXXXXXX-X`.
  - `PERMISOS` (objeto const `{ codigo: descripcion }`) y `type Permiso = keyof typeof PERMISOS`. Códigos de esta entrega: `empresa.administrar`, `usuario.administrar`, `rol.administrar`, `tercero.ver`, `tercero.editar`, `articulo.ver`, `articulo.editar`, `plancuentas.ver`, `plancuentas.editar`, `moneda.editar`, `tesoreria.maestros.editar`, `organizacion.editar`, `auditoria.ver`. Se incluyen ya (para roles) los de entregas futuras: `oc.crear`, `oc.aprobar`, `ir.crear`, `fc.crear`, `op.crear`, `op.aprobar`, `pago.ejecutar`.
  - `enum CondicionIva { RESPONSABLE_INSCRIPTO, MONOTRIBUTO, EXENTO, CONSUMIDOR_FINAL, NO_RESPONSABLE }` + `ETIQUETAS_CONDICION_IVA`.

- [ ] **Step 1: Scaffold del workspace** (`pnpm-workspace.yaml` con `apps/*`, `packages/*`; scripts raíz `test`, `lint`, `build` con `pnpm -r`). Verificar: `pnpm install` termina sin errores.

- [ ] **Step 2: Test que falla**

```ts
describe('cuit', () => {
  it('acepta CUIT válido en cualquier formato', () => {
    for (const s of ['20-12345678-6', '20 12345678 6', '20123456786', '30-71234567-1'])
      expect(validarCuit(s)).toBe(true);
  });
  it('rechaza dígito verificador incorrecto', () => expect(validarCuit('20-12345678-5')).toBe(false));
  it('rechaza cuando el verificador calculado es 10', () => {
    for (let d = 0; d <= 9; d++) expect(validarCuit(`2012345676${d}`)).toBe(false);
  });
  it('rechaza largo o prefijo inválido', () => {
    expect(validarCuit('2012345678')).toBe(false);
    expect(validarCuit('99-12345678-6')).toBe(false);
    expect(validarCuit('')).toBe(false);
  });
  it('formatea', () => expect(formatearCuit('20123456786')).toBe('20-12345678-6'));
});
```

- [ ] **Step 3:** `pnpm --filter @gestion/shared test` → FAIL (módulo no existe).
- [ ] **Step 4: Implementar** `cuit.ts`, `permisos.ts`, `condicion-iva.ts`, exportar en `index.ts`.
- [ ] **Step 5:** `pnpm --filter @gestion/shared test` → PASS.
- [ ] **Step 6: Commit** `feat(shared): monorepo y validación de CUIT`

---

### Task 2: API NestJS + Prisma + DB de test + modelos core

**Files:**
- Create: `apps/api/{package.json,tsconfig.json,nest-cli.json,jest.config.ts}`, `apps/api/src/{main.ts,app.module.ts}`, `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/salud/salud.controller.ts`
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/test/{global-setup.ts,helpers.ts}`
- Test: `apps/api/test/salud.e2e-spec.ts`

**Interfaces:**
- Produces:
  - Modelos Prisma (core): `Empresa { id, razonSocial, cuit, condicionIva, domicilio, inicioEjercicioMes Int, activa, creadoEn }`, `PuntoVenta { id, empresaId, numero Int, descripcion }` (único `empresaId+numero`), `Usuario { id, email unique, nombre, passwordHash, superadmin Bool, activo Bool }`, `Rol { id, empresaId, nombre, permisos String[] }`, `UsuarioEmpresa { usuarioId, empresaId, rolId, activo }` (pk compuesta), `Auditoria { id, empresaId, usuarioId, entidad, entidadId, accion, datos Json?, fecha }`.
  - `PrismaService extends PrismaClient` (inyectable, global).
  - `GET /salud` → `{ ok: true }`.
  - Test env: `DATABASE_URL` apunta a `gestion_test`; `global-setup.ts` corre `prisma migrate reset --force --skip-seed`. Helper `limpiarBase(prisma)` trunca todas las tablas (`TRUNCATE ... CASCADE`) y se llama en `beforeEach` de cada suite.
  - Prefijo global de rutas: `/api`.

- [ ] **Step 1: Scaffold** Nest + Prisma; `docker compose up -d postgres` (o Postgres local) y crear db `gestion_test`.
- [ ] **Step 2: Test que falla:** `GET /api/salud` responde 200 `{ ok: true }` (supertest sobre `app.getHttpServer()`).
- [ ] **Step 3:** `pnpm --filter @gestion/api test:e2e` → FAIL.
- [ ] **Step 4: Implementar** schema core, migración inicial (`prisma migrate dev --name core`), `PrismaService`, `SaludController`.
- [ ] **Step 5:** `pnpm --filter @gestion/api test:e2e` → PASS.
- [ ] **Step 6: Commit** `feat(api): base NestJS, Prisma y modelos core`

---

### Task 3: Autenticación (login + selección de empresa)

**Files:**
- Create: `apps/api/src/auth/{auth.module.ts,auth.service.ts,auth.controller.ts,jwt.guard.ts,publico.decorator.ts,usuario-actual.decorator.ts}`
- Create: `apps/api/src/contexto/contexto.ts`
- Test: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: modelos `Usuario`, `UsuarioEmpresa`, `Rol` (Task 2).
- Produces:
  - `POST /api/auth/login { email, password }` → `200 { token, usuario: { id, nombre }, empresas: { id, razonSocial }[] }`; credenciales malas o usuario inactivo → `401 "Usuario o contraseña incorrectos"`.
  - `POST /api/auth/empresa { empresaId }` (con token de login) → `200 { token, empresa: { id, razonSocial }, permisos: Permiso[] }`; sin acceso → `403 "No tiene acceso a esta empresa"`.
  - JWT payload: `{ sub: usuarioId, empresaId?: string }`, expira en 12 h, secreto `JWT_SECRET`.
  - `JwtGuard` global (APP_GUARD); rutas con `@Publico()` lo saltean. En cada request vuelve a leer `Usuario.activo` y, si hay `empresaId`, `UsuarioEmpresa.activo` + permisos del rol; guarda en CLS: `ContextoRequest { usuarioId: string; empresaId: string | null; permisos: Permiso[]; superadmin: boolean }`.
  - `@UsuarioActual()` devuelve `ContextoRequest`.
  - Hash: `@node-rs/argon2` (`hash`, `verify`).
  - Helper de test `crearEmpresaYUsuario(prisma, { permisos?: Permiso[] })` → `{ empresa, usuario, password }` y `loginComo(app, email, password, empresaId)` → token con empresa.

- [ ] **Step 1: Tests que fallan** en `auth.e2e-spec.ts`:
  - login correcto devuelve token y la lista de empresas del usuario;
  - contraseña incorrecta → 401;
  - seleccionar empresa sin acceso → 403;
  - ruta protegida sin token → 401;
  - **(Review Focus 4)** tras desactivar `UsuarioEmpresa.activo`, el token con esa empresa → 401; tras desactivar `Usuario.activo` → 401.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: Implementar** módulo auth, guard global, ClsModule (`nestjs-cls`, montado como middleware global).
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5: Commit** `feat(api): login y selección de empresa con JWT`

---

### Task 4: Aislamiento multi-empresa (TenantPrisma)

**Files:**
- Create: `apps/api/src/prisma/tenant-prisma.service.ts`, `apps/api/src/prisma/modelos-empresa.ts`
- Test: `apps/api/src/prisma/tenant-prisma.spec.ts` (contra DB de test)

**Interfaces:**
- Consumes: `ContextoRequest` en CLS (Task 3).
- Produces:
  - `MODELOS_DE_EMPRESA: readonly string[]` — lista de modelos Prisma que llevan `empresaId` (se amplía en cada task que agrega modelos de negocio).
  - `TenantPrisma` (inyectable) con propiedad `db` = `prisma.$extends({ query: { $allModels: { $allOperations } } })` que, para modelos en `MODELOS_DE_EMPRESA`:
    - agrega `empresaId` al `where` de `findMany/findFirst/findUnique/count/aggregate/groupBy/update/updateMany/delete/deleteMany/upsert`;
    - setea `data.empresaId` en `create/createMany/upsert.create`;
    - si no hay `empresaId` en el contexto, lanza `ForbiddenException("Debe seleccionar una empresa")`.
  - `TenantPrisma.transaccion<T>(fn: (tx) => Promise<T>): Promise<T>` — ejecuta `db.$transaction` interactiva conservando el filtro.
  - Regla para todos los servicios de negocio: **usan `TenantPrisma.db`, nunca `PrismaService`** (el `PrismaService` crudo solo en auth, superadmin y seed).

- [ ] **Step 1: Tests que fallan** (usar `Rol` como modelo de prueba, ya incluido en `MODELOS_DE_EMPRESA`; ejecutar dentro de `cls.run` con contexto de empresa A o B):
  - crear en A y listar en B → `[]`;
  - **(Review Focus 1)** `findUnique({ where: { id } })` desde B con id de A → `null`; `update` y `delete` desde B con id de A → lanzan `P2025` (no encontrado);
  - `create` desde A sin pasar `empresaId` guarda `empresaId = A`;
  - sin empresa en contexto → `ForbiddenException`.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: Implementar** `TenantPrisma` y un `ExceptionFilter` global que traduzca `P2025 → 404 "Registro no encontrado"` y `P2002 → 409 "Ya existe un registro con esos datos"`.
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5: Commit** `feat(api): aislamiento automático por empresa`

---

### Task 5: Permisos, usuarios, roles y auditoría

**Files:**
- Create: `apps/api/src/auth/{requiere-permiso.decorator.ts,permisos.guard.ts}`
- Create: `apps/api/src/auditoria/{auditoria.module.ts,auditoria.service.ts,auditoria.controller.ts}`
- Create: `apps/api/src/usuarios/{usuarios.module.ts,usuarios.service.ts,usuarios.controller.ts,roles.service.ts,roles.controller.ts,dto.ts}`
- Create: `apps/api/src/empresas/{empresas.module.ts,empresas.service.ts,empresas.controller.ts}`
- Test: `apps/api/test/{permisos.e2e-spec.ts,usuarios.e2e-spec.ts,empresas.e2e-spec.ts}`

**Interfaces:**
- Consumes: `TenantPrisma` (Task 4), `ContextoRequest` (Task 3), `PERMISOS` (Task 1).
- Produces:
  - `@RequierePermiso(...p: Permiso[])` + `PermisosGuard` global: si faltan permisos → `403 "No tiene permiso para realizar esta acción"`. `superadmin` pasa siempre.
  - `AuditoriaService.registrar(tx, { entidad: string; entidadId: string; accion: 'CREAR'|'MODIFICAR'|'APROBAR'|'ANULAR'|'ELIMINAR'; datos?: unknown }): Promise<void>` — toma usuario y empresa del CLS; se llama dentro de la misma transacción que la operación.
  - `GET /api/auditoria?entidad=&entidadId=` (permiso `auditoria.ver`).
  - Validación de body con `zod` vía `ZodValidationPipe` (`apps/api/src/comun/zod.pipe.ts`), error → `400` con lista de campos y mensajes en castellano.
  - Roles: `GET/POST/PATCH /api/roles` (`rol.administrar`), body `{ nombre, permisos: Permiso[] }`; permisos desconocidos → 400.
  - Usuarios: `GET /api/usuarios` (los de la empresa activa), `POST /api/usuarios { email, nombre, password, rolId }` (crea o reutiliza usuario por email y lo asigna a la empresa activa), `PATCH /api/usuarios/:id { rolId?, activo? }` (`usuario.administrar`).
  - Empresas: `POST /api/empresas` (solo superadmin; crea empresa + rol "Administrador" con todos los permisos + asigna al creador), `GET/PATCH /api/empresas/actual` (`empresa.administrar`), `GET/POST /api/empresas/actual/puntos-venta`. CUIT validado con `validarCuit` y guardado normalizado. Agrega a `Empresa` (migración): `agenteRetencionGanancias Bool`, `agenteRetencionIva Bool`, `agenteRetencionSuss Bool`, `jurisdiccionesIibb String[]`, editables por `PATCH /api/empresas/actual`.

- [ ] **Step 1: Tests que fallan:**
  - endpoint con `@RequierePermiso('rol.administrar')` y usuario sin ese permiso → 403; con permiso → 200;
  - crear rol con permiso `'inventado.x'` → 400;
  - crear usuario en empresa activa y que pueda loguearse y elegir esa empresa;
  - crear rol registra fila en `Auditoria` con `accion = 'CREAR'`, `usuarioId` y `empresaId` correctos;
  - `POST /api/empresas` con CUIT inválido → 400 `"CUIT inválido"`; usuario no superadmin → 403.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5: Commit** `feat(api): permisos, usuarios, roles, empresas y auditoría`

---

### Task 6: Numeración de comprobantes

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (modelo `Talonario`)
- Create: `apps/api/src/numeracion/{numeracion.module.ts,numeracion.service.ts}`
- Test: `apps/api/src/numeracion/numeracion.spec.ts`

**Interfaces:**
- Produces:
  - Modelo `Talonario { id, empresaId, tipoComprobante String, puntoVenta Int, ultimoNumero Int @default(0) }`, único `empresaId+tipoComprobante+puntoVenta`. Agregar a `MODELOS_DE_EMPRESA`.
  - `NumeracionService.siguiente(tx, tipoComprobante: string, puntoVenta: number): Promise<number>` — crea el talonario si no existe y hace `UPDATE ... SET ultimoNumero = ultimoNumero + 1 ... RETURNING` (bloqueo de fila), dentro de la transacción recibida.
  - `formatearNumero(puntoVenta: number, numero: number): string` → `"0001-00000042"` (en `packages/shared/src/numeracion.ts`).

- [ ] **Step 1: Tests que fallan:** primer número de un talonario nuevo es 1, el segundo 2; talonarios de distinto tipo o empresa son independientes; **(Review Focus 5)** 20 llamadas concurrentes (`Promise.all`, cada una en su propia transacción) devuelven los números 1..20 sin repetidos; `formatearNumero(1, 42) === '0001-00000042'`.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5: Commit** `feat(api): numeración de comprobantes por talonario`

---

### Task 7: Terceros (proveedores y clientes)

**Files:**
- Modify: `schema.prisma` (modelos `Tercero`, `TerceroIibb`), `modelos-empresa.ts`
- Create: `apps/api/src/terceros/{terceros.module.ts,terceros.service.ts,terceros.controller.ts,dto.ts}`
- Test: `apps/api/test/terceros.e2e-spec.ts`

**Interfaces:**
- Consumes: `TenantPrisma`, `AuditoriaService`, `validarCuit/normalizarCuit`, `CondicionIva`.
- Produces:
  - `Tercero { id, empresaId, codigo Int, razonSocial, nombreFantasia?, cuit, condicionIva, esProveedor Bool, esCliente Bool, domicilio?, localidad?, provincia?, email?, telefono?, diasPago Int @default(0), regimenGanancias String?, exentoGanancias Bool, exentoIva Bool, exencionHasta DateTime?, activo Bool }`; único `empresaId+cuit`; `codigo` asignado con `NumeracionService.siguiente(tx, 'TERCERO', 0)`.
  - `TerceroIibb { id, empresaId, terceroId, jurisdiccion String, alicuotaPercepcion Decimal(18,6), alicuotaRetencion Decimal(18,6), exento Bool }`.
  - REST: `GET /api/terceros?tipo=proveedor|cliente&q=&activo=` (búsqueda por razón social, código o CUIT; paginado `?pagina=&porPagina=`, respuesta `{ items, total }`), `GET /api/terceros/:id` (incluye `iibb`), `POST`, `PATCH /api/terceros/:id`, `PUT /api/terceros/:id/iibb` (reemplaza la lista). Permisos `tercero.ver` / `tercero.editar`. No hay DELETE: se desactiva con `activo=false`.
  - Validación: al menos uno de `esProveedor`/`esCliente`; CUIT válido.

- [ ] **Step 1: Tests que fallan:**
  - crear proveedor con CUIT `20-12345678-6` lo guarda como `20123456786` y asigna `codigo` 1;
  - CUIT inválido → 400 `"CUIT inválido"`;
  - **(Review Focus 3)** mismo CUIT dos veces en la misma empresa → 409 `"Ya existe un proveedor o cliente con ese CUIT"`; mismo CUIT en otra empresa → 201;
  - `?tipo=proveedor` no devuelve clientes puros; `q` encuentra por CUIT parcial y por razón social sin distinguir mayúsculas;
  - **(Review Focus 1)** `GET/PATCH /api/terceros/:id` desde otra empresa → 404;
  - `PUT /iibb` reemplaza la lista y registra auditoría `MODIFICAR`.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5: Commit** `feat(api): ABM de proveedores y clientes`

---

### Task 8: Plan de cuentas (con modelo argentino)

**Files:**
- Modify: `schema.prisma` (`CuentaContable`), `modelos-empresa.ts`
- Create: `apps/api/src/contabilidad/plan-cuentas/{plan-cuentas.module.ts,plan-cuentas.service.ts,plan-cuentas.controller.ts}`, `apps/api/src/seed/plan-cuentas-modelo.ts`
- Test: `apps/api/test/plan-cuentas.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `CuentaContable { id, empresaId, codigo String, nombre, padreId?, imputable Bool, tipo: ACTIVO|PASIVO|PATRIMONIO_NETO|RESULTADO_POSITIVO|RESULTADO_NEGATIVO, activa Bool }`; único `empresaId+codigo`. Código jerárquico con puntos (`1`, `1.1`, `1.1.01`, `1.1.01.001`).
  - `PLAN_CUENTAS_MODELO: { codigo, nombre, imputable, tipo }[]` — plan argentino estándar (Activo/Pasivo/PN/Resultados) que incluya como mínimo las cuentas imputables: Caja, Bancos (cuenta corriente), Valores a depositar, Deudores por ventas, IVA Crédito Fiscal, Percepciones IVA sufridas, Percepciones IIBB sufridas, Retenciones sufridas, Anticipos a proveedores, Bienes de uso, Proveedores, Cheques diferidos a pagar, IVA Débito Fiscal, Retenciones Ganancias a depositar, Retenciones IVA a depositar, Retenciones IIBB a depositar, Retenciones SUSS a depositar, Capital, Resultados no asignados, Ventas, Costo de mercaderías vendidas, Gastos generales, Gastos bancarios, Diferencias de cambio.
  - `PlanCuentasService.cargarModelo(tx): Promise<number>` — se ejecuta al crear una empresa (llamar desde `EmpresasService.crear`).
  - REST: `GET /api/plan-cuentas` (árbol completo: nodos `{ id, codigo, nombre, imputable, tipo, hijos }`), `POST`, `PATCH /:id`. Reglas: el padre debe existir y ser no imputable; el código del hijo empieza con el del padre + `.`; una cuenta con hijos no puede pasar a imputable; el tipo se hereda del padre.

- [ ] **Step 1: Tests que fallan:** al crear empresa existe el plan modelo (cantidad = `PLAN_CUENTAS_MODELO.length`) y `GET` devuelve árbol con raíces `1..5`; crear hija bajo cuenta imputable → 400 `"La cuenta padre no admite subcuentas"`; código que no empieza con el del padre → 400; código duplicado → 409.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5: Commit** `feat(api): plan de cuentas jerárquico con modelo argentino`

---

### Task 9: Artículos, monedas, centros de costo y depósitos

**Files:**
- Modify: `schema.prisma`, `modelos-empresa.ts`
- Create: `apps/api/src/articulos/*`, `apps/api/src/monedas/*`, `apps/api/src/organizacion/*` (module, service, controller cada uno)
- Test: `apps/api/test/{articulos,monedas,organizacion}.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `Articulo { id, empresaId, codigo String, descripcion, unidad String, alicuotaIva Decimal(18,6), cuentaCompraId?, cuentaVentaId?, esServicio Bool, activo }`; único `empresaId+codigo`. Alícuotas permitidas: `0, 2.5, 5, 10.5, 21, 27` (constante `ALICUOTAS_IVA` en `packages/shared/src/iva.ts`). Las cuentas deben ser imputables.
  - `Moneda { codigo String @id ('ARS'|'USD'), nombre, simbolo }` (global, sin empresa; seed fijo) y `Cotizacion { id, empresaId, monedaCodigo, fecha Date, valor Decimal(18,6) }` único `empresaId+monedaCodigo+fecha`.
  - `MonedasService.cotizacion(monedaCodigo: string, fecha: Date): Promise<Decimal>` — ARS → 1; si no hay de esa fecha, la última anterior; si no hay ninguna → `400 "No hay cotización de USD para el DD/MM/AAAA"`.
  - `CentroCosto { id, empresaId, codigo, nombre, activo }`, `Deposito { id, empresaId, codigo, nombre, direccion?, activo }`.
  - REST CRUD (sin DELETE, con `activo`): `/api/articulos` (`articulo.ver/editar`, búsqueda `q`, paginado), `/api/monedas`, `/api/cotizaciones` (`moneda.editar`), `/api/centros-costo`, `/api/depositos` (`organizacion.editar`).

- [ ] **Step 1: Tests que fallan:** artículo con alícuota 19 → 400; con cuenta no imputable → 400; `cotizacion('USD', fecha)` usa la última anterior; sin cotizaciones → error con el mensaje indicado; `cotizacion('ARS', x)` = 1.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5: Commit** `feat(api): artículos, monedas, centros de costo y depósitos`

---

### Task 10: Maestros de tesorería

**Files:**
- Modify: `schema.prisma`, `modelos-empresa.ts`
- Create: `apps/api/src/tesoreria/maestros/*`
- Test: `apps/api/test/tesoreria-maestros.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `Banco { id, empresaId, nombre, codigoBcra String? }`.
  - `CuentaBancaria { id, empresaId, bancoId, numero, cbu String?, alias?, monedaCodigo, cuentaContableId, activa }` — CBU, si viene, 22 dígitos con validación de sus 2 dígitos verificadores (`validarCbu(s: string): boolean` en `packages/shared/src/cbu.ts`).
  - `Chequera { id, empresaId, cuentaBancariaId, tipo: FISICA|ECHEQ, desde Int?, hasta Int?, proximoNumero Int?, activa }` — para `FISICA`, `desde <= hasta` obligatorios.
  - `Caja { id, empresaId, nombre, monedaCodigo, cuentaContableId, activa }`.
  - REST CRUD bajo `/api/tesoreria/{bancos,cuentas-bancarias,chequeras,cajas}` (`tesoreria.maestros.editar`).

- [ ] **Step 1: Tests que fallan:** `validarCbu` acepta un CBU válido (fixture generado con el algoritmo de BCRA y anotado en el test) y rechaza uno con verificador alterado; cuenta bancaria con cuenta contable no imputable → 400; chequera física con `desde > hasta` → 400.
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** correr → PASS.
- [ ] **Step 5: Commit** `feat(api): bancos, cuentas, chequeras y cajas`

---

### Task 11: Web — login, selección de empresa y layout con menú en árbol

**Files:**
- Create: `apps/web/{package.json,vite.config.ts,tsconfig.json,index.html}`, `apps/web/src/{main.tsx,App.tsx}`, `apps/web/src/api/cliente.ts`, `apps/web/src/auth/{AuthContext.tsx,LoginPage.tsx,SeleccionEmpresaPage.tsx,RequiereAuth.tsx}`, `apps/web/src/layout/{AppLayout.tsx,MenuArbol.tsx,menu.ts}`
- Test: `apps/web/src/layout/menu.test.ts`, `apps/web/src/api/cliente.test.ts`

**Interfaces:**
- Consumes: endpoints de auth (Task 3).
- Produces:
  - `api<T>(ruta: string, opciones?: { metodo?, body?, query? }): Promise<T>` — agrega `Authorization`, base `/api` (proxy de Vite a `localhost:3000`), ante 401 limpia sesión y redirige a `/login`, ante error lanza `ErrorApi { status, mensaje, campos? }`.
  - `type NodoMenu = { titulo: string; ruta?: string; permiso?: Permiso; hijos?: NodoMenu[] }`; `MENU: NodoMenu[]` con la estructura de la spec: **Registraciones** (Compras y Cuentas a Pagar, Ventas y Cuentas a Cobrar, Tesorería, Contabilidad General), **Consultas** (mismas ramas), **Maestros** (Proveedores y clientes, Artículos, Plan de cuentas, Monedas y cotizaciones, Bancos y cajas, Centros de costo y depósitos), **Administración del sistema** (Empresa, Usuarios, Roles, Auditoría). Las ramas de entregas futuras aparecen con hoja "Próximamente" deshabilitada.
  - `filtrarMenu(menu: NodoMenu[], permisos: Permiso[]): NodoMenu[]` — quita hojas sin permiso y ramas que quedan vacías (salvo las "Próximamente").
  - Sesión en `localStorage` (`token`, `empresa`, `permisos`).
  - Encabezado con empresa activa, botón para cambiarla y cerrar sesión.

- [ ] **Step 1: Tests que fallan:** `filtrarMenu` quita la hoja "Usuarios" si falta `usuario.administrar` y elimina "Administración del sistema" si no queda ninguna hoja; `api()` ante respuesta 401 llama a `cerrarSesion()` (mock de `fetch`).
- [ ] **Step 2:** `pnpm --filter @gestion/web test` → FAIL.
- [ ] **Step 3: Implementar** las páginas y el layout con Mantine (`AppShell` + `NavLink` anidados).
- [ ] **Step 4:** `pnpm --filter @gestion/web test` → PASS; `pnpm --filter @gestion/web build` sin errores de tipos.
- [ ] **Step 5: Commit** `feat(web): login, selección de empresa y menú en árbol`

---

### Task 12: Web — ABM genérico y pantallas de maestros y administración

**Files:**
- Create: `apps/web/src/abm/{TablaAbm.tsx,FormAbm.tsx,tipos.ts}`, `apps/web/src/paginas/{Terceros,TerceroForm,Articulos,PlanCuentas,Monedas,Tesoreria,Organizacion,Empresa,Usuarios,Roles,Auditoria}Page.tsx`
- Test: `apps/web/src/abm/FormAbm.test.tsx`

**Interfaces:**
- Consumes: `api()` (Task 11), REST de Tasks 5–10, `validarCuit`, `ALICUOTAS_IVA`, `PERMISOS` de shared.
- Produces:
  - `TablaAbm<T>({ ruta, columnas: { campo: keyof T; titulo: string; render?: (fila: T) => ReactNode }[], filtros?, onSeleccionar })` — búsqueda `q`, paginado servidor, botón "Nuevo" según permiso.
  - `FormAbm` — formulario Mantine que muestra errores de campo devueltos por la API (`ErrorApi.campos`) bajo cada input y el mensaje general en una notificación.
  - Plan de cuentas: vista de árbol expandible con alta de subcuenta sobre un nodo.
  - Tercero: pestañas "Datos generales" e "Impuestos" (régimen Ganancias, exenciones, tabla IIBB por jurisdicción); CUIT validado en el cliente con `validarCuit` antes de enviar.
  - Roles: lista de checkboxes agrupada por módulo a partir de `PERMISOS`.
  - Auditoría: tabla filtrable por entidad y fecha.

- [ ] **Step 1: Test que falla:** `FormAbm` renderizado con un submit que rechaza `ErrorApi { status: 400, campos: { cuit: 'CUIT inválido' } }` muestra el texto "CUIT inválido" junto al campo CUIT (Testing Library).
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: Implementar** componentes y páginas; registrar rutas en `App.tsx` coincidiendo con `MENU`.
- [ ] **Step 4:** tests → PASS; `build` sin errores.
- [ ] **Step 5: Commit** `feat(web): ABM de maestros y administración`

---

### Task 13: Seed demo, Docker completo, e2e y README

**Files:**
- Create: `apps/api/src/seed/demo.ts`, `apps/api/prisma/seed.ts`, `apps/api/Dockerfile`, `apps/web/Dockerfile` (build estático servido por nginx con proxy `/api`), `apps/web/nginx.conf`
- Modify: `docker-compose.yml` (servicios `postgres`, `api`, `web`; la api corre `prisma migrate deploy` al iniciar)
- Create: `e2e/{package.json,playwright.config.ts,login-y-proveedor.spec.ts}`, `README.md`

**Interfaces:**
- Produces:
  - Seed demo idempotente: superadmin `admin@demo.com` / `admin1234`; empresa "Demo S.A." (CUIT `30-71234567-1`, Responsable Inscripto, punto de venta 1); roles Administrador, Comprador (`tercero.ver`, `articulo.ver`, `oc.crear`, `ir.crear`, `fc.crear`), Tesorero (`tercero.ver`, `op.crear`, `pago.ejecutar`, `tesoreria.maestros.editar`), Contador (`plancuentas.*`, `auditoria.ver`); 5 proveedores y 3 clientes con CUIT válidos, 10 artículos, cotización USD del día, Banco Nación con cuenta corriente y chequera e-cheq, Caja principal, 2 centros de costo, 1 depósito.
  - Comando: `pnpm seed`.

- [ ] **Step 1: Test e2e que falla** (`login-y-proveedor.spec.ts`, Playwright contra `pnpm dev` con DB sembrada): login como admin → elegir "Demo S.A." → menú Maestros › Proveedores y clientes → Nuevo → cargar CUIT `20-12345678-6` y razón social "Proveedor E2E" → guardar → aparece en la lista; cargar CUIT `20-12345678-5` muestra "CUIT inválido".
- [ ] **Step 2:** correr `pnpm e2e` → FAIL (seed/flujo incompleto).
- [ ] **Step 3: Implementar** seed, Dockerfiles y compose.
- [ ] **Step 4:** `pnpm e2e` → PASS; `docker compose up --build` levanta y `curl localhost:8080/api/salud` → `{"ok":true}`; `pnpm test` en la raíz → todo verde.
- [ ] **Step 5: README** en castellano: requisitos, cómo levantar en desarrollo y con Docker, usuario demo, estructura del repo, cómo correr tests, regla de `TenantPrisma` para nuevos módulos.
- [ ] **Step 6: Commit** `feat: seed demo, docker compose, e2e y README`

---

## Cobertura de la spec (Entrega 1)

| Spec | Task |
|---|---|
| §1 Stack, estructura, Docker | 1, 2, 13 |
| §1 Multi-empresa, usuario con varias empresas | 3, 4 |
| §1 Roles y permisos por acción | 5 |
| §1 Auditoría | 5 (+ uso en 7–10) |
| §2 Empresa, puntos de venta, agente de retención* | 5 |
| §2 Proveedores/clientes con datos de padrón | 7 |
| §2 Artículos, monedas/cotizaciones, centros de costo, depósitos | 9 |
| §2 Plan de cuentas con modelo argentino | 8 |
| §2 Bancos, cuentas, chequeras, cajas | 10 |
| §2 Numeración por tipo y punto de venta | 6 |
| §2 Interfaz árbol Registraciones/Consultas | 11, 12 |
| §8 Errores en castellano, validación compartida | 4, 5, 12 |
| §9 Datos demo, e2e | 13 |

\* Los flags de agente de retención de la empresa (`agenteRetencionGanancias`, `agenteRetencionIva`, `agenteRetencionSuss`, `jurisdiccionesIibb String[]`) se agregan al modelo `Empresa` en Task 5 y se editan en la página Empresa (Task 12); su uso es en la Entrega 3.

Fuera de esta entrega (estados de comprobante, trazabilidad, asientos automáticos): se implementan con los primeros comprobantes en la Entrega 2.
