-- CreateEnum
CREATE TYPE "EstadoCarga" AS ENUM ('PROCESANDO', 'COMPLETA', 'ERROR');

-- CreateTable
CREATE TABLE "PadronIibb" (
    "id" UUID NOT NULL,
    "jurisdiccion" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "vigenciaDesde" DATE NOT NULL,
    "vigenciaHasta" DATE NOT NULL,
    "alicuotaPercepcion" DECIMAL(18,6),
    "alicuotaRetencion" DECIMAL(18,6),

    CONSTRAINT "PadronIibb_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PadronCarga" (
    "id" UUID NOT NULL,
    "jurisdiccion" TEXT NOT NULL,
    "periodo" TEXT,
    "archivo" TEXT NOT NULL,
    "estado" "EstadoCarga" NOT NULL DEFAULT 'PROCESANDO',
    "filas" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PadronCarga_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PadronIibb_jurisdiccion_cuit_vigenciaDesde_idx" ON "PadronIibb"("jurisdiccion", "cuit", "vigenciaDesde");

-- CreateIndex
CREATE INDEX "PadronIibb_jurisdiccion_vigenciaDesde_idx" ON "PadronIibb"("jurisdiccion", "vigenciaDesde");
