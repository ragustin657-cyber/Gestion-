-- DropIndex
DROP INDEX "ChequeTercero_empresaId_banco_numero_libradorCuit_key";

-- AlterTable
ALTER TABLE "ChequeTercero" ADD COLUMN "claveAnulacion" TEXT NOT NULL DEFAULT '',
ADD COLUMN "importePesos" DECIMAL(18,2),
ADD COLUMN "sucursalId" UUID;

-- Importe en pesos al ingresar: cotización vigente a la fecha del ingreso
UPDATE "ChequeTercero" c SET "importePesos" = CASE WHEN c."monedaCodigo" = 'ARS' THEN c."importe" ELSE ROUND(c."importe" * COALESCE((
  SELECT q."valor" FROM "Cotizacion" q JOIN "IngresoValores" i ON i."id" = c."ingresoId"
  WHERE q."empresaId" = c."empresaId" AND q."monedaCodigo" = c."monedaCodigo" AND q."fecha" <= i."fecha" ORDER BY q."fecha" DESC LIMIT 1), 1), 2) END;

-- Sucursal actual: la del ingreso, luego la de la caja del depósito o del endoso, y por último la de su caja
UPDATE "ChequeTercero" c SET "sucursalId" = i."sucursalId" FROM "IngresoValores" i WHERE i."id" = c."ingresoId";
UPDATE "ChequeTercero" c SET "sucursalId" = k."sucursalId" FROM "DepositoBancarioItem" di
  JOIN "DepositoBancario" d ON d."id" = di."depositoId" JOIN "Caja" k ON k."id" = d."cajaId"
  WHERE di."chequeId" = c."id" AND d."estado" = 'CONFIRMADO';
UPDATE "ChequeTercero" c SET "sucursalId" = k."sucursalId" FROM "OrdenPagoMedio" m JOIN "Caja" k ON k."id" = m."cajaId"
  WHERE m."chequeTerceroId" = c."id" AND c."estado" IN ('ENDOSADO', 'RECHAZADO', 'DEVUELTO');
UPDATE "ChequeTercero" c SET "sucursalId" = k."sucursalId" FROM "Caja" k WHERE k."id" = c."cajaId";
UPDATE "ChequeTercero" SET "claveAnulacion" = "id"::text WHERE "estado" = 'ANULADO';

ALTER TABLE "ChequeTercero" ALTER COLUMN "importePesos" SET NOT NULL, ALTER COLUMN "sucursalId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ChequeTercero_empresaId_sucursalId_idx" ON "ChequeTercero"("empresaId", "sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "ChequeTercero_empresaId_banco_numero_libradorCuit_claveAnul_key" ON "ChequeTercero"("empresaId", "banco", "numero", "libradorCuit", "claveAnulacion");

-- Talonario de ingresos por id de sucursal (no por código, que se puede cambiar)
UPDATE "Talonario" t SET "tipoComprobante" = 'ING-' || s."id"::text FROM "Sucursal" s
  WHERE s."empresaId" = t."empresaId" AND t."tipoComprobante" = 'ING-' || s."codigo";
