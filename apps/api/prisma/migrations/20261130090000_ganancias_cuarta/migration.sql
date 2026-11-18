-- AlterEnum
ALTER TYPE "TipoConcepto" ADD VALUE 'GANANCIAS';

-- AlterTable
ALTER TABLE "Concepto" ADD COLUMN     "exentoGanancias" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReciboSueldo" ADD COLUMN     "hojaGanancias" JSONB;

-- CreateTable
CREATE TABLE "TablaGanancias" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "semestre" INTEGER NOT NULL,
    "gni" DECIMAL(18,2) NOT NULL,
    "deduccionEspecial" DECIMAL(18,2) NOT NULL,
    "conyuge" DECIMAL(18,2) NOT NULL,
    "hijo" DECIMAL(18,2) NOT NULL,
    "hijoIncapacitado" DECIMAL(18,2) NOT NULL,
    "topeHipotecario" DECIMAL(18,2) NOT NULL,
    "topeSeguroMuerte" DECIMAL(18,2) NOT NULL,
    "topeSeguroMixto" DECIMAL(18,2) NOT NULL,
    "topeSeguroRetiro" DECIMAL(18,2) NOT NULL,
    "topeSepelio" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "TablaGanancias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TramoGanancias" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "tablaId" UUID NOT NULL,
    "desde" DECIMAL(18,2) NOT NULL,
    "hasta" DECIMAL(18,2),
    "fijo" DECIMAL(18,2) NOT NULL,
    "porcentaje" DECIMAL(7,4) NOT NULL,

    CONSTRAINT "TramoGanancias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "F572" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "empleadoId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "nroPresentacion" INTEGER NOT NULL DEFAULT 0,
    "fecha" DATE,
    "origen" TEXT NOT NULL,
    "modificadoAMano" BOOLEAN NOT NULL DEFAULT false,
    "datos" JSONB NOT NULL,

    CONSTRAINT "F572_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcumuladoGanancias" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "empleadoId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "bruta" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aportes" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "retenido" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "AcumuladoGanancias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TablaGanancias_empresaId_anio_semestre_key" ON "TablaGanancias"("empresaId", "anio", "semestre");

-- CreateIndex
CREATE INDEX "TramoGanancias_tablaId_idx" ON "TramoGanancias"("tablaId");

-- CreateIndex
CREATE INDEX "F572_empresaId_idx" ON "F572"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "F572_empleadoId_anio_key" ON "F572"("empleadoId", "anio");

-- CreateIndex
CREATE INDEX "AcumuladoGanancias_empresaId_idx" ON "AcumuladoGanancias"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "AcumuladoGanancias_empleadoId_anio_key" ON "AcumuladoGanancias"("empleadoId", "anio");

-- AddForeignKey
ALTER TABLE "TramoGanancias" ADD CONSTRAINT "TramoGanancias_tablaId_fkey" FOREIGN KEY ("tablaId") REFERENCES "TablaGanancias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

