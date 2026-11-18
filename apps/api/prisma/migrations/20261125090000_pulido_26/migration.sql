-- CreateIndex
CREATE INDEX "Novedad_liquidacionComisionesId_idx" ON "Novedad"("liquidacionComisionesId");


-- Permisos de las Entregas 23 a 24 para el rol Administrador de las empresas existentes (las nuevas los traen de la precarga)
UPDATE "Rol" SET "permisos" = array_append("permisos", 'venta.maestros') WHERE "nombre" = 'Administrador' AND NOT ('venta.maestros' = ANY("permisos"));
UPDATE "Rol" SET "permisos" = array_append("permisos", 'comisiones.liquidar') WHERE "nombre" = 'Administrador' AND NOT ('comisiones.liquidar' = ANY("permisos"));
