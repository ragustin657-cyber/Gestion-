-- CreateTable
CREATE TABLE "ConfigCorreo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "servidor" TEXT NOT NULL,
    "puerto" INTEGER NOT NULL DEFAULT 587,
    "seguro" BOOLEAN NOT NULL DEFAULT false,
    "usuario" TEXT NOT NULL,
    "claveCifrada" TEXT NOT NULL,
    "remitenteNombre" TEXT NOT NULL,
    "remitenteEmail" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,

    CONSTRAINT "ConfigCorreo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigCorreo_empresaId_key" ON "ConfigCorreo"("empresaId");


-- Permiso nuevo para el rol Administrador de las empresas existentes
UPDATE "Rol" SET "permisos" = array_append("permisos", 'correo.configurar') WHERE "nombre" = 'Administrador' AND NOT ('correo.configurar' = ANY("permisos"));
