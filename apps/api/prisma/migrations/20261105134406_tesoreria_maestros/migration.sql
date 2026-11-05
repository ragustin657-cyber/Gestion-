-- CreateEnum
CREATE TYPE "TipoChequera" AS ENUM ('FISICA', 'ECHEQ');

-- CreateTable
CREATE TABLE "Banco" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigoBcra" TEXT,

    CONSTRAINT "Banco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuentaBancaria" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "bancoId" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "cbu" TEXT,
    "alias" TEXT,
    "monedaCodigo" TEXT NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CuentaBancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chequera" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "tipo" "TipoChequera" NOT NULL,
    "desde" INTEGER,
    "hasta" INTEGER,
    "proximoNumero" INTEGER,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Chequera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Caja" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Caja_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CuentaBancaria" ADD CONSTRAINT "CuentaBancaria_bancoId_fkey" FOREIGN KEY ("bancoId") REFERENCES "Banco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chequera" ADD CONSTRAINT "Chequera_cuentaBancariaId_fkey" FOREIGN KEY ("cuentaBancariaId") REFERENCES "CuentaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
