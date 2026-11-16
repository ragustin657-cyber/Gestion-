-- CreateEnum
CREATE TYPE "TipoTarjeta" AS ENUM ('CREDITO', 'DEBITO', 'QR');

-- CreateEnum
CREATE TYPE "EstadoCupon" AS ENUM ('PENDIENTE', 'LIQUIDADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "ClaseImpuestoTarjeta" AS ENUM ('RETENCION', 'PERCEPCION');

-- CreateEnum
CREATE TYPE "TipoImpuestoTarjeta" AS ENUM ('IVA', 'GANANCIAS', 'IIBB');

-- CreateTable
CREATE TABLE "Tarjeta" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoTarjeta" NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Tarjeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuponTarjeta" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "tarjetaId" UUID NOT NULL,
    "ingresoId" UUID NOT NULL,
    "sucursalId" UUID NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "lote" TEXT,
    "numero" TEXT,
    "cuotas" INTEGER NOT NULL DEFAULT 1,
    "importe" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoCupon" NOT NULL DEFAULT 'PENDIENTE',
    "liquidacionId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuponTarjeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionTarjeta" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "tarjetaId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "referencia" TEXT,
    "bruto" DECIMAL(18,2) NOT NULL,
    "arancel" DECIMAL(18,2) NOT NULL,
    "ivaArancel" DECIMAL(18,2) NOT NULL,
    "costoFinanciero" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ivaCostoFinanciero" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "neto" DECIMAL(18,2) NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "estado" "EstadoDocTesoreria" NOT NULL DEFAULT 'CONFIRMADO',
    "asientoId" UUID,
    "asientoAnulacionId" UUID,
    "motivoAnulacion" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidacionTarjeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionTarjetaImpuesto" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "liquidacionId" UUID NOT NULL,
    "clase" "ClaseImpuestoTarjeta" NOT NULL,
    "tipo" "TipoImpuestoTarjeta" NOT NULL,
    "jurisdiccion" TEXT,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "LiquidacionTarjetaImpuesto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tarjeta_empresaId_nombre_key" ON "Tarjeta"("empresaId", "nombre");

-- CreateIndex
CREATE INDEX "CuponTarjeta_empresaId_tarjetaId_estado_idx" ON "CuponTarjeta"("empresaId", "tarjetaId", "estado");

-- CreateIndex
CREATE INDEX "CuponTarjeta_empresaId_ingresoId_idx" ON "CuponTarjeta"("empresaId", "ingresoId");

-- AddForeignKey
ALTER TABLE "LiquidacionTarjetaImpuesto" ADD CONSTRAINT "LiquidacionTarjetaImpuesto_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionTarjeta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

