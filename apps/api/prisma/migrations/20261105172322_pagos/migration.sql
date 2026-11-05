-- CreateEnum
CREATE TYPE "TipoMedioPago" AS ENUM ('TRANSFERENCIA', 'CHEQUE', 'EFECTIVO');

-- CreateEnum
CREATE TYPE "EstadoChequePropio" AS ENUM ('EMITIDO', 'ANULADO');

-- CreateTable
CREATE TABLE "OrdenPagoMedio" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ordenPagoId" UUID NOT NULL,
    "tipo" "TipoMedioPago" NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "importePesos" DECIMAL(18,2) NOT NULL,
    "cuentaBancariaId" UUID,
    "cajaId" UUID,
    "chequeraId" UUID,
    "chequeNumero" TEXT,
    "chequeFechaPago" DATE,
    "referencia" TEXT,

    CONSTRAINT "OrdenPagoMedio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChequePropio" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "chequeraId" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "fechaEmision" DATE NOT NULL,
    "fechaPago" DATE NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "beneficiarioId" UUID NOT NULL,
    "ordenPagoId" UUID NOT NULL,
    "estado" "EstadoChequePropio" NOT NULL DEFAULT 'EMITIDO',

    CONSTRAINT "ChequePropio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoTesoreria" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" TEXT NOT NULL,
    "cuentaBancariaId" UUID,
    "cajaId" UUID,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "origenTipo" TEXT NOT NULL,
    "origenId" UUID NOT NULL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoTesoreria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AplicacionCuentaCorriente" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "origenTipo" TEXT NOT NULL,
    "origenId" UUID NOT NULL,
    "movimientoId" UUID NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "importePesosHistorico" DECIMAL(18,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "anulada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AplicacionCuentaCorriente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChequePropio_empresaId_chequeraId_numero_key" ON "ChequePropio"("empresaId", "chequeraId", "numero");

-- CreateIndex
CREATE INDEX "MovimientoTesoreria_empresaId_origenTipo_origenId_idx" ON "MovimientoTesoreria"("empresaId", "origenTipo", "origenId");

-- CreateIndex
CREATE INDEX "AplicacionCuentaCorriente_empresaId_movimientoId_idx" ON "AplicacionCuentaCorriente"("empresaId", "movimientoId");

-- CreateIndex
CREATE INDEX "AplicacionCuentaCorriente_empresaId_origenTipo_origenId_idx" ON "AplicacionCuentaCorriente"("empresaId", "origenTipo", "origenId");

-- AddForeignKey
ALTER TABLE "OrdenPagoMedio" ADD CONSTRAINT "OrdenPagoMedio_ordenPagoId_fkey" FOREIGN KEY ("ordenPagoId") REFERENCES "OrdenPago"("id") ON DELETE CASCADE ON UPDATE CASCADE;
