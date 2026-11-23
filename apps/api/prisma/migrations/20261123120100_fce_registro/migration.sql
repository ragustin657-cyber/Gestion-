-- CreateTable
CREATE TABLE "FceRegistro" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ambiente" "AmbienteArca" NOT NULL,
    "rol" "RolFce" NOT NULL,
    "cuitContraparte" TEXT NOT NULL,
    "cbteTipo" INTEGER NOT NULL,
    "puntoVenta" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "moneda" TEXT NOT NULL,
    "fechaVencimientoPago" DATE,
    "estado" "EstadoFceRegistro" NOT NULL,
    "fechaRecepcion" DATE,
    "fechaLimite" DATE,
    "motivosRechazo" TEXT[],
    "textoRechazo" TEXT,
    "consultadoEn" TIMESTAMP(3) NOT NULL,
    "comprobanteVentaId" UUID,
    "comprobanteCompraId" UUID,

    CONSTRAINT "FceRegistro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FceRegistro_empresaId_ambiente_rol_estado_idx" ON "FceRegistro"("empresaId", "ambiente", "rol", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "FceRegistro_empresaId_ambiente_rol_cuitContraparte_cbteTipo_key" ON "FceRegistro"("empresaId", "ambiente", "rol", "cuitContraparte", "cbteTipo", "puntoVenta", "numero");

