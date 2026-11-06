-- CreateEnum
CREATE TYPE "EstadoConciliacion" AS ENUM ('ABIERTA', 'CERRADA');

-- CreateEnum
CREATE TYPE "TipoVinculo" AS ENUM ('AUTOMATICO', 'MANUAL', 'REGISTRO');

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "diasToleranciaConciliacion" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "LineaExtracto" ADD COLUMN     "conciliacionId" UUID,
ADD COLUMN     "vinculoId" UUID;

-- AlterTable
ALTER TABLE "MovimientoTesoreria" ADD COLUMN     "vinculoId" UUID;

-- CreateTable
CREATE TABLE "Conciliacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "saldoInicial" DECIMAL(18,2) NOT NULL,
    "saldoFinal" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoConciliacion" NOT NULL DEFAULT 'ABIERTA',
    "resumen" JSONB,
    "cerradaPor" UUID,
    "cerradaEn" TIMESTAMP(3),
    "motivoReapertura" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "creadoPor" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conciliacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VinculoConciliacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "conciliacionId" UUID NOT NULL,
    "tipo" "TipoVinculo" NOT NULL,
    "creadoPor" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VinculoConciliacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conciliacion_empresaId_cuentaBancariaId_idx" ON "Conciliacion"("empresaId", "cuentaBancariaId");

-- CreateIndex
CREATE INDEX "VinculoConciliacion_empresaId_conciliacionId_idx" ON "VinculoConciliacion"("empresaId", "conciliacionId");


CREATE INDEX "MovimientoTesoreria_empresaId_cuentaBancariaId_fecha_idx" ON "MovimientoTesoreria"("empresaId", "cuentaBancariaId", "fecha");
