# Entrega 36 — Seguridad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Login con tiempo parejo y límite de intentos; permisos web al día; filtro por empresa completo; identificadores de otra empresa rechazados; aplicación de cobros solo entre movimientos del cliente; FK de sucursal del usuario.
**Spec:** `docs/superpowers/specs/2026-11-20-entrega-36-seguridad-design.md`

## Global Constraints
- Mensajes exactos: `Demasiados intentos: espere unos minutos` (429); `El movimiento no es de la cuenta corriente del cliente` (400).
- Límite: 5 fallidos por clave en 15 minutos.
- No correr jest y la e2e en paralelo.

## Review Focus
1. Un usuario legítimo con 5 fallos ajenos desde su misma IP: queda bloqueado 15 minutos (aceptado) y luego entra (Task 1).
2. Pruebas e2e y demo que loguean muchas veces: no se bloquean por IP (Task 1: el límite cuenta solo fallidos).
3. Superadmin sin rol en la empresa ve todo el menú (Task 2).
4. Recibo con aplicación a una compra de un tercero que es cliente y proveedor: 400 (Task 3).
5. Identificadores de otra empresa en renglones de factura de venta: 400 sin crear el comprobante (Task 3).

---

### Task 1: Login (tiempo parejo y límite)
**Files:** `apps/api/prisma/schema.prisma` + migración `20261203090000_intentos_login`; `apps/api/src/auth/auth.{service,controller}.ts`. **Test:** `apps/api/test/seguridad-login.e2e-spec.ts`.
- [ ] Pruebas que fallan: 5 contraseñas malas → el 6.º intento (aun con la correcta) da 429 con el mensaje; otro email no se bloquea; con el reloj 16 minutos después entra; 5 fallos con emails distintos desde la misma IP → 429 para un sexto email; un login correcto no deja intentos; el email inexistente llama a `verify` (espía sobre el hash ficticio).
- [ ] Implementar: `IntentoLogin` global (fuera de `MODELOS_DE_EMPRESA`); IP de `req.ip`; limpiar los de más de 15 minutos al registrar.
- [ ] `npx jest --runInBand test/seguridad-login test/auth` → PASS. Commit `fix(seguridad): login con tiempo parejo y límite de intentos`.

### Task 2: Permisos en la web
**Files:** `apps/web/src/auth/AuthContext.tsx`. **Test:** `apps/web/src/auth/AuthContext.test.tsx` (nuevo o existente).
- [ ] Pruebas que fallan: con `superadmin: true` y sin permisos, `puede('x')` es verdadero; al disparar `visibilitychange` (visible), consulta `/auth/yo` y actualiza los permisos de la sesión.
- [ ] Implementar (intervalo de 5 minutos y `visibilitychange`; se limpia al salir).
- [ ] `cd apps/web && npx vitest run && pnpm build` → PASS. Commit `fix(web): permisos al día y superadmin`.

### Task 3: Integridad entre empresas
**Files:** `apps/api/src/prisma/tenant-prisma.service.ts`; servicios de compras, ventas (comprobantes, pedidos, remitos) y aplicaciones; `schema.prisma` + migración `20261203090100_usuario_sucursal_fk`. **Tests:** `apps/api/src/prisma/tenant-prisma.spec.ts`, `apps/api/test/seguridad-empresas.e2e-spec.ts`.
- [ ] Pruebas que fallan: `updateManyAndReturn` de otra empresa no toca filas; por cada campo (depósito, artículo y centro de costo de renglones, comprobante asociado en compras y ventas, lista de precios y depósito del pedido, depósito y artículo del remito) un id de otra empresa → 400 y no se crea nada (las que ya pasan se registran como ya validadas); aplicación de un recibo a una compra del mismo tercero → 400 con el mensaje; sucursal inexistente en `UsuarioEmpresa` rechazada por la FK.
- [ ] Implementar: `updateManyAndReturn` en `CON_WHERE`; un helper `existeEnEmpresa(tx, modelo, id)` y mensajes `<Cosa> inexistente`; control en `aplicarEnTx`; FK con la migración (huérfanos a null).
- [ ] `npx jest --runInBand test/seguridad-empresas src/prisma test/ventas test/compras test/usuarios` → PASS. Commit `fix(seguridad): integridad entre empresas`.

Al final: suite completa, web y e2e sola; revisión final.
