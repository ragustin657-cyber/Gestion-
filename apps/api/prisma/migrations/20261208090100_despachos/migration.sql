-- AlterTable
ALTER TABLE "ComprobanteCompra" ADD COLUMN     "derechosImportacion" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "numeroDespacho" TEXT,
ADD COLUMN     "percepcionGanancias" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tasaEstadistica" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteCompra_empresaId_numeroDespacho_key" ON "ComprobanteCompra"("empresaId", "numeroDespacho");

