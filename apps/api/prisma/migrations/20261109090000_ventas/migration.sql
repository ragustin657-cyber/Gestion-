-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('CUIT', 'DNI', 'OTRO');

-- CreateEnum
CREATE TYPE "AmbienteArca" AS ENUM ('SIMULADO', 'HOMOLOGACION', 'PRODUCCION');

-- CreateEnum
CREATE TYPE "TipoComprobanteVenta" AS ENUM ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO');

-- CreateEnum
CREATE TYPE "ConceptoVenta" AS ENUM ('PRODUCTOS', 'SERVICIOS', 'PRODUCTOS_Y_SERVICIOS');

-- CreateEnum
CREATE TYPE "EstadoComprobanteVenta" AS ENUM ('PENDIENTE_CAE', 'AUTORIZADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "EstadoRecibo" AS ENUM ('CONFIRMADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "TipoRetencionSufrida" AS ENUM ('IVA', 'GANANCIAS', 'IIBB', 'SUSS');

-- AlterTable
ALTER TABLE "PuntoVenta" ADD COLUMN     "electronico" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sucursalId" UUID;

-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "tipoDocumento" "TipoDocumento" NOT NULL DEFAULT 'CUIT';

-- CreateTable
CREATE TABLE "ConfigArca" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ambiente" "AmbienteArca" NOT NULL DEFAULT 'SIMULADO',
    "certificadoCifrado" TEXT,
    "claveCifrada" TEXT,
    "certificadoSujeto" TEXT,
    "certificadoVence" TIMESTAMP(3),

    CONSTRAINT "ConfigArca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenArca" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ambiente" "AmbienteArca" NOT NULL,
    "servicio" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sign" TEXT NOT NULL,
    "vence" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenArca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArcaSimuladoComprobante" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ptoVta" INTEGER NOT NULL,
    "cbteTipo" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "cae" TEXT NOT NULL,
    "caeVencimiento" DATE NOT NULL,
    "docNro" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "moneda" TEXT NOT NULL,

    CONSTRAINT "ArcaSimuladoComprobante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComprobanteVenta" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numeroInterno" INTEGER NOT NULL,
    "tipo" "TipoComprobanteVenta" NOT NULL,
    "letra" TEXT NOT NULL,
    "puntoVentaId" UUID NOT NULL,
    "puntoVenta" INTEGER NOT NULL,
    "numero" INTEGER,
    "terceroId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "fechaVencimiento" DATE NOT NULL,
    "concepto" "ConceptoVenta" NOT NULL,
    "fechaServicioDesde" DATE,
    "fechaServicioHasta" DATE,
    "fechaVencimientoPago" DATE,
    "monedaCodigo" TEXT NOT NULL,
    "cotizacion" DECIMAL(18,6) NOT NULL,
    "netoGravado" DECIMAL(18,2) NOT NULL,
    "noGravado" DECIMAL(18,2) NOT NULL,
    "exento" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "totalPesos" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoComprobanteVenta" NOT NULL DEFAULT 'PENDIENTE_CAE',
    "emisionEnCurso" TIMESTAMP(3),
    "numeroReservado" INTEGER,
    "cae" TEXT,
    "caeVencimiento" DATE,
    "ultimoError" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "comprobanteAsociadoId" UUID,
    "aplicarAAsociado" BOOLEAN NOT NULL DEFAULT true,
    "asientoId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ComprobanteVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComprobanteVentaRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "articuloId" UUID,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "precioUnitario" DECIMAL(18,4) NOT NULL,
    "alicuota" TEXT NOT NULL,
    "neto" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "cuentaContableId" UUID NOT NULL,

    CONSTRAINT "ComprobanteVentaRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComprobanteVentaIva" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "alicuota" DECIMAL(18,6) NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ComprobanteVentaIva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recibo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "puntoVentaId" UUID NOT NULL,
    "puntoVenta" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "terceroId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "sucursalId" UUID NOT NULL,
    "cajaId" UUID NOT NULL,
    "ingresoId" UUID,
    "totalValores" DECIMAL(18,2) NOT NULL,
    "totalRetenciones" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoRecibo" NOT NULL DEFAULT 'CONFIRMADO',
    "asientoId" UUID,
    "asientoAnulacionId" UUID,
    "motivoAnulacion" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recibo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReciboRetencion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "reciboId" UUID NOT NULL,
    "tipo" "TipoRetencionSufrida" NOT NULL,
    "jurisdiccion" TEXT,
    "numeroCertificado" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ReciboRetencion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AplicacionCobro" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "terceroId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "origenTipo" TEXT NOT NULL,
    "origenId" UUID NOT NULL,
    "creditoMovId" UUID NOT NULL,
    "debitoMovId" UUID NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "importePesosCredito" DECIMAL(18,2) NOT NULL,
    "importePesosDebito" DECIMAL(18,2) NOT NULL,
    "diferenciaCambio" DECIMAL(18,2) NOT NULL,
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AplicacionCobro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigArca_empresaId_key" ON "ConfigArca"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "TokenArca_empresaId_ambiente_servicio_key" ON "TokenArca"("empresaId", "ambiente", "servicio");

-- CreateIndex
CREATE UNIQUE INDEX "ArcaSimuladoComprobante_empresaId_ptoVta_cbteTipo_numero_key" ON "ArcaSimuladoComprobante"("empresaId", "ptoVta", "cbteTipo", "numero");

-- CreateIndex
CREATE INDEX "ComprobanteVenta_empresaId_terceroId_idx" ON "ComprobanteVenta"("empresaId", "terceroId");

-- CreateIndex
CREATE INDEX "ComprobanteVenta_empresaId_fecha_idx" ON "ComprobanteVenta"("empresaId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteVenta_empresaId_numeroInterno_key" ON "ComprobanteVenta"("empresaId", "numeroInterno");

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteVenta_empresaId_puntoVenta_tipo_letra_numero_key" ON "ComprobanteVenta"("empresaId", "puntoVenta", "tipo", "letra", "numero");

-- CreateIndex
CREATE INDEX "Recibo_empresaId_terceroId_idx" ON "Recibo"("empresaId", "terceroId");

-- CreateIndex
CREATE UNIQUE INDEX "Recibo_empresaId_puntoVenta_numero_key" ON "Recibo"("empresaId", "puntoVenta", "numero");

-- CreateIndex
CREATE INDEX "AplicacionCobro_empresaId_origenTipo_origenId_idx" ON "AplicacionCobro"("empresaId", "origenTipo", "origenId");

-- CreateIndex
CREATE INDEX "AplicacionCobro_empresaId_creditoMovId_idx" ON "AplicacionCobro"("empresaId", "creditoMovId");

-- CreateIndex
CREATE INDEX "AplicacionCobro_empresaId_debitoMovId_idx" ON "AplicacionCobro"("empresaId", "debitoMovId");

-- AddForeignKey
ALTER TABLE "ComprobanteVenta" ADD CONSTRAINT "ComprobanteVenta_terceroId_fkey" FOREIGN KEY ("terceroId") REFERENCES "Tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComprobanteVentaRenglon" ADD CONSTRAINT "ComprobanteVentaRenglon_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComprobanteVentaIva" ADD CONSTRAINT "ComprobanteVentaIva_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReciboRetencion" ADD CONSTRAINT "ReciboRetencion_reciboId_fkey" FOREIGN KEY ("reciboId") REFERENCES "Recibo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Cuentas de retenciones sufridas por tipo
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo")
SELECT gen_random_uuid(), p."empresaId", n.codigo, n.nombre, p."id", true, 'ACTIVO'
FROM "CuentaContable" p
CROSS JOIN (VALUES ('1.1.03.005', 'Retenciones IVA sufridas'), ('1.1.03.006', 'Retenciones Ganancias sufridas'),
                   ('1.1.03.007', 'Retenciones IIBB sufridas'), ('1.1.03.008', 'Retenciones SUSS sufridas')) AS n(codigo, nombre)
WHERE p."codigo" = '1.1.03' AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = n.codigo);

-- Conceptos contables de ventas
INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", n.concepto, c."id"
FROM "CuentaContable" c
JOIN (VALUES ('VENTAS', '4.1.01'), ('IVA_DEBITO_FISCAL', '2.1.02.001'), ('RETENCION_SUFRIDA_IVA', '1.1.03.005'),
             ('RETENCION_SUFRIDA_GANANCIAS', '1.1.03.006'), ('RETENCION_SUFRIDA_IIBB', '1.1.03.007'), ('RETENCION_SUFRIDA_SUSS', '1.1.03.008')) AS n(concepto, codigo)
  ON c."codigo" = n.codigo
ON CONFLICT ("empresaId", "concepto") DO NOTHING;

-- Factura electrónica: todas las empresas arrancan en modo simulado
INSERT INTO "ConfigArca" ("id", "empresaId", "ambiente") SELECT gen_random_uuid(), e."id", 'SIMULADO' FROM "Empresa" e
ON CONFLICT ("empresaId") DO NOTHING;

-- Permisos nuevos para el rol Administrador
UPDATE "Rol" SET "permisos" = array(SELECT DISTINCT unnest("permisos" || ARRAY['venta.emitir', 'cobro.registrar', 'venta.ver', 'arca.configurar'])) WHERE "nombre" = 'Administrador';
