-- CreateEnum
CREATE TYPE "TipoVendedor" AS ENUM ('EMPLEADO', 'EXTERNO');

-- CreateEnum
CREATE TYPE "EstadoLiquidacionComisiones" AS ENUM ('CONFIRMADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "TipoRenglonComision" AS ENUM ('COBRO', 'ANULACION', 'RECHAZO');

-- AlterTable
ALTER TABLE "ComprobanteVenta" ADD COLUMN     "comisionPct" DECIMAL(5,2),
ADD COLUMN     "vendedorId" UUID;

-- AlterTable
ALTER TABLE "ConfiguracionSueldos" ADD COLUMN     "conceptoComisionesId" UUID;

-- AlterTable
ALTER TABLE "Novedad" ADD COLUMN     "liquidacionComisionesId" UUID;

-- AlterTable
ALTER TABLE "PedidoVenta" ADD COLUMN     "vendedorId" UUID;

-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "vendedorId" UUID;

-- CreateTable
CREATE TABLE "Vendedor" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoVendedor" NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "empleadoId" UUID,
    "proveedorId" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Vendedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionComisiones" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" "EstadoLiquidacionComisiones" NOT NULL DEFAULT 'CONFIRMADA',
    "motivoAnulacion" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidacionComisiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionComisionesRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "liquidacionId" UUID NOT NULL,
    "vendedorId" UUID NOT NULL,
    "tipo" "TipoRenglonComision" NOT NULL,
    "aplicacionId" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "chequeId" UUID,
    "cobrado" DECIMAL(18,2) NOT NULL,
    "neto" DECIMAL(18,2) NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "comision" DECIMAL(18,2) NOT NULL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LiquidacionComisionesRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendedor_empresaId_nombre_key" ON "Vendedor"("empresaId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Vendedor_empresaId_empleadoId_key" ON "Vendedor"("empresaId", "empleadoId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendedor_empresaId_proveedorId_key" ON "Vendedor"("empresaId", "proveedorId");

-- CreateIndex
CREATE INDEX "LiquidacionComisiones_empresaId_anio_mes_idx" ON "LiquidacionComisiones"("empresaId", "anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidacionComisiones_empresaId_numero_key" ON "LiquidacionComisiones"("empresaId", "numero");

-- CreateIndex
CREATE INDEX "LiquidacionComisionesRenglon_empresaId_aplicacionId_idx" ON "LiquidacionComisionesRenglon"("empresaId", "aplicacionId");

-- CreateIndex
CREATE INDEX "LiquidacionComisionesRenglon_empresaId_liquidacionId_idx" ON "LiquidacionComisionesRenglon"("empresaId", "liquidacionId");

-- AddForeignKey
ALTER TABLE "LiquidacionComisionesRenglon" ADD CONSTRAINT "LiquidacionComisionesRenglon_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionComisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Índices únicos parciales (a mano: Prisma no los modela). Una sola liquidación confirmada por mes,
-- y cada aplicación (o cheque y aplicación) a lo sumo una vez por tipo de renglón vigente.
CREATE UNIQUE INDEX "LiquidacionComisiones_mes_confirmada" ON "LiquidacionComisiones"("empresaId", "anio", "mes") WHERE "estado" = 'CONFIRMADA';
CREATE UNIQUE INDEX "LiquidacionComisionesRenglon_cobro_unico" ON "LiquidacionComisionesRenglon"("aplicacionId") WHERE "tipo" = 'COBRO' AND NOT "anulado";
CREATE UNIQUE INDEX "LiquidacionComisionesRenglon_anulacion_unica" ON "LiquidacionComisionesRenglon"("aplicacionId") WHERE "tipo" = 'ANULACION' AND NOT "anulado";
CREATE UNIQUE INDEX "LiquidacionComisionesRenglon_rechazo_unico" ON "LiquidacionComisionesRenglon"("chequeId", "aplicacionId") WHERE "tipo" = 'RECHAZO' AND NOT "anulado";
