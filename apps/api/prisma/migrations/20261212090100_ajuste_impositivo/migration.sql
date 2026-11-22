-- AlterTable
ALTER TABLE "CuentaContable" ADD COLUMN     "ajusteImpositivo" "AjusteImpositivoCuenta" NOT NULL DEFAULT 'COMPUTABLE';

-- CreateTable
CREATE TABLE "AjusteImpositivoPartida" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ejercicioId" UUID NOT NULL,
    "concepto" TEXT NOT NULL,
    "tipo" "AjusteImpositivoPartidaTipo" NOT NULL,
    "fecha" DATE,
    "importe" DECIMAL(18,2) NOT NULL,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AjusteImpositivoPartida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AjusteImpositivoPartida_empresaId_ejercicioId_idx" ON "AjusteImpositivoPartida"("empresaId", "ejercicioId");

-- E45: las cuentas de valor de origen y de amortización acumulada de los rubros de bienes de uso son activo excluido
UPDATE "CuentaContable" SET "ajusteImpositivo" = 'EXCLUIDO'
WHERE "id" IN (SELECT "cuentaOrigenId" FROM "RubroBienUso" UNION SELECT "cuentaAmortizacionId" FROM "RubroBienUso");
