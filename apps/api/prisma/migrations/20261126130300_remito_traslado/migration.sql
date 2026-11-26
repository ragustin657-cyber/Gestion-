-- AlterTable
ALTER TABLE "Remito" ADD COLUMN     "cot" TEXT,
ADD COLUMN     "cotEstado" "EstadoCot",
ADD COLUMN     "cotMensaje" TEXT,
ADD COLUMN     "cotPedidoEn" TIMESTAMP(3),
ADD COLUMN     "fechaSalida" DATE,
ADD COLUMN     "horaSalida" TEXT,
ADD COLUMN     "importeDeclarado" DECIMAL(18,2),
ADD COLUMN     "patente" TEXT,
ADD COLUMN     "patenteAcoplado" TEXT,
ADD COLUMN     "transportistaId" UUID,
ADD COLUMN     "trasladoCalle" TEXT,
ADD COLUMN     "trasladoCodigoPostal" TEXT,
ADD COLUMN     "trasladoLocalidad" TEXT,
ADD COLUMN     "trasladoNumero" TEXT,
ADD COLUMN     "trasladoProvincia" TEXT;

