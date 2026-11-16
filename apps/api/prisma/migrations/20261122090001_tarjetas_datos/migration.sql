-- Cuentas de tarjetas en las empresas con plan (código libre y padre esperado)
INSERT INTO "CuentaContable" ("id","empresaId","codigo","nombre","padreId","imputable","tipo","activa","monetaria")
SELECT gen_random_uuid(), p."empresaId", '1.1.02.003', 'Tarjetas a cobrar', p."id", true, 'ACTIVO', true, true FROM "CuentaContable" p
WHERE p."codigo" = '1.1.02' AND p."nombre" = 'Créditos por ventas' AND NOT p."imputable"
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '1.1.02.003');
INSERT INTO "CuentaContable" ("id","empresaId","codigo","nombre","padreId","imputable","tipo","activa","monetaria")
SELECT gen_random_uuid(), p."empresaId", '5.2.12', 'Comisiones de tarjetas', p."id", true, 'RESULTADO_NEGATIVO', true, false FROM "CuentaContable" p
WHERE p."codigo" = '5.2' AND p."nombre" = 'Gastos' AND NOT p."imputable"
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '5.2.12');

-- Configuración de cuentas por concepto
INSERT INTO "ConfigCuenta" ("id","empresaId","concepto","cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'TARJETAS_A_COBRAR', c."id" FROM "CuentaContable" c
WHERE c."codigo" = '1.1.02.003' AND c."nombre" = 'Tarjetas a cobrar'
  AND NOT EXISTS (SELECT 1 FROM "ConfigCuenta" x WHERE x."empresaId" = c."empresaId" AND x."concepto" = 'TARJETAS_A_COBRAR');
INSERT INTO "ConfigCuenta" ("id","empresaId","concepto","cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'COMISIONES_TARJETA', c."id" FROM "CuentaContable" c
WHERE c."codigo" = '5.2.12' AND c."nombre" = 'Comisiones de tarjetas'
  AND NOT EXISTS (SELECT 1 FROM "ConfigCuenta" x WHERE x."empresaId" = c."empresaId" AND x."concepto" = 'COMISIONES_TARJETA');
