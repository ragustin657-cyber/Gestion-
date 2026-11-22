-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "acrecentamiento" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aplicaCdi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "domicilioExterior" TEXT,
ADD COLUMN     "nacimientoFecha" DATE,
ADD COLUMN     "nacimientoPais" INTEGER,
ADD COLUMN     "nif" TEXT,
ADD COLUMN     "paisSire" INTEGER,
ADD COLUMN     "regimenExteriorId" UUID,
ADD COLUMN     "residenteExterior" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipoPersona" TEXT;

-- CreateTable
CREATE TABLE "RegimenExterior" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigoSire" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "alicuotaSinCdi" DECIMAL(9,4) NOT NULL,
    "codigoAlicuotaSinCdi" INTEGER NOT NULL,
    "alicuotaConCdi" DECIMAL(9,4),
    "codigoAlicuotaConCdi" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RegimenExterior_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegimenExterior_empresaId_descripcion_key" ON "RegimenExterior"("empresaId", "descripcion");


-- Cuenta del impuesto asumido por acrecentamiento (E43) en cada empresa con la cuenta madre, y su cuenta por concepto.
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo", "activa", "monetaria")
SELECT gen_random_uuid(), p."empresaId", '5.2.15', 'Impuesto a las ganancias asumido (exterior)', p."id", true, 'RESULTADO_NEGATIVO'::"TipoCuenta", true, false
FROM "CuentaContable" p
WHERE p."codigo" = '5.2' AND p."imputable" = false
  AND NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = '5.2.15');

INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'GANANCIAS_ASUMIDO', c."id" FROM "CuentaContable" c WHERE c."codigo" = '5.2.15'
ON CONFLICT ("empresaId", "concepto") DO NOTHING;
