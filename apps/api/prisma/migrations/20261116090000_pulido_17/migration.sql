-- Numeración atómica de bienes de uso: el talonario arranca en el último número de cada empresa
INSERT INTO "Talonario" ("id", "empresaId", "tipoComprobante", "puntoVenta", "ultimoNumero")
SELECT gen_random_uuid(), b."empresaId", 'BIEN_USO', 0, MAX(b."numero")
FROM "BienUso" b
GROUP BY b."empresaId"
ON CONFLICT ("empresaId", "tipoComprobante", "puntoVenta") DO UPDATE SET "ultimoNumero" = GREATEST("Talonario"."ultimoNumero", EXCLUDED."ultimoNumero");
