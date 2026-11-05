-- CreateTable
CREATE TABLE "Asiento" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "descripcion" TEXT NOT NULL,
    "origenTipo" TEXT NOT NULL,
    "origenId" TEXT NOT NULL,
    "anulaAId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsientoRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "asientoId" UUID NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "centroCostoId" UUID,
    "debe" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "haber" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "detalle" TEXT,

    CONSTRAINT "AsientoRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asiento_empresaId_origenTipo_origenId_idx" ON "Asiento"("empresaId", "origenTipo", "origenId");

-- CreateIndex
CREATE UNIQUE INDEX "Asiento_empresaId_numero_key" ON "Asiento"("empresaId", "numero");

-- AddForeignKey
ALTER TABLE "AsientoRenglon" ADD CONSTRAINT "AsientoRenglon_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
