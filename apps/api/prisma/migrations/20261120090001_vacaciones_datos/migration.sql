-- Conceptos de vacaciones (150 y 151) en las empresas con el convenio de Comercio, si el código está libre.
-- Va en una migración aparte porque usa el valor 'VACACIONES' agregado al enum en la anterior.
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo", "destino")
SELECT gen_random_uuid(), v."empresaId", '150', 'Vacaciones', 'REMUNERATIVO', 'VACACIONES', '{"divisor": 25}'::jsonb, 150, false, true, 'OTRO'
FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = v."empresaId" AND x."codigo" = '150');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo", "destino")
SELECT gen_random_uuid(), v."empresaId", '151', 'Descuento días de vacaciones', 'REMUNERATIVO', 'VACACIONES', '{"divisor": 30, "descuenta": true}'::jsonb, 151, false, true, 'OTRO'
FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = v."empresaId" AND x."codigo" = '151');
