-- AlterTable
ALTER TABLE "ComprobanteVenta" ADD COLUMN     "exportacion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "formaPago" TEXT,
ADD COLUMN     "idioma" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "incoterm" TEXT,
ADD COLUMN     "incotermDescripcion" TEXT,
ADD COLUMN     "paisDestino" INTEGER,
ADD COLUMN     "permisoExistente" TEXT,
ADD COLUMN     "tipoExportacion" "TipoExportacion";

-- AlterTable
ALTER TABLE "PuntoVenta" ADD COLUMN     "exportacion" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "cuitPais" TEXT;

-- CreateTable
CREATE TABLE "ComprobanteVentaPermiso" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "paisDestino" INTEGER NOT NULL,

    CONSTRAINT "ComprobanteVentaPermiso_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ComprobanteVentaPermiso" ADD CONSTRAINT "ComprobanteVentaPermiso_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

