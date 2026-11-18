-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "sinIntereses" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConfigIntereses" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "tasaMensual" DECIMAL(5,2) NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT 'Intereses por mora',

    CONSTRAINT "ConfigIntereses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionIntereses" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "tasa" DECIMAL(5,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidacionIntereses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionInteresesRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "liquidacionId" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "terceroId" UUID NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "saldo" DECIMAL(18,2) NOT NULL,
    "dias" INTEGER NOT NULL,
    "interes" DECIMAL(18,2) NOT NULL,
    "alicuota" TEXT NOT NULL,
    "notaDebitoId" UUID,

    CONSTRAINT "LiquidacionInteresesRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigIntereses_empresaId_key" ON "ConfigIntereses"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidacionIntereses_empresaId_numero_key" ON "LiquidacionIntereses"("empresaId", "numero");

-- CreateIndex
CREATE INDEX "LiquidacionInteresesRenglon_empresaId_comprobanteId_idx" ON "LiquidacionInteresesRenglon"("empresaId", "comprobanteId");

-- CreateIndex
CREATE INDEX "LiquidacionInteresesRenglon_notaDebitoId_idx" ON "LiquidacionInteresesRenglon"("notaDebitoId");

-- AddForeignKey
ALTER TABLE "LiquidacionInteresesRenglon" ADD CONSTRAINT "LiquidacionInteresesRenglon_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionIntereses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

