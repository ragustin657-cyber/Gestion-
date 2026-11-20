-- E39: hasta hoy la alícuota de percepción de la ficha no se usaba; el 0 pasa a "sin dato".
UPDATE "TerceroIibb" SET "alicuotaPercepcion" = NULL WHERE "alicuotaPercepcion" = 0;

-- Cuentas de las percepciones practicadas (E39) en cada empresa con la cuenta madre, y sus cuentas por concepto.
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", v.codigo, v.nombre, p."id", true, 'PASIVO'::"TipoCuenta", true, true
FROM "CuentaContable" p
JOIN (VALUES ('2.1.02.008', 'Percepciones IIBB a depositar'), ('2.1.02.009', 'Percepciones IVA a depositar')) AS v(codigo, nombre)
  ON p."codigo" = '2.1.02' AND p."imputable" = false
WHERE NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = v.codigo);

INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", v.concepto, c."id"
FROM "CuentaContable" c
JOIN (VALUES ('PERCEPCION_IIBB_PRACTICADA', '2.1.02.008'), ('PERCEPCION_IVA_PRACTICADA', '2.1.02.009')) AS v(concepto, codigo) ON c."codigo" = v.codigo
ON CONFLICT ("empresaId", "concepto") DO NOTHING;
