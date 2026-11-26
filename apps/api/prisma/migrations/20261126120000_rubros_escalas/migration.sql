-- AlterTable
ALTER TABLE "Articulo" ADD COLUMN     "rubroId" UUID;

-- CreateTable
CREATE TABLE "RubroArticulo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubroArticulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalaDescuento" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "rubroId" UUID,
    "articuloId" UUID,
    "desde" DECIMAL(18,4) NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "EscalaDescuento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RubroArticulo_empresaId_nombre_key" ON "RubroArticulo"("empresaId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "EscalaDescuento_empresaId_rubroId_desde_key" ON "EscalaDescuento"("empresaId", "rubroId", "desde");

-- CreateIndex
CREATE UNIQUE INDEX "EscalaDescuento_empresaId_articuloId_desde_key" ON "EscalaDescuento"("empresaId", "articuloId", "desde");

