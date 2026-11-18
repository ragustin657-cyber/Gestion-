-- Ganancias de cuarta (E31): concepto "Impuesto a las ganancias" en las empresas con sueldos y permiso para los Administrador.
-- Va en una migración aparte porque usa el valor nuevo del enum TipoConcepto.

DO $$
DECLARE
  e RECORD;
  cod TEXT;
  n INT;
BEGIN
  FOR e IN SELECT "empresaId" FROM "ConfiguracionSueldos" LOOP
    IF EXISTS (SELECT 1 FROM "Concepto" WHERE "empresaId" = e."empresaId" AND "tipo" = 'GANANCIAS') THEN CONTINUE; END IF;
    cod := '560';
    n := 561;
    WHILE EXISTS (SELECT 1 FROM "Concepto" WHERE "empresaId" = e."empresaId" AND "codigo" = cod) LOOP
      cod := n::text;
      n := n + 1;
    END LOOP;
    INSERT INTO "Concepto" ("id", "empresaId", "convenioId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo", "destino", "cuentaContableId", "codigoArca", "exentoGanancias")
    VALUES (gen_random_uuid(), e."empresaId", NULL, cod, 'Impuesto a las ganancias', 'DESCUENTO', 'GANANCIAS', '{}'::jsonb, 560, false, true, 'OTRO',
      (SELECT "id" FROM "CuentaContable" WHERE "empresaId" = e."empresaId" AND "codigo" = '2.1.02.002' LIMIT 1), '810008', false);
  END LOOP;
END $$;

UPDATE "Rol" SET "permisos" = array_append("permisos", 'ganancias.configurar')
WHERE "nombre" = 'Administrador' AND NOT ('ganancias.configurar' = ANY("permisos"));
