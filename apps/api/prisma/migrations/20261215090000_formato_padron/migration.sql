-- CreateTable
CREATE TABLE "FormatoPadron" (
    "id" UUID NOT NULL,
    "jurisdiccion" TEXT NOT NULL,
    "separador" TEXT NOT NULL,
    "encabezado" BOOLEAN NOT NULL DEFAULT false,
    "cuit" TEXT NOT NULL,
    "alicuotaPercepcion" TEXT,
    "alicuotaRetencion" TEXT,
    "vigenciaDesde" TEXT,
    "vigenciaHasta" TEXT,
    "formatoFecha" TEXT NOT NULL DEFAULT 'DD/MM/AAAA',
    "separadorDecimal" TEXT NOT NULL DEFAULT '.',

    CONSTRAINT "FormatoPadron_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormatoPadron_jurisdiccion_key" ON "FormatoPadron"("jurisdiccion");

