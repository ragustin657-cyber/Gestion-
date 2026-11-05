-- Eliminar duplicados (jurisdicción + CUIT + vigencia) antes de crear la restricción única
DELETE FROM "PadronIibb" a USING "PadronIibb" b
WHERE a."jurisdiccion" = b."jurisdiccion" AND a."cuit" = b."cuit" AND a."vigenciaDesde" = b."vigenciaDesde" AND a."id" > b."id";

-- DropIndex
DROP INDEX IF EXISTS "PadronIibb_jurisdiccion_cuit_vigenciaDesde_idx";

-- CreateIndex
CREATE UNIQUE INDEX "PadronIibb_jurisdiccion_cuit_vigenciaDesde_key" ON "PadronIibb"("jurisdiccion", "cuit", "vigenciaDesde");
