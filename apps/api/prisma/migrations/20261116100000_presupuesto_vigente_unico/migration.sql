-- Si una carrera anterior dejó dos vigentes en un ejercicio, queda vigente el modificado más recientemente
UPDATE "Presupuesto" p SET "vigente" = false
WHERE p."vigente" AND EXISTS (
  SELECT 1 FROM "Presupuesto" q
  WHERE q."ejercicioId" = p."ejercicioId" AND q."vigente" AND q."id" <> p."id"
    AND (q."actualizadoEn" > p."actualizadoEn" OR (q."actualizadoEn" = p."actualizadoEn" AND q."id" > p."id"))
);

-- Un solo presupuesto vigente por ejercicio (lo garantiza la base, no solo el servicio)
CREATE UNIQUE INDEX "Presupuesto_un_vigente" ON "Presupuesto" ("ejercicioId") WHERE "vigente";
