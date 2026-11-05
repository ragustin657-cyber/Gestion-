-- CreateTable
CREATE TABLE "Talonario" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "tipoComprobante" TEXT NOT NULL,
    "puntoVenta" INTEGER NOT NULL,
    "ultimoNumero" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Talonario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Talonario_empresaId_tipoComprobante_puntoVenta_key" ON "Talonario"("empresaId", "tipoComprobante", "puntoVenta");
