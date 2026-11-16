-- AlterEnum
ALTER TYPE "TipoConcepto" ADD VALUE 'VACACIONES';

-- AlterTable
ALTER TABLE "ConfiguracionSueldos" ADD COLUMN     "anioInicioVacaciones" INTEGER NOT NULL DEFAULT 2026;

-- AlterTable
ALTER TABLE "ReciboSueldoRenglon" ADD COLUMN     "vacacionPeriodoId" UUID;

-- CreateTable
CREATE TABLE "VacacionPeriodo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "empleadoId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "dias" INTEGER NOT NULL,
    "liquidadoAfuera" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacacionPeriodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacacionSaldoInicial" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "empleadoId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "dias" INTEGER NOT NULL,

    CONSTRAINT "VacacionSaldoInicial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VacacionPeriodo_empresaId_empleadoId_idx" ON "VacacionPeriodo"("empresaId", "empleadoId");

-- CreateIndex
CREATE UNIQUE INDEX "VacacionSaldoInicial_empleadoId_anio_key" ON "VacacionSaldoInicial"("empleadoId", "anio");

