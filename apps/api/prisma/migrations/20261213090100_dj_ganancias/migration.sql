-- CreateTable
CREATE TABLE "EscalaSociedades" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "desde" DECIMAL(18,2) NOT NULL,
    "fijo" DECIMAL(18,2) NOT NULL,
    "alicuota" DECIMAL(9,4) NOT NULL,

    CONSTRAINT "EscalaSociedades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DjGananciasSociedades" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ejercicioId" UUID NOT NULL,
    "estado" "EstadoDjGanancias" NOT NULL DEFAULT 'BORRADOR',
    "quebrantosAnteriores" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "anticiposIngresados" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "saldoAFavorAnterior" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "impuestoCheque" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otrosPagos" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "DjGananciasSociedades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DjGananciasAjuste" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ejercicioId" UUID NOT NULL,
    "concepto" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DjGananciasAjuste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DjGananciasPresentacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ejercicioId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "datos" JSONB NOT NULL,
    "presentadaPor" TEXT NOT NULL,
    "presentadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladaEn" TIMESTAMP(3),
    "anuladaPor" TEXT,
    "motivoAnulacion" TEXT,

    CONSTRAINT "DjGananciasPresentacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EscalaSociedades_empresaId_anio_desde_key" ON "EscalaSociedades"("empresaId", "anio", "desde");

-- CreateIndex
CREATE UNIQUE INDEX "DjGananciasSociedades_ejercicioId_key" ON "DjGananciasSociedades"("ejercicioId");

-- CreateIndex
CREATE INDEX "DjGananciasAjuste_empresaId_ejercicioId_idx" ON "DjGananciasAjuste"("empresaId", "ejercicioId");

-- CreateIndex
CREATE UNIQUE INDEX "DjGananciasPresentacion_empresaId_ejercicioId_numero_key" ON "DjGananciasPresentacion"("empresaId", "ejercicioId", "numero");

