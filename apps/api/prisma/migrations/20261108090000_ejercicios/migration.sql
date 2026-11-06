-- CreateEnum
CREATE TYPE "EstadoEjercicio" AS ENUM ('ABIERTO', 'CERRADO');

-- CreateEnum
CREATE TYPE "EstadoPeriodo" AS ENUM ('ABIERTO', 'CERRADO');

-- CreateEnum
CREATE TYPE "TipoAsiento" AS ENUM ('AUTOMATICO', 'MANUAL', 'REFUNDICION', 'CIERRE', 'APERTURA');

-- AlterTable
ALTER TABLE "Asiento" ADD COLUMN     "ejercicioId" UUID,
ADD COLUMN     "numeroDefinitivo" INTEGER,
ADD COLUMN     "tipo" "TipoAsiento" NOT NULL DEFAULT 'AUTOMATICO',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Ejercicio" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "estado" "EstadoEjercicio" NOT NULL DEFAULT 'ABIERTO',
    "asientoRefundicionId" UUID,
    "asientoCierreId" UUID,
    "asientoAperturaId" UUID,
    "cerradoPor" UUID,
    "cerradoEn" TIMESTAMP(3),
    "motivoReapertura" TEXT,

    CONSTRAINT "Ejercicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodoContable" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ejercicioId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "estado" "EstadoPeriodo" NOT NULL DEFAULT 'ABIERTO',
    "cerradoPor" UUID,
    "cerradoEn" TIMESTAMP(3),
    "motivoReapertura" TEXT,

    CONSTRAINT "PeriodoContable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ejercicio_empresaId_numero_key" ON "Ejercicio"("empresaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodoContable_empresaId_anio_mes_key" ON "PeriodoContable"("empresaId", "anio", "mes");

-- CreateIndex
CREATE INDEX "Asiento_empresaId_ejercicioId_fecha_idx" ON "Asiento"("empresaId", "ejercicioId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Asiento_empresaId_ejercicioId_numeroDefinitivo_key" ON "Asiento"("empresaId", "ejercicioId", "numeroDefinitivo");

-- CreateIndex
CREATE INDEX "AsientoRenglon_empresaId_cuentaContableId_idx" ON "AsientoRenglon"("empresaId", "cuentaContableId");

-- AddForeignKey
ALTER TABLE "PeriodoContable" ADD CONSTRAINT "PeriodoContable_ejercicioId_fkey" FOREIGN KEY ("ejercicioId") REFERENCES "Ejercicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ejercicios de las empresas existentes: desde el que contiene su asiento más antiguo hasta el que contiene hoy
DO $$
DECLARE
  e RECORD;
  primera DATE;
  d DATE;
  n INT;
  ej UUID;
BEGIN
  FOR e IN SELECT "id", "inicioEjercicioMes" AS m FROM "Empresa" LOOP
    primera := LEAST(COALESCE((SELECT MIN("fecha") FROM "Asiento" WHERE "empresaId" = e."id"), CURRENT_DATE), CURRENT_DATE);
    d := make_date(CASE WHEN EXTRACT(MONTH FROM primera) >= e.m THEN EXTRACT(YEAR FROM primera)::INT ELSE EXTRACT(YEAR FROM primera)::INT - 1 END, e.m, 1);
    n := 0;
    WHILE d <= CURRENT_DATE LOOP
      n := n + 1;
      ej := gen_random_uuid();
      INSERT INTO "Ejercicio" ("id", "empresaId", "numero", "desde", "hasta") VALUES (ej, e."id", n, d, (d + INTERVAL '12 months' - INTERVAL '1 day')::DATE);
      INSERT INTO "PeriodoContable" ("id", "empresaId", "ejercicioId", "anio", "mes", "desde", "hasta")
      SELECT gen_random_uuid(), e."id", ej, EXTRACT(YEAR FROM x)::INT, EXTRACT(MONTH FROM x)::INT, x::DATE, (x + INTERVAL '1 month' - INTERVAL '1 day')::DATE
      FROM generate_series(d, d + INTERVAL '11 months', INTERVAL '1 month') AS x;
      d := (d + INTERVAL '12 months')::DATE;
    END LOOP;
  END LOOP;
END $$;

UPDATE "Asiento" a SET "ejercicioId" = j."id" FROM "Ejercicio" j
WHERE j."empresaId" = a."empresaId" AND a."fecha" BETWEEN j."desde" AND j."hasta";

-- Cuenta y concepto del resultado del ejercicio
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo")
SELECT gen_random_uuid(), p."empresaId", '3.2.02', 'Resultado del ejercicio', p."id", true, 'PATRIMONIO_NETO'
FROM "CuentaContable" p
WHERE p."codigo" = '3.2' AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '3.2.02');

INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'RESULTADO_DEL_EJERCICIO', c."id" FROM "CuentaContable" c WHERE c."codigo" = '3.2.02'
ON CONFLICT ("empresaId", "concepto") DO NOTHING;

-- Permisos nuevos para el rol Administrador
UPDATE "Rol" SET "permisos" = array(SELECT DISTINCT unnest("permisos" || ARRAY['asiento.registrar', 'contabilidad.cerrar'])) WHERE "nombre" = 'Administrador';
