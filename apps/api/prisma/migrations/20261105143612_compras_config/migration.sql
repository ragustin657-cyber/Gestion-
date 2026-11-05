-- CreateEnum
CREATE TYPE "ModoTresVias" AS ENUM ('AVISAR', 'BLOQUEAR');

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "modoTresVias" "ModoTresVias" NOT NULL DEFAULT 'AVISAR',
ADD COLUMN     "montoAprobacionOc" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "toleranciaCantidadPct" DECIMAL(18,6) NOT NULL DEFAULT 0,
ADD COLUMN     "toleranciaPrecioPct" DECIMAL(18,6) NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "ConfigCuenta" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "concepto" TEXT NOT NULL,
    "cuentaContableId" UUID NOT NULL,

    CONSTRAINT "ConfigCuenta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigCuenta_empresaId_concepto_key" ON "ConfigCuenta"("empresaId", "concepto");

-- Cuentas por concepto para empresas existentes (según el plan modelo)
INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", m.concepto, c."id"
FROM (VALUES
  ('PROVEEDORES', '2.1.01.001'), ('IVA_CREDITO_FISCAL', '1.1.03.001'), ('PERCEPCION_IVA', '1.1.03.002'),
  ('PERCEPCION_IIBB', '1.1.03.003'), ('IMPUESTOS_INTERNOS', '5.2.01'), ('GASTO_POR_DEFECTO', '5.2.01')
) AS m(concepto, codigo)
JOIN "CuentaContable" c ON c."codigo" = m.codigo
ON CONFLICT DO NOTHING;

-- Permisos nuevos de compras para los roles Administrador existentes
UPDATE "Rol" SET "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['compras.config','oc.ver','oc.anular','ir.ver','ir.anular','fc.ver','fc.anular']))
WHERE "nombre" = 'Administrador';
