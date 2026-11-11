-- CreateEnum
CREATE TYPE "TipoMovimientoStock" AS ENUM ('RECEPCION', 'COMPRA', 'AJUSTE_COSTO', 'VENTA', 'DEVOLUCION_VENTA', 'TRANSFERENCIA', 'INVENTARIO', 'INICIAL', 'SALIDA_MANUAL', 'REGULARIZACION');

-- CreateEnum
CREATE TYPE "TipoDocumentoStock" AS ENUM ('TRANSFERENCIA', 'INVENTARIO', 'INICIAL', 'SALIDA');

-- CreateEnum
CREATE TYPE "EstadoDocumentoStock" AS ENUM ('CONFIRMADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "ModoStockNegativo" AS ENUM ('BLOQUEAR', 'AVISAR');

-- AlterTable
ALTER TABLE "Articulo" ADD COLUMN     "controlaStock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "costoPromedio" DECIMAL(18,6) NOT NULL DEFAULT 0,
ADD COLUMN     "stockCantidad" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "stockValor" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ComprobanteCompra" ADD COLUMN     "depositoId" UUID;

-- AlterTable
ALTER TABLE "ComprobanteVenta" ADD COLUMN     "depositoId" UUID,
ADD COLUMN     "devuelveMercaderia" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InformeRecepcion" ADD COLUMN     "asientoAnulacionId" UUID,
ADD COLUMN     "asientoId" UUID;

-- AlterTable
ALTER TABLE "PuntoVenta" ADD COLUMN     "depositoId" UUID;

-- CreateTable
CREATE TABLE "SaldoStock" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "depositoId" UUID NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SaldoStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoStock" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "articuloId" UUID NOT NULL,
    "depositoId" UUID,
    "tipo" "TipoMovimientoStock" NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "costoUnitario" DECIMAL(18,6) NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "origenTipo" TEXT NOT NULL,
    "origenId" TEXT NOT NULL,
    "origenRenglonId" TEXT,
    "anulaAId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoStock" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipo" "TipoDocumentoStock" NOT NULL,
    "fecha" DATE NOT NULL,
    "depositoId" UUID NOT NULL,
    "depositoDestinoId" UUID,
    "cuentaContableId" UUID,
    "conAsiento" BOOLEAN NOT NULL DEFAULT true,
    "observaciones" TEXT,
    "estado" "EstadoDocumentoStock" NOT NULL DEFAULT 'CONFIRMADO',
    "motivoAnulacion" TEXT,
    "asientoId" UUID,
    "asientoAnulacionId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentoStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoStockRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "documentoId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "costoUnitario" DECIMAL(18,6),
    "cantidadContada" DECIMAL(18,4),

    CONSTRAINT "DocumentoStockRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigStock" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "stockNegativo" "ModoStockNegativo" NOT NULL DEFAULT 'BLOQUEAR',

    CONSTRAINT "ConfigStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaldoStock_empresaId_articuloId_depositoId_key" ON "SaldoStock"("empresaId", "articuloId", "depositoId");

-- CreateIndex
CREATE INDEX "MovimientoStock_empresaId_articuloId_creadoEn_idx" ON "MovimientoStock"("empresaId", "articuloId", "creadoEn");

-- CreateIndex
CREATE INDEX "MovimientoStock_empresaId_origenTipo_origenId_idx" ON "MovimientoStock"("empresaId", "origenTipo", "origenId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoStock_empresaId_numero_key" ON "DocumentoStock"("empresaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigStock_empresaId_key" ON "ConfigStock"("empresaId");

-- AddForeignKey
ALTER TABLE "DocumentoStockRenglon" ADD CONSTRAINT "DocumentoStockRenglon_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "DocumentoStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Datos: cuentas de stock donde exista la madre y no el código
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '1.1.05', 'Bienes de cambio', p."id", false, 'ACTIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '1.1' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '1.1.05');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '1.1.05.001', 'Mercaderías', p."id", true, 'ACTIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '1.1.05' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '1.1.05.001');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '2.1.01.003', 'Mercadería recibida a facturar', p."id", true, 'PASIVO', true, true
FROM "CuentaContable" p
WHERE p."codigo" = '2.1.01' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '2.1.01.003');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '4.2.04', 'Sobrantes de inventario', p."id", true, 'RESULTADO_POSITIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '4.2' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '4.2.04');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '5.2.06', 'Faltantes de inventario', p."id", true, 'RESULTADO_NEGATIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '5.2' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '5.2.06');

UPDATE "CuentaContable" SET "monetaria" = false WHERE "codigo" = '1.1.05' OR "codigo" LIKE '1.1.05.%';

-- Datos: conceptos de stock (solo si la cuenta tiene el nombre esperado)
INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", v.concepto, c."id"
FROM (VALUES ('MERCADERIAS', '1.1.05.001', 'Mercaderías'), ('MERCADERIA_A_FACTURAR', '2.1.01.003', 'Mercadería recibida a facturar'),
             ('SOBRANTES_INVENTARIO', '4.2.04', 'Sobrantes de inventario'), ('FALTANTES_INVENTARIO', '5.2.06', 'Faltantes de inventario'),
             ('COSTO_MERCADERIAS_VENDIDAS', '5.1.01', NULL)) AS v(concepto, codigo, nombre)
JOIN "CuentaContable" c ON c."codigo" = v.codigo AND (v.nombre IS NULL OR c."nombre" = v.nombre)
WHERE NOT EXISTS (SELECT 1 FROM "ConfigCuenta" x WHERE x."empresaId" = c."empresaId" AND x."concepto" = v.concepto);
