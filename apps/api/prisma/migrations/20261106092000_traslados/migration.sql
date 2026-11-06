-- CreateEnum
CREATE TYPE "EstadoTraslado" AS ENUM ('ENVIADO', 'RECIBIDO', 'RECIBIDO_PARCIAL', 'ANULADO');

-- CreateEnum
CREATE TYPE "TipoValor" AS ENUM ('CHEQUE', 'EFECTIVO');

-- CreateTable
CREATE TABLE "Traslado" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cajaOrigenId" UUID NOT NULL,
    "cajaDestinoId" UUID NOT NULL,
    "estado" "EstadoTraslado" NOT NULL DEFAULT 'ENVIADO',
    "observaciones" TEXT,
    "fechaRecepcion" DATE,
    "asientoId" UUID,
    "asientoRecepcionId" UUID,
    "asientoAnulacionId" UUID,
    "motivoAnulacion" TEXT,
    "creadoPor" TEXT NOT NULL,
    "recibidoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Traslado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrasladoItem" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "trasladoId" UUID NOT NULL,
    "tipo" "TipoValor" NOT NULL,
    "chequeId" UUID,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "aceptado" BOOLEAN,
    "motivoRechazo" TEXT,

    CONSTRAINT "TrasladoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Traslado_empresaId_numero_key" ON "Traslado"("empresaId", "numero");

-- AddForeignKey
ALTER TABLE "TrasladoItem" ADD CONSTRAINT "TrasladoItem_trasladoId_fkey" FOREIGN KEY ("trasladoId") REFERENCES "Traslado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

