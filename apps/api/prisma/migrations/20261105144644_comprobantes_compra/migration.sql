-- CreateEnum
CREATE TYPE "TipoComprobanteCompra" AS ENUM ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'TICKET');

-- CreateEnum
CREATE TYPE "EstadoComprobante" AS ENUM ('CONFIRMADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "OrigenRenglonCompra" AS ENUM ('RECEPCION', 'ORDEN_COMPRA', 'DIRECTO');

-- CreateTable
CREATE TABLE "ComprobanteCompra" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numeroInterno" INTEGER NOT NULL,
    "terceroId" UUID NOT NULL,
    "tipo" "TipoComprobanteCompra" NOT NULL,
    "letra" TEXT NOT NULL DEFAULT '',
    "puntoVenta" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "fechaEmision" DATE NOT NULL,
    "fechaContable" DATE NOT NULL,
    "fechaVencimiento" DATE NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "cotizacion" DECIMAL(18,6) NOT NULL,
    "netoGravado" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "percepcionIva" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "impuestosInternos" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "noGravado" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exento" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "totalPesos" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoComprobante" NOT NULL DEFAULT 'CONFIRMADO',
    "comprobanteAsociadoId" UUID,
    "asientoId" UUID,
    "asientoAnulacionId" UUID,
    "aceptoDiferencias" BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComprobanteCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComprobanteCompraRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "origen" "OrigenRenglonCompra" NOT NULL,
    "informeRecepcionRenglonId" UUID,
    "ordenCompraRenglonId" UUID,
    "articuloId" UUID,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "precioUnitario" DECIMAL(18,4) NOT NULL,
    "bonificacionPct" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "alicuotaIva" DECIMAL(18,6) NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "centroCostoId" UUID,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ComprobanteCompraRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComprobanteCompraIva" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "alicuota" DECIMAL(18,6) NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ComprobanteCompraIva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComprobanteCompraPercepcionIibb" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "jurisdiccion" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ComprobanteCompraPercepcionIibb_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCuentaCorriente" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "terceroId" UUID NOT NULL,
    "origenTipo" TEXT NOT NULL,
    "origenId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "fechaVencimiento" DATE NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "importePesos" DECIMAL(18,2) NOT NULL,
    "saldo" DECIMAL(18,2) NOT NULL,
    "saldoPesos" DECIMAL(18,2) NOT NULL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoCuentaCorriente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComprobanteCompra_empresaId_fechaContable_idx" ON "ComprobanteCompra"("empresaId", "fechaContable");

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteCompra_empresaId_numeroInterno_key" ON "ComprobanteCompra"("empresaId", "numeroInterno");

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteCompra_empresaId_terceroId_tipo_letra_puntoVenta_key" ON "ComprobanteCompra"("empresaId", "terceroId", "tipo", "letra", "puntoVenta", "numero");

-- CreateIndex
CREATE INDEX "MovimientoCuentaCorriente_empresaId_terceroId_idx" ON "MovimientoCuentaCorriente"("empresaId", "terceroId");

-- CreateIndex
CREATE INDEX "MovimientoCuentaCorriente_empresaId_origenTipo_origenId_idx" ON "MovimientoCuentaCorriente"("empresaId", "origenTipo", "origenId");

-- AddForeignKey
ALTER TABLE "ComprobanteCompra" ADD CONSTRAINT "ComprobanteCompra_terceroId_fkey" FOREIGN KEY ("terceroId") REFERENCES "Tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComprobanteCompraRenglon" ADD CONSTRAINT "ComprobanteCompraRenglon_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteCompra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComprobanteCompraIva" ADD CONSTRAINT "ComprobanteCompraIva_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteCompra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComprobanteCompraPercepcionIibb" ADD CONSTRAINT "ComprobanteCompraPercepcionIibb_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteCompra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
