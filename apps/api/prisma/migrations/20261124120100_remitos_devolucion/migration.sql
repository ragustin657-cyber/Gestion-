-- AlterTable
ALTER TABLE "ComprobanteVentaRenglon" ADD COLUMN     "devolucionRenglonId" UUID;

-- AlterTable
ALTER TABLE "PedidoVentaRenglon" ADD COLUMN     "cantidadDevuelta" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Remito" ADD COLUMN     "tipo" "TipoRemito" NOT NULL DEFAULT 'ENTREGA';

-- AlterTable
ALTER TABLE "RemitoRenglon" ADD COLUMN     "cantidadAAcreditar" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cantidadAcreditada" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "cantidadDevuelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "remitoRenglonOrigenId" UUID;

