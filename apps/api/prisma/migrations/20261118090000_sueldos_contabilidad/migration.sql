-- CreateEnum
CREATE TYPE "DestinoContribucion" AS ENUM ('SEGURIDAD_SOCIAL', 'OBRA_SOCIAL', 'ART', 'SEGURO_VIDA');

-- CreateEnum
CREATE TYPE "DestinoDescuento" AS ENUM ('SEGURIDAD_SOCIAL', 'OBRA_SOCIAL', 'SINDICAL', 'OTRO');

-- AlterTable
ALTER TABLE "Concepto" ADD COLUMN     "cuentaContableId" UUID,
ADD COLUMN     "destino" "DestinoDescuento" NOT NULL DEFAULT 'OTRO';

-- AlterTable
ALTER TABLE "Empleado" ADD COLUMN     "adherentesObraSocial" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cantidadHijos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codigoActividad" INTEGER NOT NULL DEFAULT 49,
ADD COLUMN     "codigoCondicion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "codigoModalidad" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "codigoObraSocial" TEXT NOT NULL DEFAULT '000000',
ADD COLUMN     "codigoSiniestrado" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codigoSituacion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "codigoZona" INTEGER,
ADD COLUMN     "conyuge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "regimen" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "trabajadorConvencionado" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "codigoZonaSicoss" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tipoEmpresaSicoss" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Liquidacion" ADD COLUMN     "asientoId" UUID;

-- AlterTable
ALTER TABLE "ReciboSueldo" ADD COLUMN     "centroCostoId" UUID;

-- CreateTable
CREATE TABLE "ContribucionPatronal" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "destino" "DestinoContribucion" NOT NULL,
    "alicuota" DECIMAL(9,4) NOT NULL,
    "importeFijo" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aplicaDetraccion" BOOLEAN NOT NULL DEFAULT false,
    "cuentaContableId" UUID NOT NULL,
    "desdeAnio" INTEGER NOT NULL,
    "desdeMes" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ContribucionPatronal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParametroPrevisional" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "baseMaximaAportes" DECIMAL(18,2),
    "detraccion" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ParametroPrevisional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracionSueldos" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "cuentaSueldosId" UUID,
    "cuentaContribucionesId" UUID,
    "cuentaSueldosAPagarId" UUID,
    "cuentaCargasSocialesId" UUID,
    "cuentaRetencionesSindicalesId" UUID,

    CONSTRAINT "ConfiguracionSueldos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReciboSueldoContribucion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "reciboId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "destino" "DestinoContribucion" NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "alicuota" DECIMAL(9,4) NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,
    "cuentaContableId" UUID NOT NULL,

    CONSTRAINT "ReciboSueldoContribucion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagoSueldos" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "liquidacionId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "cuentaBancariaId" UUID,
    "cajaId" UUID,
    "importe" DECIMAL(18,2) NOT NULL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "asientoId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoSueldos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagoSueldosRecibo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "pagoId" UUID NOT NULL,
    "reciboId" UUID NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PagoSueldosRecibo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagoCargasSociales" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "cuentaContableDeudaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "cuentaBancariaId" UUID,
    "cajaId" UUID,
    "importe" DECIMAL(18,2) NOT NULL,
    "detalle" TEXT,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "asientoId" UUID,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoCargasSociales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContribucionPatronal_empresaId_codigo_desdeAnio_desdeMes_key" ON "ContribucionPatronal"("empresaId", "codigo", "desdeAnio", "desdeMes");

-- CreateIndex
CREATE UNIQUE INDEX "ParametroPrevisional_empresaId_anio_mes_key" ON "ParametroPrevisional"("empresaId", "anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionSueldos_empresaId_key" ON "ConfiguracionSueldos"("empresaId");

-- AddForeignKey
ALTER TABLE "ReciboSueldoContribucion" ADD CONSTRAINT "ReciboSueldoContribucion_reciboId_fkey" FOREIGN KEY ("reciboId") REFERENCES "ReciboSueldo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoSueldos" ADD CONSTRAINT "PagoSueldos_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "Liquidacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoSueldosRecibo" ADD CONSTRAINT "PagoSueldosRecibo_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "PagoSueldos"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Datos: cuentas de sueldos en las empresas con plan de cuentas (solo si el código está libre)
INSERT INTO "CuentaContable" ("id","empresaId","codigo","nombre","padreId","imputable","tipo","activa","monetaria")
SELECT gen_random_uuid(), p."empresaId", '2.1.03', 'Deudas sociales', p."id", false, 'PASIVO', true, true FROM "CuentaContable" p
WHERE p."codigo" = '2.1' AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '2.1.03');
INSERT INTO "CuentaContable" ("id","empresaId","codigo","nombre","padreId","imputable","tipo","activa","monetaria")
SELECT gen_random_uuid(), p."empresaId", '2.1.03.001', 'Sueldos a pagar', p."id", true, 'PASIVO', true, true FROM "CuentaContable" p
WHERE p."codigo" = '2.1.03' AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '2.1.03.001');
INSERT INTO "CuentaContable" ("id","empresaId","codigo","nombre","padreId","imputable","tipo","activa","monetaria")
SELECT gen_random_uuid(), p."empresaId", '2.1.03.002', 'Cargas sociales a pagar', p."id", true, 'PASIVO', true, true FROM "CuentaContable" p
WHERE p."codigo" = '2.1.03' AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '2.1.03.002');
INSERT INTO "CuentaContable" ("id","empresaId","codigo","nombre","padreId","imputable","tipo","activa","monetaria")
SELECT gen_random_uuid(), p."empresaId", '2.1.03.003', 'Retenciones sindicales a pagar', p."id", true, 'PASIVO', true, true FROM "CuentaContable" p
WHERE p."codigo" = '2.1.03' AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '2.1.03.003');
INSERT INTO "CuentaContable" ("id","empresaId","codigo","nombre","padreId","imputable","tipo","activa","monetaria")
SELECT gen_random_uuid(), p."empresaId", '5.2.09', 'Sueldos y jornales', p."id", true, 'RESULTADO_NEGATIVO', true, false FROM "CuentaContable" p
WHERE p."codigo" = '5.2' AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '5.2.09');
INSERT INTO "CuentaContable" ("id","empresaId","codigo","nombre","padreId","imputable","tipo","activa","monetaria")
SELECT gen_random_uuid(), p."empresaId", '5.2.10', 'Contribuciones patronales', p."id", true, 'RESULTADO_NEGATIVO', true, false FROM "CuentaContable" p
WHERE p."codigo" = '5.2' AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '5.2.10');

-- Configuración de cuentas (con las cuentas por código, si son de sueldos)
INSERT INTO "ConfiguracionSueldos" ("id","empresaId","cuentaSueldosId","cuentaContribucionesId","cuentaSueldosAPagarId","cuentaCargasSocialesId","cuentaRetencionesSindicalesId")
SELECT gen_random_uuid(), e."id",
  (SELECT x."id" FROM "CuentaContable" x WHERE x."empresaId" = e."id" AND x."codigo" = '5.2.09' AND x."nombre" = 'Sueldos y jornales'),
  (SELECT x."id" FROM "CuentaContable" x WHERE x."empresaId" = e."id" AND x."codigo" = '5.2.10' AND x."nombre" = 'Contribuciones patronales'),
  (SELECT x."id" FROM "CuentaContable" x WHERE x."empresaId" = e."id" AND x."codigo" = '2.1.03.001' AND x."nombre" = 'Sueldos a pagar'),
  (SELECT x."id" FROM "CuentaContable" x WHERE x."empresaId" = e."id" AND x."codigo" = '2.1.03.002' AND x."nombre" = 'Cargas sociales a pagar'),
  (SELECT x."id" FROM "CuentaContable" x WHERE x."empresaId" = e."id" AND x."codigo" = '2.1.03.003' AND x."nombre" = 'Retenciones sindicales a pagar')
FROM "Empresa" e WHERE NOT EXISTS (SELECT 1 FROM "ConfiguracionSueldos" c WHERE c."empresaId" = e."id");

-- Contribuciones patronales precargadas (desde 01/2026), contra Cargas sociales a pagar
INSERT INTO "ContribucionPatronal" ("id","empresaId","codigo","nombre","destino","alicuota","importeFijo","aplicaDetraccion","cuentaContableId","desdeAnio","desdeMes","activa")
SELECT gen_random_uuid(), c."empresaId", 'SIPA', 'Jubilación (SIPA)', 'SEGURIDAD_SOCIAL', 10.77, 0, true, c."cuentaCargasSocialesId", 2026, 1, true FROM "ConfiguracionSueldos" c
WHERE c."cuentaCargasSocialesId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ContribucionPatronal" x WHERE x."empresaId" = c."empresaId" AND x."codigo" = 'SIPA');
INSERT INTO "ContribucionPatronal" ("id","empresaId","codigo","nombre","destino","alicuota","importeFijo","aplicaDetraccion","cuentaContableId","desdeAnio","desdeMes","activa")
SELECT gen_random_uuid(), c."empresaId", 'PAMI', 'INSSJP (Ley 19.032)', 'SEGURIDAD_SOCIAL', 1.59, 0, true, c."cuentaCargasSocialesId", 2026, 1, true FROM "ConfiguracionSueldos" c
WHERE c."cuentaCargasSocialesId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ContribucionPatronal" x WHERE x."empresaId" = c."empresaId" AND x."codigo" = 'PAMI');
INSERT INTO "ContribucionPatronal" ("id","empresaId","codigo","nombre","destino","alicuota","importeFijo","aplicaDetraccion","cuentaContableId","desdeAnio","desdeMes","activa")
SELECT gen_random_uuid(), c."empresaId", 'FNE', 'Fondo Nacional de Empleo', 'SEGURIDAD_SOCIAL', 0.94, 0, true, c."cuentaCargasSocialesId", 2026, 1, true FROM "ConfiguracionSueldos" c
WHERE c."cuentaCargasSocialesId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ContribucionPatronal" x WHERE x."empresaId" = c."empresaId" AND x."codigo" = 'FNE');
INSERT INTO "ContribucionPatronal" ("id","empresaId","codigo","nombre","destino","alicuota","importeFijo","aplicaDetraccion","cuentaContableId","desdeAnio","desdeMes","activa")
SELECT gen_random_uuid(), c."empresaId", 'AAFF', 'Asignaciones familiares', 'SEGURIDAD_SOCIAL', 4.70, 0, true, c."cuentaCargasSocialesId", 2026, 1, true FROM "ConfiguracionSueldos" c
WHERE c."cuentaCargasSocialesId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ContribucionPatronal" x WHERE x."empresaId" = c."empresaId" AND x."codigo" = 'AAFF');
INSERT INTO "ContribucionPatronal" ("id","empresaId","codigo","nombre","destino","alicuota","importeFijo","aplicaDetraccion","cuentaContableId","desdeAnio","desdeMes","activa")
SELECT gen_random_uuid(), c."empresaId", 'OS', 'Obra social', 'OBRA_SOCIAL', 6, 0, false, c."cuentaCargasSocialesId", 2026, 1, true FROM "ConfiguracionSueldos" c
WHERE c."cuentaCargasSocialesId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ContribucionPatronal" x WHERE x."empresaId" = c."empresaId" AND x."codigo" = 'OS');
INSERT INTO "ContribucionPatronal" ("id","empresaId","codigo","nombre","destino","alicuota","importeFijo","aplicaDetraccion","cuentaContableId","desdeAnio","desdeMes","activa")
SELECT gen_random_uuid(), c."empresaId", 'ART', 'ART', 'ART', 2.5, 1500, false, c."cuentaCargasSocialesId", 2026, 1, true FROM "ConfiguracionSueldos" c
WHERE c."cuentaCargasSocialesId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ContribucionPatronal" x WHERE x."empresaId" = c."empresaId" AND x."codigo" = 'ART');
INSERT INTO "ContribucionPatronal" ("id","empresaId","codigo","nombre","destino","alicuota","importeFijo","aplicaDetraccion","cuentaContableId","desdeAnio","desdeMes","activa")
SELECT gen_random_uuid(), c."empresaId", 'SCVO', 'Seguro colectivo de vida obligatorio', 'SEGURO_VIDA', 0, 1000, false, c."cuentaCargasSocialesId", 2026, 1, true FROM "ConfiguracionSueldos" c
WHERE c."cuentaCargasSocialesId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ContribucionPatronal" x WHERE x."empresaId" = c."empresaId" AND x."codigo" = 'SCVO');

INSERT INTO "ParametroPrevisional" ("id","empresaId","anio","mes","baseMaximaAportes","detraccion")
SELECT gen_random_uuid(), e."id", 2026, 1, 3500000, 7003.68 FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "ParametroPrevisional" x WHERE x."empresaId" = e."id");

-- Destino de los descuentos precargados y tope de la base máxima
UPDATE "Concepto" SET "destino" = 'SEGURIDAD_SOCIAL' WHERE "codigo" IN ('500', '510') AND "tipo" = 'DESCUENTO_LEY';
UPDATE "Concepto" SET "destino" = 'OBRA_SOCIAL' WHERE "codigo" = '520' AND "tipo" = 'DESCUENTO_LEY';
UPDATE "Concepto" SET "destino" = 'SINDICAL' WHERE "codigo" IN ('530', '540') AND "tipo" = 'DESCUENTO_LEY';
UPDATE "Concepto" SET "parametros" = "parametros" || '{"tope": "BASE_MAXIMA"}'::jsonb
WHERE "codigo" IN ('500', '510', '520') AND "tipo" = 'DESCUENTO_LEY' AND NOT ("parametros" ? 'tope');
UPDATE "Concepto" k SET "cuentaContableId" = c."cuentaRetencionesSindicalesId" FROM "ConfiguracionSueldos" c
WHERE c."empresaId" = k."empresaId" AND k."destino" = 'SINDICAL' AND k."cuentaContableId" IS NULL;

-- Centro de costo de los recibos existentes, desde el empleado
UPDATE "ReciboSueldo" r SET "centroCostoId" = e."centroCostoId" FROM "Empleado" e WHERE e."id" = r."empleadoId" AND r."centroCostoId" IS NULL;
