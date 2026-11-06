-- CreateEnum
CREATE TYPE "TipoArchivoExtracto" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "ModoImporte" AS ENUM ('IMPORTE_CON_SIGNO', 'DEBITO_CREDITO');

-- CreateTable
CREATE TABLE "FormatoExtracto" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "tipoArchivo" "TipoArchivoExtracto" NOT NULL,
    "separador" TEXT,
    "hoja" TEXT,
    "filaInicio" INTEGER NOT NULL DEFAULT 2,
    "formatoFecha" TEXT NOT NULL,
    "separadorDecimal" TEXT NOT NULL DEFAULT ',',
    "columnaFecha" TEXT NOT NULL,
    "columnaConcepto" TEXT NOT NULL,
    "columnaReferencia" TEXT,
    "columnaSaldo" TEXT,
    "modoImporte" "ModoImporte" NOT NULL,
    "columnaImporte" TEXT,
    "columnaDebito" TEXT,
    "columnaCredito" TEXT,

    CONSTRAINT "FormatoExtracto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormatoExtracto_cuentaBancariaId_key" ON "FormatoExtracto"("cuentaBancariaId");


-- Permiso nuevo para el rol Administrador
UPDATE "Rol" SET "permisos" = array(SELECT DISTINCT unnest("permisos" || ARRAY['conciliacion.operar'])) WHERE "nombre" = 'Administrador';
