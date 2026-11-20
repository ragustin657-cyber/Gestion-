-- Cuenta del crédito fiscal no computable (E40) en cada empresa con la cuenta madre, y su cuenta por concepto.
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '5.2.14', 'IVA crédito fiscal no computable', p."id", true, 'RESULTADO_NEGATIVO'::"TipoCuenta", true, false
FROM "CuentaContable" p
WHERE p."codigo" = '5.2' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '5.2.14');

INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'IVA_NO_COMPUTABLE', c."id" FROM "CuentaContable" c WHERE c."codigo" = '5.2.14'
ON CONFLICT ("empresaId", "concepto") DO NOTHING;
