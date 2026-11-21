-- CreateEnum
CREATE TYPE "DestinoCreditoIva" AS ENUM ('GRAVADO', 'EXENTO', 'COMUN');

-- AlterTable
ALTER TABLE "ComprobanteCompra" ADD COLUMN     "destinoCreditoIva" "DestinoCreditoIva" NOT NULL DEFAULT 'GRAVADO';

-- AlterTable
ALTER TABLE "ConfigImpuestos" ADD COLUMN     "prorrateoDesdeAnio" INTEGER,
ADD COLUMN     "prorrateoDesdeMes" INTEGER,
ADD COLUMN     "prorrateoExentasIniciales" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "prorrateoGravadasIniciales" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "prorrateoInicioMes" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "prorrateoIva" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PosicionIva" ADD COLUMN     "ajusteProrrateo" DECIMAL(18,2),
ADD COLUMN     "coeficiente" DECIMAL(5,4),
ADD COLUMN     "creditoComputable" DECIMAL(18,2),
ADD COLUMN     "creditoComun" DECIMAL(18,2),
ADD COLUMN     "creditoNoComputable" DECIMAL(18,2);

