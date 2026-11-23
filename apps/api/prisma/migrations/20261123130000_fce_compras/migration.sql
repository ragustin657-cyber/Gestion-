-- DropIndex
DROP INDEX "ComprobanteCompra_empresaId_terceroId_tipo_letra_puntoVenta_key";

-- AlterTable
ALTER TABLE "ComprobanteCompra" ADD COLUMN     "fce" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteCompra_empresaId_terceroId_tipo_letra_fce_puntoV_key" ON "ComprobanteCompra"("empresaId", "terceroId", "tipo", "letra", "fce", "puntoVenta", "numero");

