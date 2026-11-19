-- Ganancias de cuarta (E32): concepto "Ajuste anual de Ganancias" y rubro exento por defecto.
-- Va aparte porque usa el valor nuevo del enum TipoConcepto.

DO $$
DECLARE
  e RECORD;
  cod TEXT;
  n INT;
BEGIN
  FOR e IN SELECT "empresaId" FROM "ConfiguracionSueldos" LOOP
    IF EXISTS (SELECT 1 FROM "Concepto" WHERE "empresaId" = e."empresaId" AND "tipo" = 'GANANCIAS_AJUSTE') THEN CONTINUE; END IF;
    cod := '561';
    n := 562;
    WHILE EXISTS (SELECT 1 FROM "Concepto" WHERE "empresaId" = e."empresaId" AND "codigo" = cod) LOOP
      cod := n::text;
      n := n + 1;
    END LOOP;
    INSERT INTO "Concepto" ("id", "empresaId", "convenioId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo", "destino", "cuentaContableId", "codigoArca", "exentoGanancias")
    VALUES (gen_random_uuid(), e."empresaId", NULL, cod, 'Ajuste anual de Ganancias', 'DESCUENTO', 'GANANCIAS_AJUSTE', '{}'::jsonb, 561, false, true, 'OTRO',
      (SELECT "id" FROM "CuentaContable" WHERE "empresaId" = e."empresaId" AND "codigo" = '2.1.02.002' LIMIT 1), '810008', false);
  END LOOP;
END $$;

-- Conceptos exentos de la E31 sin rubro: indumentaria por defecto, con aviso para revisarlos
UPDATE "Concepto" SET "rubroExentoGanancias" = 'INDUMENTARIA', "rubroExentoPorDefecto" = true
WHERE "exentoGanancias" = true AND "rubroExentoGanancias" IS NULL;
