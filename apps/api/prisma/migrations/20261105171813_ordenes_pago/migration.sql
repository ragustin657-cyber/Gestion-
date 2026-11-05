-- CreateEnum
CREATE TYPE "EstadoOP" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'PAGADA', 'ANULADA');

-- CreateTable
CREATE TABLE "OrdenPago" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER,
    "terceroId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "cotizacion" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "observaciones" TEXT,
    "estado" "EstadoOP" NOT NULL DEFAULT 'BORRADOR',
    "totalCancelarPesos" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalRetenciones" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netoPagar" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fechaPago" DATE,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aprobadoPor" TEXT,
    "aprobadoEn" TIMESTAMP(3),
    "pagadoPor" TEXT,
    "motivoRechazo" TEXT,
    "motivoAnulacion" TEXT,
    "asientoId" UUID,
    "asientoAnulacionId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrdenPago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdenPagoImputacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ordenPagoId" UUID NOT NULL,
    "movimientoId" UUID NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "importePesos" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "OrdenPagoImputacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdenPagoAnticipo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ordenPagoId" UUID NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "OrdenPagoAnticipo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdenPagoRetencion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ordenPagoId" UUID NOT NULL,
    "impuesto" TEXT NOT NULL,
    "jurisdiccion" TEXT,
    "regimen" TEXT,
    "base" DECIMAL(18,2) NOT NULL,
    "alicuota" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "detalle" JSONB NOT NULL,
    "certificadoNumero" INTEGER,
    "anulada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrdenPagoRetencion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrdenPago_empresaId_estado_idx" ON "OrdenPago"("empresaId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "OrdenPago_empresaId_numero_key" ON "OrdenPago"("empresaId", "numero");

-- CreateIndex
CREATE INDEX "OrdenPagoImputacion_empresaId_movimientoId_idx" ON "OrdenPagoImputacion"("empresaId", "movimientoId");

-- CreateIndex
CREATE UNIQUE INDEX "OrdenPagoAnticipo_ordenPagoId_key" ON "OrdenPagoAnticipo"("ordenPagoId");

-- AddForeignKey
ALTER TABLE "OrdenPago" ADD CONSTRAINT "OrdenPago_terceroId_fkey" FOREIGN KEY ("terceroId") REFERENCES "Tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenPagoImputacion" ADD CONSTRAINT "OrdenPagoImputacion_ordenPagoId_fkey" FOREIGN KEY ("ordenPagoId") REFERENCES "OrdenPago"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenPagoAnticipo" ADD CONSTRAINT "OrdenPagoAnticipo_ordenPagoId_fkey" FOREIGN KEY ("ordenPagoId") REFERENCES "OrdenPago"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenPagoRetencion" ADD CONSTRAINT "OrdenPagoRetencion_ordenPagoId_fkey" FOREIGN KEY ("ordenPagoId") REFERENCES "OrdenPago"("id") ON DELETE CASCADE ON UPDATE CASCADE;
