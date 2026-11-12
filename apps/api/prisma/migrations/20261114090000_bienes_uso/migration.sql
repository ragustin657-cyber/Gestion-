-- CreateEnum
CREATE TYPE "OrigenBienUso" AS ENUM ('FACTURA', 'MANUAL', 'INICIAL');

-- CreateEnum
CREATE TYPE "EstadoBienUso" AS ENUM ('ACTIVO', 'BAJA');

-- CreateEnum
CREATE TYPE "MotivoBajaBienUso" AS ENUM ('DESUSO', 'SINIESTRO', 'ROBO', 'VENTA');

-- CreateEnum
CREATE TYPE "EstadoProcesoAmortizacion" AS ENUM ('VIGENTE', 'ANULADO');

-- AlterTable
ALTER TABLE "AsientoRenglon" ADD COLUMN     "fechaOrigen" DATE;

-- AlterTable
ALTER TABLE "ComprobanteVentaRenglon" ADD COLUMN     "bienUsoId" UUID;

-- CreateTable
CREATE TABLE "RubroBienUso" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuentaOrigenId" UUID NOT NULL,
    "cuentaAmortizacionId" UUID NOT NULL,
    "cuentaGastoId" UUID NOT NULL,
    "vidaUtilMeses" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RubroBienUso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BienUso" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "rubroId" UUID NOT NULL,
    "fechaAlta" DATE NOT NULL,
    "valorOrigen" DECIMAL(18,2) NOT NULL,
    "vidaUtilMeses" INTEGER NOT NULL,
    "valorResidual" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "origen" "OrigenBienUso" NOT NULL,
    "comprobanteCompraRenglonId" UUID,
    "asientoAltaId" UUID,
    "amortizacionInicial" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fechaAmortizacionInicial" DATE,
    "estado" "EstadoBienUso" NOT NULL DEFAULT 'ACTIVO',
    "fechaBaja" DATE,
    "motivoBaja" "MotivoBajaBienUso",
    "comprobanteVentaRenglonId" UUID,
    "asientoBajaId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BienUso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcesoAmortizacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "mes" TEXT NOT NULL,
    "asientoId" UUID NOT NULL,
    "estado" "EstadoProcesoAmortizacion" NOT NULL DEFAULT 'VIGENTE',
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcesoAmortizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmortizacionBien" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "bienId" UUID NOT NULL,
    "procesoId" UUID NOT NULL,
    "mes" TEXT NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "AmortizacionBien_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RubroBienUso_empresaId_nombre_key" ON "RubroBienUso"("empresaId", "nombre");

-- CreateIndex
CREATE INDEX "BienUso_empresaId_comprobanteCompraRenglonId_idx" ON "BienUso"("empresaId", "comprobanteCompraRenglonId");

-- CreateIndex
CREATE UNIQUE INDEX "BienUso_empresaId_numero_key" ON "BienUso"("empresaId", "numero");

-- CreateIndex
CREATE INDEX "ProcesoAmortizacion_empresaId_mes_idx" ON "ProcesoAmortizacion"("empresaId", "mes");

-- CreateIndex
CREATE INDEX "AmortizacionBien_empresaId_bienId_idx" ON "AmortizacionBien"("empresaId", "bienId");

-- AddForeignKey
ALTER TABLE "BienUso" ADD CONSTRAINT "BienUso_rubroId_fkey" FOREIGN KEY ("rubroId") REFERENCES "RubroBienUso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmortizacionBien" ADD CONSTRAINT "AmortizacionBien_bienId_fkey" FOREIGN KEY ("bienId") REFERENCES "BienUso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmortizacionBien" ADD CONSTRAINT "AmortizacionBien_procesoId_fkey" FOREIGN KEY ("procesoId") REFERENCES "ProcesoAmortizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Datos: cuentas nuevas donde exista la cuenta madre y no el código
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '1.2.02', 'Amortizaciones acumuladas de bienes de uso', p."id", false, 'ACTIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '1.2' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '1.2.02');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '1.2.02.001', 'Amort. acum. muebles y útiles', p."id", true, 'ACTIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '1.2.02' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '1.2.02.001');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '1.2.02.002', 'Amort. acum. rodados', p."id", true, 'ACTIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '1.2.02' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '1.2.02.002');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '1.2.02.003', 'Amort. acum. equipos de computación', p."id", true, 'ACTIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '1.2.02' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '1.2.02.003');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '4.2.05', 'Resultado por venta de bienes de uso', p."id", true, 'RESULTADO_POSITIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '4.2' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '4.2.05');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '5.2.07', 'Amortizaciones de bienes de uso', p."id", true, 'RESULTADO_NEGATIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '5.2' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '5.2.07');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '5.2.08', 'Bajas de bienes de uso', p."id", true, 'RESULTADO_NEGATIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '5.2' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '5.2.08');

UPDATE "CuentaContable" SET "monetaria" = false WHERE "codigo" = '1.2.02' OR "codigo" LIKE '1.2.02.%';

-- Datos: conceptos nuevos
INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'RESULTADO_VENTA_BIENES_USO', c."id" FROM "CuentaContable" c
WHERE c."codigo" = '4.2.05' AND NOT EXISTS (SELECT 1 FROM "ConfigCuenta" x WHERE x."empresaId" = c."empresaId" AND x."concepto" = 'RESULTADO_VENTA_BIENES_USO');

INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'BAJAS_BIENES_USO', c."id" FROM "CuentaContable" c
WHERE c."codigo" = '5.2.08' AND NOT EXISTS (SELECT 1 FROM "ConfigCuenta" x WHERE x."empresaId" = c."empresaId" AND x."concepto" = 'BAJAS_BIENES_USO');

-- Datos: rubros precargados donde existan sus cuentas
INSERT INTO "RubroBienUso" ("id", "empresaId", "nombre", "cuentaOrigenId", "cuentaAmortizacionId", "cuentaGastoId", "vidaUtilMeses", "activo")
SELECT gen_random_uuid(), o."empresaId", 'Muebles y útiles', o."id", a."id", g."id", 120, true
FROM "CuentaContable" o
JOIN "CuentaContable" a ON a."empresaId" = o."empresaId" AND a."codigo" = '1.2.02.001'
JOIN "CuentaContable" g ON g."empresaId" = o."empresaId" AND g."codigo" = '5.2.07'
WHERE o."codigo" = '1.2.01.001' AND o."imputable" = true
  AND NOT EXISTS (SELECT 1 FROM "RubroBienUso" x WHERE x."empresaId" = o."empresaId" AND (x."nombre" = 'Muebles y útiles' OR x."cuentaOrigenId" = o."id"));

INSERT INTO "RubroBienUso" ("id", "empresaId", "nombre", "cuentaOrigenId", "cuentaAmortizacionId", "cuentaGastoId", "vidaUtilMeses", "activo")
SELECT gen_random_uuid(), o."empresaId", 'Rodados', o."id", a."id", g."id", 60, true
FROM "CuentaContable" o
JOIN "CuentaContable" a ON a."empresaId" = o."empresaId" AND a."codigo" = '1.2.02.002'
JOIN "CuentaContable" g ON g."empresaId" = o."empresaId" AND g."codigo" = '5.2.07'
WHERE o."codigo" = '1.2.01.002' AND o."imputable" = true
  AND NOT EXISTS (SELECT 1 FROM "RubroBienUso" x WHERE x."empresaId" = o."empresaId" AND (x."nombre" = 'Rodados' OR x."cuentaOrigenId" = o."id"));

INSERT INTO "RubroBienUso" ("id", "empresaId", "nombre", "cuentaOrigenId", "cuentaAmortizacionId", "cuentaGastoId", "vidaUtilMeses", "activo")
SELECT gen_random_uuid(), o."empresaId", 'Equipos de computación', o."id", a."id", g."id", 36, true
FROM "CuentaContable" o
JOIN "CuentaContable" a ON a."empresaId" = o."empresaId" AND a."codigo" = '1.2.02.003'
JOIN "CuentaContable" g ON g."empresaId" = o."empresaId" AND g."codigo" = '5.2.07'
WHERE o."codigo" = '1.2.01.003' AND o."imputable" = true
  AND NOT EXISTS (SELECT 1 FROM "RubroBienUso" x WHERE x."empresaId" = o."empresaId" AND (x."nombre" = 'Equipos de computación' OR x."cuentaOrigenId" = o."id"));

