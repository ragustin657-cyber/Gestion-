-- AlterTable
ALTER TABLE "ComprobanteVenta" ADD COLUMN     "descuentoPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ComprobanteVentaRenglon" ADD COLUMN     "bonificacionPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PedidoVentaRenglon" ADD COLUMN     "bonificacionPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

