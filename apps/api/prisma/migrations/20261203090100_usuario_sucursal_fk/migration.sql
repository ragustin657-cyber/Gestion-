-- Huérfanos (sucursal inexistente) quedan con acceso a todas las sucursales (E36)
UPDATE "UsuarioEmpresa" ue SET "sucursalId" = NULL WHERE "sucursalId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Sucursal" s WHERE s."id" = ue."sucursalId");

-- AddForeignKey
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

