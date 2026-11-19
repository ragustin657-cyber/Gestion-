-- Cuentas por concepto de las retenciones de IVA y SUSS practicadas (E35), para las empresas existentes con esas cuentas en su plan.
INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", v.concepto, c."id"
FROM "CuentaContable" c
JOIN (VALUES ('RETENCION_IVA', '2.1.02.003'), ('RETENCION_SUSS', '2.1.02.005')) AS v(concepto, codigo) ON c."codigo" = v.codigo
ON CONFLICT ("empresaId", "concepto") DO NOTHING;
