-- CreateEnum
CREATE TYPE "RubroExentoGanancias" AS ENUM ('ASIGNACIONES_FAMILIARES', 'INTERESES_PRESTAMOS', 'INDEMNIZACIONES', 'CURSOS_SEMINARIOS', 'INDUMENTARIA');

-- AlterEnum
ALTER TYPE "TipoConcepto" ADD VALUE 'GANANCIAS_AJUSTE';

-- AlterTable
ALTER TABLE "Concepto" ADD COLUMN     "rubroExentoGanancias" "RubroExentoGanancias",
ADD COLUMN     "rubroExentoPorDefecto" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReciboSueldoRenglon" ADD COLUMN     "anioAjusteGanancias" INTEGER;

-- CreateTable
CREATE TABLE "LiquidacionAnualGanancias" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "cerradoEn" TIMESTAMP(3),
    "cerradoPor" TEXT,

    CONSTRAINT "LiquidacionAnualGanancias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionAnualGananciasEmpleado" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anualId" UUID NOT NULL,
    "empleadoId" UUID NOT NULL,
    "distracto" BOOLEAN NOT NULL DEFAULT false,
    "liquidacionFinalId" UUID,
    "hoja" JSONB NOT NULL,
    "f1359" JSONB NOT NULL,
    "impuesto" DECIMAL(18,2) NOT NULL,
    "retenido" DECIMAL(18,2) NOT NULL,
    "pagosACuenta" DECIMAL(18,2) NOT NULL,
    "saldo" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "LiquidacionAnualGananciasEmpleado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiquidacionAnualGanancias_empresaId_anio_key" ON "LiquidacionAnualGanancias"("empresaId", "anio");

-- CreateIndex
CREATE INDEX "LiquidacionAnualGananciasEmpleado_empresaId_idx" ON "LiquidacionAnualGananciasEmpleado"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidacionAnualGananciasEmpleado_anualId_empleadoId_key" ON "LiquidacionAnualGananciasEmpleado"("anualId", "empleadoId");

-- AddForeignKey
ALTER TABLE "LiquidacionAnualGananciasEmpleado" ADD CONSTRAINT "LiquidacionAnualGananciasEmpleado_anualId_fkey" FOREIGN KEY ("anualId") REFERENCES "LiquidacionAnualGanancias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

