-- CreateEnum
CREATE TYPE "TipoCuenta" AS ENUM ('ACTIVO', 'PASIVO', 'PATRIMONIO_NETO', 'RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO');

-- CreateTable
CREATE TABLE "CuentaContable" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "padreId" UUID,
    "imputable" BOOLEAN NOT NULL,
    "tipo" "TipoCuenta" NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CuentaContable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CuentaContable_empresaId_codigo_key" ON "CuentaContable"("empresaId", "codigo");

-- AddForeignKey
ALTER TABLE "CuentaContable" ADD CONSTRAINT "CuentaContable_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaContable" ADD CONSTRAINT "CuentaContable_padreId_fkey" FOREIGN KEY ("padreId") REFERENCES "CuentaContable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
