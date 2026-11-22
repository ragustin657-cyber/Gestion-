-- AlterTable
ALTER TABLE "ConfigImpuestos" ADD COLUMN     "alicuotaBienesPersonalesAcciones" DECIMAL(9,4) NOT NULL DEFAULT 0.5;

-- CreateTable
CREATE TABLE "Socio" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoDocumento" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "tipoTitular" "TipoTitularSocio" NOT NULL,
    "porcentaje" DECIMAL(9,4) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Socio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BienesPersonalesAcciones" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "ajustePatrimonio" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "conceptoAjuste" TEXT,
    "estado" "EstadoBienesPersonales" NOT NULL DEFAULT 'BORRADOR',

    CONSTRAINT "BienesPersonalesAcciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BienesPersonalesParticipacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "socioId" UUID NOT NULL,
    "tipoTitular" "TipoTitularSocio" NOT NULL,
    "porcentaje" DECIMAL(9,4) NOT NULL,

    CONSTRAINT "BienesPersonalesParticipacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BienesPersonalesPresentacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "datos" JSONB NOT NULL,
    "presentadaPor" TEXT NOT NULL,
    "presentadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladaEn" TIMESTAMP(3),
    "anuladaPor" TEXT,
    "motivoAnulacion" TEXT,

    CONSTRAINT "BienesPersonalesPresentacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BienesPersonalesAcciones_empresaId_anio_key" ON "BienesPersonalesAcciones"("empresaId", "anio");

-- CreateIndex
CREATE UNIQUE INDEX "BienesPersonalesParticipacion_empresaId_anio_socioId_key" ON "BienesPersonalesParticipacion"("empresaId", "anio", "socioId");

-- CreateIndex
CREATE UNIQUE INDEX "BienesPersonalesPresentacion_empresaId_anio_numero_key" ON "BienesPersonalesPresentacion"("empresaId", "anio", "numero");

