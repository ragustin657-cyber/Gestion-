-- AlterTable
ALTER TABLE "Articulo" ADD COLUMN     "codigoNomencladorArba" TEXT,
ADD COLUMN     "unidadMedidaArba" TEXT;

-- AlterTable
ALTER TABLE "Deposito" ADD COLUMN     "calle" TEXT,
ADD COLUMN     "codigoPostal" TEXT,
ADD COLUMN     "localidad" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "plantaArba" INTEGER,
ADD COLUMN     "provincia" TEXT,
ADD COLUMN     "puertaArba" INTEGER;

-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "entregaCalle" TEXT,
ADD COLUMN     "entregaCodigoPostal" TEXT,
ADD COLUMN     "entregaLocalidad" TEXT,
ADD COLUMN     "entregaNumero" TEXT,
ADD COLUMN     "entregaProvincia" TEXT;
