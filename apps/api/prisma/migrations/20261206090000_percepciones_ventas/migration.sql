-- AlterEnum
ALTER TYPE "TipoPresentacion" ADD VALUE 'ARBA_PERCEPCIONES';

-- AlterTable
ALTER TABLE "ComprobanteVenta" ADD COLUMN     "percepciones" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ConfigImpuestos" ADD COLUMN     "arbaActividadPercepcion" TEXT NOT NULL DEFAULT '7';

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "agentePercepcionIva" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "JurisdiccionIibb" ADD COLUMN     "alicuotaPercepcionDefecto" DECIMAL(18,6) NOT NULL DEFAULT 0,
ADD COLUMN     "minimoPercepcion" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "percibe" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sinPadronPercepcion" "SinPadron" NOT NULL DEFAULT 'NO_RETENER';

-- AlterTable
ALTER TABLE "TerceroIibb" ALTER COLUMN "alicuotaPercepcion" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ComprobanteVentaPercepcion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "jurisdiccion" TEXT,
    "regimenCodigo" TEXT,
    "tramo" TEXT,
    "base" DECIMAL(18,2) NOT NULL,
    "alicuota" DECIMAL(9,4) NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "origenAlicuota" TEXT NOT NULL,
    "exclusionPct" INTEGER,

    CONSTRAINT "ComprobanteVentaPercepcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegimenPercepcionIva" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "alicuotaGeneral" DECIMAL(9,4) NOT NULL,
    "alicuotaReducida" DECIMAL(9,4) NOT NULL,
    "minimoNeto" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RegimenPercepcionIva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComprobanteVentaPercepcion_empresaId_comprobanteId_idx" ON "ComprobanteVentaPercepcion"("empresaId", "comprobanteId");

-- CreateIndex
CREATE UNIQUE INDEX "RegimenPercepcionIva_empresaId_codigo_key" ON "RegimenPercepcionIva"("empresaId", "codigo");

-- AddForeignKey
ALTER TABLE "ComprobanteVentaPercepcion" ADD CONSTRAINT "ComprobanteVentaPercepcion_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

