-- Precarga de regímenes de IVA y SUSS (E35) para las empresas existentes con configuración de pagos.
-- Porcentajes de referencia, a verificar; el código SIRE se carga a mano (la tabla de ARCA no está disponible).
INSERT INTO "RegimenIva" ("id", "empresaId", "descripcion", "porcentaje")
SELECT gen_random_uuid(), e."empresaId", v.descripcion, v.porcentaje
FROM (SELECT DISTINCT "empresaId" FROM "RegimenGanancias") e
CROSS JOIN (VALUES ('Compraventa de cosas muebles', 50), ('Locaciones de obras y servicios', 80), ('Proveedor con incumplimientos (100 %)', 100)) AS v(descripcion, porcentaje)
ON CONFLICT DO NOTHING;

INSERT INTO "RegimenSuss" ("id", "empresaId", "descripcion", "porcentaje")
SELECT gen_random_uuid(), e."empresaId", v.descripcion, v.porcentaje
FROM (SELECT DISTINCT "empresaId" FROM "RegimenGanancias") e
CROSS JOIN (VALUES ('Construcción', 1.2), ('Limpieza de inmuebles', 6), ('Investigación y seguridad', 6), ('Empresas de servicios eventuales', 2)) AS v(descripcion, porcentaje)
ON CONFLICT DO NOTHING;
