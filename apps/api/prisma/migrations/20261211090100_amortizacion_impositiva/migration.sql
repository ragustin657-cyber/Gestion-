-- AlterTable
ALTER TABLE "BienUso" ADD COLUMN     "valorTerreno" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vidaUtilImpositivaAnios" INTEGER;

-- AlterTable
ALTER TABLE "ConfigImpuestos" ADD COLUMN     "topeAutomovilesCosto" DECIMAL(18,2) NOT NULL DEFAULT 20000;

-- AlterTable
ALTER TABLE "RubroBienUso" ADD COLUMN     "tipoImpositivo" "TipoImpositivoBien" NOT NULL DEFAULT 'MUEBLE',
ADD COLUMN     "vidaUtilImpositivaAnios" INTEGER;
