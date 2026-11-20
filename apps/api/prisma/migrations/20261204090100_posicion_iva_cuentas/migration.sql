-- Cuentas de la liquidación de IVA (E37) en cada empresa con la cuenta madre, y sus cuentas por concepto.
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", v.codigo, v.nombre, p."id", true, v.tipo::"TipoCuenta", true, true
FROM "CuentaContable" p
JOIN (VALUES ('1.1.03', '1.1.03.009', 'IVA Saldo técnico a favor', 'ACTIVO'), ('1.1.03', '1.1.03.010', 'IVA Saldo de libre disponibilidad', 'ACTIVO'), ('2.1.02', '2.1.02.006', 'IVA a pagar', 'PASIVO'))
  AS v(madre, codigo, nombre, tipo) ON p."codigo" = v.madre AND p."imputable" = false
WHERE NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = v.codigo);

INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", v.concepto, c."id"
FROM "CuentaContable" c
JOIN (VALUES ('IVA_SALDO_TECNICO', '1.1.03.009'), ('IVA_LIBRE_DISPONIBILIDAD', '1.1.03.010'), ('IVA_A_PAGAR', '2.1.02.006')) AS v(concepto, codigo) ON c."codigo" = v.codigo
ON CONFLICT ("empresaId", "concepto") DO NOTHING;
