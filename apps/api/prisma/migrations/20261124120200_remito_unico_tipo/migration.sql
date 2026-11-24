-- DropIndex
DROP INDEX "Remito_empresaId_puntoVenta_numero_key";

-- CreateIndex
CREATE UNIQUE INDEX "Remito_empresaId_tipo_puntoVenta_numero_key" ON "Remito"("empresaId", "tipo", "puntoVenta", "numero");

