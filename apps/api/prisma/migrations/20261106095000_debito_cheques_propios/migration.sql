-- AlterEnum
ALTER TYPE "EstadoChequePropio" ADD VALUE 'DEBITADO';

-- AlterTable
ALTER TABLE "ChequePropio" ADD COLUMN     "fechaDebito" DATE;

