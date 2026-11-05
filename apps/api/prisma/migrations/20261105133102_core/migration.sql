-- CreateEnum
CREATE TYPE "CondicionIva" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_RESPONSABLE');

-- CreateTable
CREATE TABLE "Empresa" (
    "id" UUID NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "condicionIva" "CondicionIva" NOT NULL,
    "domicilio" TEXT,
    "inicioEjercicioMes" INTEGER NOT NULL DEFAULT 1,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuntoVenta" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "PuntoVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "superadmin" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rol" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "permisos" TEXT[],

    CONSTRAINT "Rol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioEmpresa" (
    "usuarioId" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "rolId" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UsuarioEmpresa_pkey" PRIMARY KEY ("usuarioId","empresaId")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "datos" JSONB,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PuntoVenta_empresaId_numero_key" ON "PuntoVenta"("empresaId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Rol_empresaId_nombre_key" ON "Rol"("empresaId", "nombre");

-- CreateIndex
CREATE INDEX "Auditoria_empresaId_entidad_entidadId_idx" ON "Auditoria"("empresaId", "entidad", "entidadId");

-- AddForeignKey
ALTER TABLE "PuntoVenta" ADD CONSTRAINT "PuntoVenta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rol" ADD CONSTRAINT "Rol_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_rolId_fkey" FOREIGN KEY ("rolId") REFERENCES "Rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
