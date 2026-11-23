-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "fceConsultadoAmbiente" "AmbienteArca",
ADD COLUMN     "fceConsultadoEn" TIMESTAMP(3),
ADD COLUMN     "fceMontoMinimo" DECIMAL(18,2),
ADD COLUMN     "fceObligado" BOOLEAN,
ADD COLUMN     "fceObligadoManual" BOOLEAN NOT NULL DEFAULT false;

