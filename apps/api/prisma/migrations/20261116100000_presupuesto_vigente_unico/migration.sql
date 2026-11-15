-- Un solo presupuesto vigente por ejercicio (lo garantiza la base, no solo el servicio)
CREATE UNIQUE INDEX "Presupuesto_un_vigente" ON "Presupuesto" ("ejercicioId") WHERE "vigente";
