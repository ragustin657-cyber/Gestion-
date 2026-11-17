-- CreateEnum
CREATE TYPE "MedioGestion" AS ENUM ('LLAMADO', 'MAIL', 'WHATSAPP', 'VISITA', 'OTRO');

-- CreateTable
CREATE TABLE "GestionCobranza" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "terceroId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "medio" "MedioGestion" NOT NULL,
    "nota" TEXT NOT NULL,
    "proximaAccion" DATE,
    "promesaFecha" DATE,
    "promesaImporte" DECIMAL(18,2),
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GestionCobranza_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GestionCobranza_empresaId_terceroId_fecha_idx" ON "GestionCobranza"("empresaId", "terceroId", "fecha");


-- El rol Administrador de las empresas existentes recibe el permiso nuevo (las nuevas lo traen de la precarga)
UPDATE "Rol" SET "permisos" = array_append("permisos", 'cobranzas.gestionar') WHERE "nombre" = 'Administrador' AND NOT ('cobranzas.gestionar' = ANY("permisos"));
