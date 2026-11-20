-- AlterTable
ALTER TABLE "ConfigImpuestos" ADD COLUMN     "iibbInicioAnio" INTEGER,
ADD COLUMN     "iibbInicioMes" INTEGER;

-- CreateTable
CREATE TABLE "JurisdiccionCm" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "jurisdiccion" TEXT NOT NULL,
    "coeficiente" DECIMAL(9,6) NOT NULL,
    "alicuota" DECIMAL(9,4) NOT NULL,
    "actividad" TEXT NOT NULL,
    "saldoInicial" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "JurisdiccionCm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosicionIibb" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "ingresos" DECIMAL(18,2) NOT NULL,
    "detalle" JSONB NOT NULL,
    "asientoId" UUID,
    "cerradoEn" TIMESTAMP(3),
    "cerradoPor" UUID,

    CONSTRAINT "PosicionIibb_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JurisdiccionCm_empresaId_anio_jurisdiccion_key" ON "JurisdiccionCm"("empresaId", "anio", "jurisdiccion");

-- CreateIndex
CREATE UNIQUE INDEX "PosicionIibb_empresaId_anio_mes_key" ON "PosicionIibb"("empresaId", "anio", "mes");

