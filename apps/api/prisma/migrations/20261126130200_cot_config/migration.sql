-- CreateTable
CREATE TABLE "ConfigCot" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "ambiente" "AmbienteCot" NOT NULL DEFAULT 'SIMULADO',
    "usuario" TEXT,
    "claveCifrada" TEXT,
    "pedirAlConfirmar" BOOLEAN NOT NULL DEFAULT false,
    "secuencia" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ConfigCot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transportista" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "cuit" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "patentePorDefecto" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Transportista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigCot_empresaId_key" ON "ConfigCot"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Transportista_empresaId_cuit_key" ON "Transportista"("empresaId", "cuit");

