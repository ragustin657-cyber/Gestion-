-- CreateEnum
CREATE TYPE "CausaEgreso" AS ENUM ('RENUNCIA', 'DESPIDO_SIN_CAUSA', 'DESPIDO_CON_CAUSA', 'MUTUO_ACUERDO');

-- AlterEnum
ALTER TYPE "TipoLiquidacion" ADD VALUE 'FINAL';

-- DropIndex
DROP INDEX "Liquidacion_empresaId_tipo_anio_mes_key";

-- AlterTable
ALTER TABLE "ConfiguracionSueldos" ADD COLUMN     "cuentaIndemnizacionesId" UUID;

-- CreateTable
CREATE TABLE "EgresoEmpleado" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "liquidacionId" UUID NOT NULL,
    "empleadoId" UUID NOT NULL,
    "causa" "CausaEgreso" NOT NULL,
    "fechaEgreso" DATE NOT NULL,
    "preavisoOtorgado" BOOLEAN NOT NULL DEFAULT false,
    "mejorRemuneracion" DECIMAL(18,2),
    "gratificacion" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EgresoEmpleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopeIndemnizatorio" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "convenioId" UUID NOT NULL,
    "desdeAnio" INTEGER NOT NULL,
    "desdeMes" INTEGER NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "TopeIndemnizatorio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EgresoEmpleado_liquidacionId_key" ON "EgresoEmpleado"("liquidacionId");

-- CreateIndex
CREATE INDEX "EgresoEmpleado_empresaId_empleadoId_idx" ON "EgresoEmpleado"("empresaId", "empleadoId");

-- CreateIndex
CREATE UNIQUE INDEX "TopeIndemnizatorio_convenioId_desdeAnio_desdeMes_key" ON "TopeIndemnizatorio"("convenioId", "desdeAnio", "desdeMes");

-- CreateIndex
CREATE INDEX "Liquidacion_empresaId_tipo_anio_mes_idx" ON "Liquidacion"("empresaId", "tipo", "anio", "mes");

-- AddForeignKey
ALTER TABLE "EgresoEmpleado" ADD CONSTRAINT "EgresoEmpleado_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "Liquidacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Único (empresa, tipo, año, mes) solo para las liquidaciones mensuales y de SAC (las finales son una por egreso)
CREATE UNIQUE INDEX "Liquidacion_mensual_sac_unica" ON "Liquidacion" ("empresaId", "tipo", "anio", "mes") WHERE "tipo" IN ('MENSUAL', 'SAC');

-- Cuenta de indemnizaciones en las empresas con plan de cuentas (si el código está libre)
INSERT INTO "CuentaContable" ("id","empresaId","codigo","nombre","padreId","imputable","tipo","activa","monetaria")
SELECT gen_random_uuid(), p."empresaId", '5.2.11', 'Indemnizaciones', p."id", true, 'RESULTADO_NEGATIVO', true, false FROM "CuentaContable" p
WHERE p."codigo" = '5.2' AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '5.2.11');
UPDATE "ConfiguracionSueldos" c SET "cuentaIndemnizacionesId" = x."id" FROM "CuentaContable" x
WHERE x."empresaId" = c."empresaId" AND x."codigo" = '5.2.11' AND x."nombre" = 'Indemnizaciones' AND c."cuentaIndemnizacionesId" IS NULL;
