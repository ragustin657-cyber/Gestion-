-- AlterTable
ALTER TABLE "ConfigImpuestos" ADD COLUMN     "sireMotivoAnulacion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "OrdenPagoRetencion" ADD COLUMN     "anuladaEn" DATE,
ADD COLUMN     "certificadoSire" TEXT;

