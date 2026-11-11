-- AlterEnum
ALTER TYPE "TipoAsiento" ADD VALUE 'AJUSTE_INFLACION';

-- AlterTable
ALTER TABLE "CuentaContable" ADD COLUMN     "cuentaAjusteId" UUID,
ADD COLUMN     "monetaria" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "IndiceInflacion" (
    "id" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "valor" DECIMAL(18,6) NOT NULL,
    "actualizadoPor" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndiceInflacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigAjusteInflacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "primerEjercicioId" UUID NOT NULL,
    "asientoAperturaId" UUID,
    "actualizadoPor" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigAjusteInflacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnticuacionApertura" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "AnticuacionApertura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndiceInflacion_anio_mes_key" ON "IndiceInflacion"("anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigAjusteInflacion_empresaId_key" ON "ConfigAjusteInflacion"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "AnticuacionApertura_empresaId_cuentaContableId_anio_mes_key" ON "AnticuacionApertura"("empresaId", "cuentaContableId", "anio", "mes");

-- AddForeignKey
ALTER TABLE "CuentaContable" ADD CONSTRAINT "CuentaContable_cuentaAjusteId_fkey" FOREIGN KEY ("cuentaAjusteId") REFERENCES "CuentaContable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Datos: clasificación monetaria por defecto
UPDATE "CuentaContable" SET "monetaria" = false
WHERE "tipo" IN ('PATRIMONIO_NETO', 'RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO') OR "codigo" = '1.2.01' OR "codigo" LIKE '1.2.01.%';

-- Datos: cuentas nuevas donde exista la cuenta madre y no el código
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '3.1.02', 'Ajuste de capital', p."id", true, 'PATRIMONIO_NETO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '3.1' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '3.1.02');

INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '4.2.03', 'Resultado por exposición a la inflación (RECPAM)', p."id", true, 'RESULTADO_POSITIVO', true, false
FROM "CuentaContable" p
WHERE p."codigo" = '4.2' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '4.2.03');

UPDATE "CuentaContable" c SET "cuentaAjusteId" = a."id"
FROM "CuentaContable" a
WHERE c."codigo" = '3.1.01' AND a."empresaId" = c."empresaId" AND a."codigo" = '3.1.02' AND a."nombre" = 'Ajuste de capital'
  AND c."cuentaAjusteId" IS NULL;

-- Datos: conceptos nuevos
INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'RECPAM', c."id" FROM "CuentaContable" c
WHERE c."codigo" = '4.2.03' AND NOT EXISTS (SELECT 1 FROM "ConfigCuenta" x WHERE x."empresaId" = c."empresaId" AND x."concepto" = 'RECPAM');

INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'RESULTADOS_NO_ASIGNADOS', c."id" FROM "CuentaContable" c
WHERE c."codigo" = '3.2.01' AND NOT EXISTS (SELECT 1 FROM "ConfigCuenta" x WHERE x."empresaId" = c."empresaId" AND x."concepto" = 'RESULTADOS_NO_ASIGNADOS');
