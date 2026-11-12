-- CreateEnum
CREATE TYPE "MotivoPrecio" AS ENUM ('MANUAL', 'AUMENTO', 'IMPORTACION', 'BAJA');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('PRESUPUESTO', 'CONFIRMADO', 'PARCIALMENTE_ENTREGADO', 'ENTREGADO', 'CERRADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "EstadoRemito" AS ENUM ('CONFIRMADO', 'ANULADO');

-- AlterTable
ALTER TABLE "ComprobanteVentaRenglon" ADD COLUMN     "pedidoRenglonId" UUID,
ADD COLUMN     "remitoRenglonId" UUID;

-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "listaPreciosId" UUID;

-- CreateTable
CREATE TABLE "ListaPrecios" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "monedaCodigo" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "porDefecto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ListaPrecios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrecioLista" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "listaId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "precio" DECIMAL(18,4) NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrecioLista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistorialPrecio" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "listaId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "precioAnterior" DECIMAL(18,4),
    "precioNuevo" DECIMAL(18,4),
    "motivo" "MotivoPrecio" NOT NULL,
    "usuario" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialPrecio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoVenta" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "terceroId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "validoHasta" DATE,
    "monedaCodigo" TEXT NOT NULL,
    "cotizacion" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "listaPreciosId" UUID,
    "depositoId" UUID,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'PRESUPUESTO',
    "observaciones" TEXT,
    "letra" TEXT NOT NULL,
    "netoGravado" DECIMAL(18,2) NOT NULL,
    "noGravado" DECIMAL(18,2) NOT NULL,
    "exento" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "motivoCierre" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PedidoVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoVentaRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "pedidoId" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "articuloId" UUID,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "precioUnitario" DECIMAL(18,4) NOT NULL,
    "alicuota" TEXT NOT NULL,
    "neto" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "cantidadEntregada" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cantidadFacturada" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "PedidoVentaRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remito" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "puntoVenta" INTEGER NOT NULL,
    "terceroId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "depositoId" UUID NOT NULL,
    "estado" "EstadoRemito" NOT NULL DEFAULT 'CONFIRMADO',
    "motivoAnulacion" TEXT,
    "asientoId" UUID,
    "asientoAnulacionId" UUID,
    "observaciones" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Remito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemitoRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "remitoId" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "pedidoRenglonId" UUID,
    "articuloId" UUID,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "cantidadFacturada" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "RemitoRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListaPrecios_empresaId_nombre_key" ON "ListaPrecios"("empresaId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "PrecioLista_listaId_articuloId_key" ON "PrecioLista"("listaId", "articuloId");

-- CreateIndex
CREATE INDEX "HistorialPrecio_empresaId_listaId_articuloId_idx" ON "HistorialPrecio"("empresaId", "listaId", "articuloId");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoVenta_empresaId_numero_key" ON "PedidoVenta"("empresaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Remito_empresaId_puntoVenta_numero_key" ON "Remito"("empresaId", "puntoVenta", "numero");

-- AddForeignKey
ALTER TABLE "PrecioLista" ADD CONSTRAINT "PrecioLista_listaId_fkey" FOREIGN KEY ("listaId") REFERENCES "ListaPrecios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoVentaRenglon" ADD CONSTRAINT "PedidoVentaRenglon_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "PedidoVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemitoRenglon" ADD CONSTRAINT "RemitoRenglon_remitoId_fkey" FOREIGN KEY ("remitoId") REFERENCES "Remito"("id") ON DELETE CASCADE ON UPDATE CASCADE;

