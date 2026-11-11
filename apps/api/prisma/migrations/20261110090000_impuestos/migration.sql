-- CreateEnum
CREATE TYPE "SituacionIibb" AS ENUM ('LOCAL', 'CONVENIO', 'NO_INSCRIPTO', 'SIMPLIFICADO');

-- CreateEnum
CREATE TYPE "TipoPresentacion" AS ENUM ('LIBRO_IVA_DIGITAL', 'SICORE', 'ARBA', 'AGIP');

-- CreateEnum
CREATE TYPE "PeriodicidadArba" AS ENUM ('MENSUAL', 'QUINCENAL');

-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "numeroIibb" TEXT,
ADD COLUMN     "situacionIibb" "SituacionIibb";

-- CreateTable
CREATE TABLE "ConfigImpuestos" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "arbaActividad" TEXT NOT NULL DEFAULT '6',
    "arbaSucursal" INTEGER NOT NULL DEFAULT 1,
    "arbaPeriodicidad" "PeriodicidadArba" NOT NULL DEFAULT 'MENSUAL',
    "agipCodigoNorma" TEXT NOT NULL DEFAULT '029',

    CONSTRAINT "ConfigImpuestos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presentacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "tipo" "TipoPresentacion" NOT NULL,
    "periodo" TEXT NOT NULL,
    "quincena" INTEGER NOT NULL DEFAULT 0,
    "nombreArchivo" TEXT NOT NULL,
    "contenido" BYTEA NOT NULL,
    "registros" INTEGER NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "huella" TEXT NOT NULL,
    "advertencias" JSONB NOT NULL,
    "generadoPor" TEXT NOT NULL,
    "generadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Presentacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigImpuestos_empresaId_key" ON "ConfigImpuestos"("empresaId");

-- CreateIndex
CREATE INDEX "Presentacion_empresaId_tipo_periodo_idx" ON "Presentacion"("empresaId", "tipo", "periodo");


-- Permisos nuevos para el rol Administrador
UPDATE "Rol" SET "permisos" = array(SELECT DISTINCT unnest("permisos" || ARRAY['impuestos.ver', 'impuestos.presentar'])) WHERE "nombre" = 'Administrador';
