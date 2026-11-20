-- CreateEnum
CREATE TYPE "EstadoPosicionIva" AS ENUM ('BORRADOR', 'CERRADA');

-- AlterTable
ALTER TABLE "ConfigImpuestos" ADD COLUMN     "ivaInicioAnio" INTEGER,
ADD COLUMN     "ivaInicioMes" INTEGER,
ADD COLUMN     "ivaSaldoLibreInicial" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ivaSaldoTecnicoInicial" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PosicionIva" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "estado" "EstadoPosicionIva" NOT NULL DEFAULT 'CERRADA',
    "debito" JSONB NOT NULL,
    "credito" JSONB NOT NULL,
    "totalDebito" DECIMAL(18,2) NOT NULL,
    "totalCredito" DECIMAL(18,2) NOT NULL,
    "saldoTecnicoAnterior" DECIMAL(18,2) NOT NULL,
    "libreAnterior" DECIMAL(18,2) NOT NULL,
    "retenciones" DECIMAL(18,2) NOT NULL,
    "percepciones" DECIMAL(18,2) NOT NULL,
    "saldoTecnicoAFavor" DECIMAL(18,2) NOT NULL,
    "impuestoDeterminado" DECIMAL(18,2) NOT NULL,
    "impuestoAPagar" DECIMAL(18,2) NOT NULL,
    "libreDisponibilidad" DECIMAL(18,2) NOT NULL,
    "asientoId" UUID,
    "cerradoEn" TIMESTAMP(3),
    "cerradoPor" UUID,

    CONSTRAINT "PosicionIva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosicionIva_empresaId_anio_mes_key" ON "PosicionIva"("empresaId", "anio", "mes");

