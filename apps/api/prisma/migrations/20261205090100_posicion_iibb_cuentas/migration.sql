-- Cuentas de la liquidación de IIBB (E38) en cada empresa con la cuenta madre, y sus cuentas por concepto.
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", v.codigo, v.nombre, p."id", true, v.tipo::"TipoCuenta", true, v.monetaria
FROM "CuentaContable" p
JOIN (VALUES ('1.1.03', '1.1.03.011', 'IIBB Saldo a favor', 'ACTIVO', true), ('2.1.02', '2.1.02.007', 'IIBB a pagar', 'PASIVO', true), ('5.2', '5.2.13', 'Impuesto sobre los ingresos brutos', 'RESULTADO_NEGATIVO', false))
  AS v(madre, codigo, nombre, tipo, monetaria) ON p."codigo" = v.madre AND p."imputable" = false
WHERE NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = v.codigo);

INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", v.concepto, c."id"
FROM "CuentaContable" c
JOIN (VALUES ('IIBB_IMPUESTO', '5.2.13'), ('IIBB_SALDO_A_FAVOR', '1.1.03.011'), ('IIBB_A_PAGAR', '2.1.02.007')) AS v(concepto, codigo) ON c."codigo" = v.codigo
ON CONFLICT ("empresaId", "concepto") DO NOTHING;
