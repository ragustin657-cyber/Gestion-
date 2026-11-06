-- CreateTable
CREATE TABLE "Sucursal" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "domicilio" TEXT,
    "esCentral" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Sucursal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sucursal_empresaId_codigo_key" ON "Sucursal"("empresaId", "codigo");

-- Casa central para cada empresa existente
INSERT INTO "Sucursal" ("id", "empresaId", "codigo", "nombre", "esCentral")
SELECT gen_random_uuid(), "id", 'CEN', 'Casa central', true FROM "Empresa";

-- Las cajas existentes pasan a la casa central
ALTER TABLE "Caja" ADD COLUMN "sucursalId" UUID;
UPDATE "Caja" c SET "sucursalId" = s."id" FROM "Sucursal" s WHERE s."empresaId" = c."empresaId" AND s."esCentral";
ALTER TABLE "Caja" ALTER COLUMN "sucursalId" SET NOT NULL;

-- AlterTable
ALTER TABLE "UsuarioEmpresa" ADD COLUMN "sucursalId" UUID;

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cuentas nuevas del plan modelo (solo en empresas que tienen la cuenta padre y no tienen el código)
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo")
SELECT gen_random_uuid(), p."empresaId", n.codigo, n.nombre, p."id", true, n.tipo::"TipoCuenta"
FROM (VALUES
  ('1.1.01.004', 'Transferencias a acreditar', '1.1.01', 'ACTIVO'),
  ('1.1.01.005', 'Valores en tránsito', '1.1.01', 'ACTIVO'),
  ('1.1.02.002', 'Cheques rechazados', '1.1.02', 'ACTIVO'),
  ('5.2.04', 'Diferencias de caja', '5.2', 'RESULTADO_NEGATIVO')
) AS n(codigo, nombre, padre, tipo)
JOIN "CuentaContable" p ON p."codigo" = n.padre
WHERE NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = n.codigo);

-- Conceptos contables de tesorería
INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", n.concepto, c."id"
FROM (VALUES
  ('VALORES_A_DEPOSITAR', '1.1.01.003'),
  ('TRANSFERENCIAS_A_ACREDITAR', '1.1.01.004'),
  ('VALORES_EN_TRANSITO', '1.1.01.005'),
  ('DEUDORES_POR_VENTAS', '1.1.02.001'),
  ('CHEQUES_RECHAZADOS', '1.1.02.002'),
  ('GASTOS_BANCARIOS', '5.2.02'),
  ('DIFERENCIAS_DE_CAJA', '5.2.04')
) AS n(concepto, codigo)
JOIN "CuentaContable" c ON c."codigo" = n.codigo
ON CONFLICT ("empresaId", "concepto") DO NOTHING;

-- Permisos nuevos para el rol Administrador
UPDATE "Rol" SET "permisos" = array(SELECT DISTINCT unnest("permisos" || ARRAY['tesoreria.ver', 'tesoreria.operar', 'tesoreria.aceptar', 'tesoreria.anular']))
WHERE "nombre" = 'Administrador';
