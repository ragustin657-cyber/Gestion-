-- CreateTable
CREATE TABLE "Articulo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "unidad" TEXT NOT NULL DEFAULT 'UN',
    "alicuotaIva" DECIMAL(18,6) NOT NULL,
    "cuentaCompraId" UUID,
    "cuentaVentaId" UUID,
    "esServicio" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Articulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Moneda" (
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "simbolo" TEXT NOT NULL,

    CONSTRAINT "Moneda_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "Cotizacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "valor" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "Cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CentroCosto" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CentroCosto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposito" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Deposito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Articulo_empresaId_codigo_key" ON "Articulo"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Cotizacion_empresaId_monedaCodigo_fecha_key" ON "Cotizacion"("empresaId", "monedaCodigo", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "CentroCosto_empresaId_codigo_key" ON "CentroCosto"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Deposito_empresaId_codigo_key" ON "Deposito"("empresaId", "codigo");

-- Monedas iniciales
INSERT INTO "Moneda" ("codigo", "nombre", "simbolo") VALUES ('ARS', 'Peso argentino', '$'), ('USD', 'Dólar estadounidense', 'US$');
