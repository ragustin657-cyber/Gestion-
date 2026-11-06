-- DropIndex
DROP INDEX "ComprobanteVenta_empresaId_puntoVenta_tipo_letra_numero_key";

-- AlterTable
ALTER TABLE "ComprobanteVenta" ADD COLUMN     "ambiente" "AmbienteArca" NOT NULL DEFAULT 'SIMULADO';

-- CreateIndex
CREATE UNIQUE INDEX "ComprobanteVenta_empresaId_ambiente_puntoVenta_tipo_letra_n_key" ON "ComprobanteVenta"("empresaId", "ambiente", "puntoVenta", "tipo", "letra", "numero");


-- El movimiento del cliente por un cheque rechazado es del lado de Ventas (el del proveedor endosatario sigue siendo CHEQUE_RECHAZADO)
UPDATE "MovimientoCuentaCorriente" m SET "origenTipo" = 'CHEQUE_RECHAZADO_CLIENTE'
FROM "ChequeTercero" c
WHERE m."origenTipo" = 'CHEQUE_RECHAZADO' AND m."origenId" = c."id" AND m."terceroId" = c."terceroOrigenId";
