-- Concepto 210 "Comisiones" (fijo, no remunerativo, sin convenio) en las empresas con conceptos de sueldos
INSERT INTO "Concepto" ("id","empresaId","convenioId","codigo","nombre","clase","tipo","parametros","orden","soloAfiliados","activo","destino")
SELECT gen_random_uuid(), b."empresaId", NULL, '210', 'Comisiones', 'NO_REMUNERATIVO', 'FIJO', '{}', 210, false, true, 'OTRO' FROM "Concepto" b
WHERE b."codigo" = '100' AND NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = b."empresaId" AND x."codigo" = '210');

-- Queda configurado como concepto de comisiones donde no hay otro
UPDATE "ConfiguracionSueldos" cfg SET "conceptoComisionesId" = c."id" FROM "Concepto" c
WHERE c."empresaId" = cfg."empresaId" AND c."codigo" = '210' AND c."nombre" = 'Comisiones' AND cfg."conceptoComisionesId" IS NULL;
