-- Asientos con fecha posterior al último ejercicio creado: se crean los ejercicios que faltan y se les asignan
DO $$
DECLARE
  e RECORD;
  ultimo RECORD;
  d DATE;
  ej UUID;
BEGIN
  FOR e IN SELECT a."empresaId" AS id, MAX(a."fecha") AS hasta FROM "Asiento" a WHERE a."ejercicioId" IS NULL GROUP BY a."empresaId" LOOP
    SELECT "numero", "hasta" INTO ultimo FROM "Ejercicio" WHERE "empresaId" = e.id ORDER BY "numero" DESC LIMIT 1;
    CONTINUE WHEN NOT FOUND;
    d := (ultimo."hasta" + 1)::DATE;
    WHILE d <= e.hasta LOOP
      ultimo."numero" := ultimo."numero" + 1;
      ej := gen_random_uuid();
      INSERT INTO "Ejercicio" ("id", "empresaId", "numero", "desde", "hasta") VALUES (ej, e.id, ultimo."numero", d, (d + INTERVAL '12 months' - INTERVAL '1 day')::DATE);
      INSERT INTO "PeriodoContable" ("id", "empresaId", "ejercicioId", "anio", "mes", "desde", "hasta")
      SELECT gen_random_uuid(), e.id, ej, EXTRACT(YEAR FROM x)::INT, EXTRACT(MONTH FROM x)::INT, x::DATE, (x + INTERVAL '1 month' - INTERVAL '1 day')::DATE
      FROM generate_series(d, d + INTERVAL '11 months', INTERVAL '1 month') AS x;
      d := (d + INTERVAL '12 months')::DATE;
    END LOOP;
  END LOOP;
END $$;

UPDATE "Asiento" a SET "ejercicioId" = j."id" FROM "Ejercicio" j
WHERE a."ejercicioId" IS NULL AND j."empresaId" = a."empresaId" AND a."fecha" BETWEEN j."desde" AND j."hasta";
