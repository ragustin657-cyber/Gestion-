-- CreateEnum
CREATE TYPE "EstadoImportacion" AS ENUM ('ACTIVA', 'DESHECHA');

-- CreateEnum
CREATE TYPE "EstadoLinea" AS ENUM ('PENDIENTE', 'CONCILIADA', 'IGNORADA');

-- CreateTable
CREATE TABLE "ImportacionExtracto" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "archivo" TEXT NOT NULL,
    "usuarioId" UUID NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineas" INTEGER NOT NULL,
    "duplicadas" INTEGER NOT NULL,
    "estado" "EstadoImportacion" NOT NULL DEFAULT 'ACTIVA',

    CONSTRAINT "ImportacionExtracto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineaExtracto" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "importacionId" UUID NOT NULL,
    "fila" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "concepto" TEXT NOT NULL,
    "referencia" TEXT,
    "importe" DECIMAL(18,2) NOT NULL,
    "saldo" DECIMAL(18,2),
    "estado" "EstadoLinea" NOT NULL DEFAULT 'PENDIENTE',
    "motivoIgnorada" TEXT,

    CONSTRAINT "LineaExtracto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportacionExtracto_empresaId_cuentaBancariaId_idx" ON "ImportacionExtracto"("empresaId", "cuentaBancariaId");

-- CreateIndex
CREATE INDEX "LineaExtracto_empresaId_cuentaBancariaId_fecha_idx" ON "LineaExtracto"("empresaId", "cuentaBancariaId", "fecha");

-- AddForeignKey
ALTER TABLE "LineaExtracto" ADD CONSTRAINT "LineaExtracto_importacionId_fkey" FOREIGN KEY ("importacionId") REFERENCES "ImportacionExtracto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

