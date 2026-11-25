-- CreateTable
CREATE TABLE "LoteFacturacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "puntoVentaId" UUID NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "estado" "EstadoLoteFacturacion" NOT NULL DEFAULT 'EN_CURSO',
    "emitidas" INTEGER NOT NULL DEFAULT 0,
    "sinCae" INTEGER NOT NULL DEFAULT 0,
    "errores" INTEGER NOT NULL DEFAULT 0,
    "omitidas" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminadoEn" TIMESTAMP(3),

    CONSTRAINT "LoteFacturacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoteFacturacionItem" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "loteId" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "terceroId" UUID NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "comprobanteId" UUID,
    "resultado" "ResultadoLoteFacturacion" NOT NULL DEFAULT 'PENDIENTE',
    "fce" BOOLEAN NOT NULL DEFAULT false,
    "mensaje" TEXT,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "LoteFacturacionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoteFacturacion_empresaId_estado_idx" ON "LoteFacturacion"("empresaId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "LoteFacturacion_empresaId_numero_key" ON "LoteFacturacion"("empresaId", "numero");

-- CreateIndex
CREATE INDEX "LoteFacturacionItem_empresaId_loteId_idx" ON "LoteFacturacionItem"("empresaId", "loteId");

-- AddForeignKey
ALTER TABLE "LoteFacturacionItem" ADD CONSTRAINT "LoteFacturacionItem_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteFacturacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

