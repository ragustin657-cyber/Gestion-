-- AlterTable
ALTER TABLE "ListaPrecios" ADD COLUMN     "base" "BaseLista" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "listaBaseId" UUID,
ADD COLUMN     "porcentaje" DECIMAL(9,2) NOT NULL DEFAULT 0,
ADD COLUMN     "redondeo" TEXT NOT NULL DEFAULT '0.01';

-- AlterTable
ALTER TABLE "PrecioLista" ADD COLUMN     "fijo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "margenPct" DECIMAL(9,2);

