-- CreateTable
CREATE TABLE "Tercero" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" INTEGER NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreFantasia" TEXT,
    "cuit" TEXT NOT NULL,
    "condicionIva" "CondicionIva" NOT NULL,
    "esProveedor" BOOLEAN NOT NULL DEFAULT false,
    "esCliente" BOOLEAN NOT NULL DEFAULT false,
    "domicilio" TEXT,
    "localidad" TEXT,
    "provincia" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "diasPago" INTEGER NOT NULL DEFAULT 0,
    "regimenGanancias" TEXT,
    "exentoGanancias" BOOLEAN NOT NULL DEFAULT false,
    "exentoIva" BOOLEAN NOT NULL DEFAULT false,
    "exencionHasta" DATE,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tercero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerceroIibb" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "terceroId" UUID NOT NULL,
    "jurisdiccion" TEXT NOT NULL,
    "alicuotaPercepcion" DECIMAL(18,6) NOT NULL,
    "alicuotaRetencion" DECIMAL(18,6) NOT NULL,
    "exento" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TerceroIibb_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tercero_empresaId_cuit_key" ON "Tercero"("empresaId", "cuit");

-- CreateIndex
CREATE UNIQUE INDEX "Tercero_empresaId_codigo_key" ON "Tercero"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "TerceroIibb_terceroId_jurisdiccion_key" ON "TerceroIibb"("terceroId", "jurisdiccion");

-- AddForeignKey
ALTER TABLE "TerceroIibb" ADD CONSTRAINT "TerceroIibb_terceroId_fkey" FOREIGN KEY ("terceroId") REFERENCES "Tercero"("id") ON DELETE CASCADE ON UPDATE CASCADE;
