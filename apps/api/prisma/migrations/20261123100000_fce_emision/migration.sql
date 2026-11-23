-- DropIndex
DROP INDEX "ComprobanteVenta_empresaId_ambiente_puntoVenta_tipo_letra_n_key";

-- AlterTable
ALTER TABLE "ComprobanteVenta" ADD COLUMN     "anulacionFce" BOOLEAN,
ADD COLUMN     "fce" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transferenciaFce" TEXT;

-- AlterTable
ALTER TABLE "ConfigArca" ADD COLUMN     "cuentaBancariaFceId" UUID,
ADD COLUMN     "mipyme" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transferenciaFce" TEXT NOT NULL DEFAULT 'SCA';

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteVenta_empresaId_ambiente_puntoVenta_tipo_letra_f_key" ON "ComprobanteVenta"("empresaId", "ambiente", "puntoVenta", "tipo", "letra", "fce", "numero");

