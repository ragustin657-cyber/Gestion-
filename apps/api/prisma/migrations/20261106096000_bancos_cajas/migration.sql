-- CreateEnum
CREATE TYPE "TipoMovimientoBancario" AS ENUM ('GASTO', 'INGRESO');

-- CreateEnum
CREATE TYPE "TipoMovimientoCaja" AS ENUM ('INGRESO', 'EGRESO');

-- CreateTable
CREATE TABLE "MovimientoBancario" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "tipo" "TipoMovimientoBancario" NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "concepto" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoDocTesoreria" NOT NULL DEFAULT 'CONFIRMADO',
    "asientoId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoBancario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferenciaInterna" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "origenCuentaBancariaId" UUID,
    "origenCajaId" UUID,
    "destinoCuentaBancariaId" UUID,
    "destinoCajaId" UUID,
    "monedaOrigen" TEXT NOT NULL,
    "monedaDestino" TEXT NOT NULL,
    "importeOrigen" DECIMAL(18,2) NOT NULL,
    "importeDestino" DECIMAL(18,2) NOT NULL,
    "cotizacion" DECIMAL(18,6),
    "concepto" TEXT,
    "estado" "EstadoDocTesoreria" NOT NULL DEFAULT 'CONFIRMADO',
    "asientoId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferenciaInterna_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCaja" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cajaId" UUID NOT NULL,
    "tipo" "TipoMovimientoCaja" NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "concepto" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "arqueoId" UUID,
    "estado" "EstadoDocTesoreria" NOT NULL DEFAULT 'CONFIRMADO',
    "asientoId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Arqueo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "cajaId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "saldoSistema" DECIMAL(18,2) NOT NULL,
    "contado" DECIMAL(18,2) NOT NULL,
    "diferencia" DECIMAL(18,2) NOT NULL,
    "motivo" TEXT,
    "asientoId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Arqueo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoBancario_empresaId_numero_key" ON "MovimientoBancario"("empresaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "TransferenciaInterna_empresaId_numero_key" ON "TransferenciaInterna"("empresaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoCaja_empresaId_numero_key" ON "MovimientoCaja"("empresaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Arqueo_empresaId_numero_key" ON "Arqueo"("empresaId", "numero");

