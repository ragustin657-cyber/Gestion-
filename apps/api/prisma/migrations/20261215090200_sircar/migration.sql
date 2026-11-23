-- AlterTable
ALTER TABLE "ConfigImpuestos" ADD COLUMN     "jurisdiccionesSircar" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "JurisdiccionIibb" ADD COLUMN     "regimenSircarPercepcion" TEXT,
ADD COLUMN     "regimenSircarRetencion" TEXT;

