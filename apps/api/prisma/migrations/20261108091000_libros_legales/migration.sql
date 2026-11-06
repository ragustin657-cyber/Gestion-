-- CreateEnum
CREATE TYPE "LibroLegal" AS ENUM ('DIARIO', 'INVENTARIOS');

-- CreateTable
CREATE TABLE "EmisionLibro" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "libro" "LibroLegal" NOT NULL,
    "ejercicioId" UUID NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "folioInicial" INTEGER NOT NULL,
    "folioFinal" INTEGER NOT NULL,
    "usuarioId" UUID NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmisionLibro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmisionLibro_empresaId_libro_idx" ON "EmisionLibro"("empresaId", "libro");

