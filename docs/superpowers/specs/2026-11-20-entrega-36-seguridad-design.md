# Entrega 36 — Pulido de seguridad e integridad entre empresas

## Intención
Cerrar las observaciones de seguridad e integridad entre empresas que quedaron pendientes en las revisiones (`docs/pendientes.md` §3.7 y relacionadas), antes de seguir con funcionalidad nueva.

## Alcance (aprobado)
1. **Login.**
   - Tiempo parejo: con email inexistente o usuario inactivo se verifica contra un hash ficticio.
   - Límite de intentos: 5 fallidos por email y 5 por IP en 15 minutos → 429 `Demasiados intentos: espere unos minutos`. Un login correcto borra los intentos de ese email.
   - Modelo global (sin empresa) `IntentoLogin { id, clave, creadoEn }` con índice por `(clave, creadoEn)`; claves `email:<email>` e `ip:<ip>`.
   - El 429 se responde también con la contraseña correcta mientras el límite esté vigente.
2. **Permisos en la web.**
   - `puede()` devuelve verdadero para un superadmin.
   - La sesión refresca permisos, superadmin y sucursal desde `GET /api/auth/yo` al volver a la pestaña y cada 5 minutos. Un 401 cierra la sesión, como hoy.
3. **Extensión por empresa:** `updateManyAndReturn` se filtra por empresa como `updateMany`.
4. **Identificadores de otra empresa.** En compras, ventas, pedidos y remitos, un identificador que no pertenece a la empresa (centro de costo, depósito, artículo, comprobante asociado, lista de precios) da 400 con el mensaje del campo (`<Cosa> inexistente`), nunca un dato inconsistente ni un 500. Los que ya se validan se dejan como están.
5. **Aplicación de cobros:** los dos movimientos de cada ítem tienen que ser de cliente (`ORIGENES_CLIENTE`) y del tercero indicado → 400 `El movimiento no es de la cuenta corriente del cliente`.
6. **Clave foránea** `UsuarioEmpresa.sucursalId → Sucursal.id` (SET NULL); la migración pone en null los huérfanos.

## Enfoques
- Elegido: una entrega de pulido con un cambio y su prueba por punto.
- Límite en memoria descartado: no funciona con varias instancias de la API ni sobrevive a un reinicio.

## No objetivos
- El nombre visible de un usuario existente al agregarlo a otra empresa: el usuario es global.
- La acreditación de transferencias por usuarios de sucursal: es una regla de permisos.
- Escrituras anidadas en la extensión por empresa: siguen pasando `empresaId` explícito, como hoy.
- Captcha y bloqueo permanente de cuentas.
