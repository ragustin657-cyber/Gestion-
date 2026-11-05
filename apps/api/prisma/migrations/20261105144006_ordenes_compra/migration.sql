-- CreateEnum
CREATE TYPE "EstadoOC" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'PARCIALMENTE_RECIBIDA', 'CUMPLIDA', 'ANULADA');

-- CreateTable
CREATE TABLE "OrdenCompra" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER,
    "puntoVenta" INTEGER NOT NULL DEFAULT 1,
    "terceroId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "fechaEntrega" DATE,
    "depositoId" UUID,
    "monedaCodigo" TEXT NOT NULL,
    "cotizacion" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "diasPago" INTEGER NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "estado" "EstadoOC" NOT NULL DEFAULT 'BORRADOR',
    "neto" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iva" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalPesos" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aprobadoPor" TEXT,
    "aprobadoEn" TIMESTAMP(3),
    "motivoRechazo" TEXT,
    "motivoAnulacion" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrdenCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdenCompraRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ordenCompraId" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "articuloId" UUID,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "precioUnitario" DECIMAL(18,4) NOT NULL,
    "bonificacionPct" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "alicuotaIva" DECIMAL(18,6) NOT NULL,
    "centroCostoId" UUID,
    "importe" DECIMAL(18,2) NOT NULL,
    "cantidadRecibida" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cantidadFacturada" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "OrdenCompraRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrdenCompra_empresaId_estado_idx" ON "OrdenCompra"("empresaId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "OrdenCompra_empresaId_puntoVenta_numero_key" ON "OrdenCompra"("empresaId", "puntoVenta", "numero");

-- AddForeignKey
ALTER TABLE "OrdenCompra" ADD CONSTRAINT "OrdenCompra_terceroId_fkey" FOREIGN KEY ("terceroId") REFERENCES "Tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenCompraRenglon" ADD CONSTRAINT "OrdenCompraRenglon_ordenCompraId_fkey" FOREIGN KEY ("ordenCompraId") REFERENCES "OrdenCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
