-- CreateEnum
CREATE TYPE "EstadoDocTesoreria" AS ENUM ('CONFIRMADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "OrigenIngreso" AS ENUM ('CLIENTE', 'OTRO');

-- CreateEnum
CREATE TYPE "TipoChequeTercero" AS ENUM ('FISICO', 'ECHEQ');

-- CreateEnum
CREATE TYPE "EstadoCheque" AS ENUM ('EN_CARTERA', 'EN_TRANSITO', 'DEPOSITADO', 'ACREDITADO', 'ENDOSADO', 'RECHAZADO', 'DEVUELTO', 'ANULADO');

-- CreateEnum
CREATE TYPE "EstadoTransferenciaRecibida" AS ENUM ('PENDIENTE', 'ACREDITADA', 'ANULADA');

-- CreateTable
CREATE TABLE "IngresoValores" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "sucursalId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cajaId" UUID NOT NULL,
    "origen" "OrigenIngreso" NOT NULL,
    "terceroId" UUID,
    "cuentaContableId" UUID,
    "concepto" TEXT NOT NULL,
    "estado" "EstadoDocTesoreria" NOT NULL DEFAULT 'CONFIRMADO',
    "asientoId" UUID,
    "asientoAnulacionId" UUID,
    "motivoAnulacion" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngresoValores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngresoValoresEfectivo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ingresoId" UUID NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "IngresoValoresEfectivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChequeTercero" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ingresoId" UUID NOT NULL,
    "tipo" "TipoChequeTercero" NOT NULL,
    "banco" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "libradorNombre" TEXT NOT NULL,
    "libradorCuit" TEXT NOT NULL DEFAULT '',
    "fechaEmision" DATE NOT NULL,
    "fechaPago" DATE NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoCheque" NOT NULL DEFAULT 'EN_CARTERA',
    "cajaId" UUID,
    "cuentaBancariaId" UUID,
    "terceroOrigenId" UUID,
    "terceroDestinoId" UUID,
    "fechaDeposito" DATE,
    "fechaAcreditacion" DATE,
    "fechaRechazo" DATE,
    "motivoRechazo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChequeTercero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCheque" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "chequeId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "estadoAnterior" "EstadoCheque",
    "estadoNuevo" "EstadoCheque" NOT NULL,
    "cajaId" UUID,
    "cuentaBancariaId" UUID,
    "origenTipo" TEXT NOT NULL,
    "origenId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoCheque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferenciaRecibida" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ingresoId" UUID NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "referencia" TEXT,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoTransferenciaRecibida" NOT NULL DEFAULT 'PENDIENTE',
    "fechaAcreditacion" DATE,
    "asientoAcreditacionId" UUID,

    CONSTRAINT "TransferenciaRecibida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngresoValores_empresaId_sucursalId_numero_key" ON "IngresoValores"("empresaId", "sucursalId", "numero");

-- CreateIndex
CREATE INDEX "ChequeTercero_empresaId_estado_idx" ON "ChequeTercero"("empresaId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "ChequeTercero_empresaId_banco_numero_libradorCuit_key" ON "ChequeTercero"("empresaId", "banco", "numero", "libradorCuit");

-- CreateIndex
CREATE INDEX "MovimientoCheque_empresaId_chequeId_idx" ON "MovimientoCheque"("empresaId", "chequeId");

-- AddForeignKey
ALTER TABLE "IngresoValoresEfectivo" ADD CONSTRAINT "IngresoValoresEfectivo_ingresoId_fkey" FOREIGN KEY ("ingresoId") REFERENCES "IngresoValores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequeTercero" ADD CONSTRAINT "ChequeTercero_ingresoId_fkey" FOREIGN KEY ("ingresoId") REFERENCES "IngresoValores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCheque" ADD CONSTRAINT "MovimientoCheque_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "ChequeTercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferenciaRecibida" ADD CONSTRAINT "TransferenciaRecibida_ingresoId_fkey" FOREIGN KEY ("ingresoId") REFERENCES "IngresoValores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

