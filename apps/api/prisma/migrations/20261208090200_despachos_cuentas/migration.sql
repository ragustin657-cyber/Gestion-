-- Cuentas de los despachos de importación (E41) en cada empresa con la cuenta madre, y sus cuentas por concepto.
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", v.codigo, v.nombre, p."id", true, v.tipo::"TipoCuenta", true, v.monetaria
FROM "CuentaContable" p
JOIN (VALUES ('1.1.03', '1.1.03.012', 'Percepciones Ganancias sufridas', 'ACTIVO', true), ('5.1', '5.1.02', 'Derechos y tasas de importación', 'RESULTADO_NEGATIVO', false))
  AS v(madre, codigo, nombre, tipo, monetaria) ON p."codigo" = v.madre AND p."imputable" = false
WHERE NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = v.codigo);

INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", v.concepto, c."id"
FROM "CuentaContable" c
JOIN (VALUES ('PERCEPCION_GANANCIAS', '1.1.03.012'), ('COSTO_IMPORTACION', '5.1.02')) AS v(concepto, codigo) ON c."codigo" = v.codigo
ON CONFLICT ("empresaId", "concepto") DO NOTHING;
