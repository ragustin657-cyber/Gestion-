-- CreateEnum
CREATE TYPE "EstadoIR" AS ENUM ('CONFIRMADO', 'ANULADO');

-- CreateTable
CREATE TABLE "InformeRecepcion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "terceroId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "depositoId" UUID,
    "remitoNumero" TEXT NOT NULL,
    "observaciones" TEXT,
    "estado" "EstadoIR" NOT NULL DEFAULT 'CONFIRMADO',
    "motivoAnulacion" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InformeRecepcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InformeRecepcionRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "informeRecepcionId" UUID NOT NULL,
    "ordenCompraRenglonId" UUID NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "cantidadFacturada" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "InformeRecepcionRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InformeRecepcion_empresaId_numero_key" ON "InformeRecepcion"("empresaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "InformeRecepcion_empresaId_terceroId_remitoNumero_key" ON "InformeRecepcion"("empresaId", "terceroId", "remitoNumero");

-- AddForeignKey
ALTER TABLE "InformeRecepcion" ADD CONSTRAINT "InformeRecepcion_terceroId_fkey" FOREIGN KEY ("terceroId") REFERENCES "Tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformeRecepcionRenglon" ADD CONSTRAINT "InformeRecepcionRenglon_informeRecepcionId_fkey" FOREIGN KEY ("informeRecepcionId") REFERENCES "InformeRecepcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformeRecepcionRenglon" ADD CONSTRAINT "InformeRecepcionRenglon_ordenCompraRenglonId_fkey" FOREIGN KEY ("ordenCompraRenglonId") REFERENCES "OrdenCompraRenglon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
