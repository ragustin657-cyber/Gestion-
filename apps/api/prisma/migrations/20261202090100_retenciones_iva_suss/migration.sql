
-- AlterTable
ALTER TABLE "OrdenPagoRetencion" ADD COLUMN     "comprobanteCompraId" UUID;

-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "exclusionIvaHasta" DATE,
ADD COLUMN     "exclusionIvaPorcentaje" INTEGER,
ADD COLUMN     "exclusionIvaPublicacion" DATE,
ADD COLUMN     "regimenIvaId" UUID,
ADD COLUMN     "regimenSussId" UUID;

-- CreateTable
CREATE TABLE "RegimenIva" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigoSire" TEXT,
    "descripcion" TEXT NOT NULL,
    "porcentaje" DECIMAL(9,4) NOT NULL,
    "minimoComprobante" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minimoRetencion" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "condicionSire" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RegimenIva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegimenSuss" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigoSire" TEXT,
    "descripcion" TEXT NOT NULL,
    "porcentaje" DECIMAL(9,4) NOT NULL,
    "minimoNoSujeto" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minimoRetencion" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RegimenSuss_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegimenIva_empresaId_descripcion_key" ON "RegimenIva"("empresaId", "descripcion");

-- CreateIndex
CREATE UNIQUE INDEX "RegimenSuss_empresaId_descripcion_key" ON "RegimenSuss"("empresaId", "descripcion");

