-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "agenteRetencionGanancias" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agenteRetencionIva" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agenteRetencionSuss" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jurisdiccionesIibb" TEXT[];
