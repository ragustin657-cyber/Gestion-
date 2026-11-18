-- Concepto de cuenta INTERESES_GANADOS (4.2.02 "Intereses ganados") en las empresas que tienen esa cuenta
INSERT INTO "ConfigCuenta" ("id","empresaId","concepto","cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'INTERESES_GANADOS', c."id" FROM "CuentaContable" c
WHERE c."codigo" = '4.2.02' AND c."nombre" = 'Intereses ganados'
  AND NOT EXISTS (SELECT 1 FROM "ConfigCuenta" x WHERE x."empresaId" = c."empresaId" AND x."concepto" = 'INTERESES_GANADOS');

-- Permiso nuevo para el rol Administrador de las empresas existentes
UPDATE "Rol" SET "permisos" = array_append("permisos", 'intereses.liquidar') WHERE "nombre" = 'Administrador' AND NOT ('intereses.liquidar' = ANY("permisos"));
