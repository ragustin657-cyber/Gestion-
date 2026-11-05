-- CreateTable
CREATE TABLE "DepositoBancario" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cajaId" UUID NOT NULL,
    "cuentaBancariaId" UUID NOT NULL,
    "boleta" TEXT,
    "estado" "EstadoDocTesoreria" NOT NULL DEFAULT 'CONFIRMADO',
    "asientoId" UUID,
    "asientoAnulacionId" UUID,
    "motivoAnulacion" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositoBancario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositoBancarioItem" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "depositoId" UUID NOT NULL,
    "tipo" "TipoValor" NOT NULL,
    "chequeId" UUID,
    "monedaCodigo" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "DepositoBancarioItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositoBancario_empresaId_numero_key" ON "DepositoBancario"("empresaId", "numero");

-- AddForeignKey
ALTER TABLE "DepositoBancarioItem" ADD CONSTRAINT "DepositoBancarioItem_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "DepositoBancario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

