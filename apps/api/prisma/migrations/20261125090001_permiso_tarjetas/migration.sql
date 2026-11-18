-- Permiso de la Entrega 23 (liquidar tarjetas) para el rol Administrador de las empresas existentes.
-- La migración anterior (20261125090000_pulido_26) agregó los de la Entrega 24 (venta.maestros y comisiones.liquidar).
UPDATE "Rol" SET "permisos" = array_append("permisos", 'tesoreria.tarjetas') WHERE "nombre" = 'Administrador' AND NOT ('tesoreria.tarjetas' = ANY("permisos"));
