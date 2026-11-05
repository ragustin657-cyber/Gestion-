-- AlterEnum
ALTER TYPE "TipoMedioPago" ADD VALUE 'CHEQUE_TERCERO';

-- AlterTable
ALTER TABLE "OrdenPagoMedio" ADD COLUMN     "chequeTerceroId" UUID;

