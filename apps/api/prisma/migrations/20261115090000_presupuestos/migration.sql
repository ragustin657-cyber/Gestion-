-- CreateTable
CREATE TABLE "Presupuesto" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "ejercicioId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "vigente" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Presupuesto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresupuestoImporte" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "presupuestoId" UUID NOT NULL,
    "cuentaContableId" UUID NOT NULL,
    "centroCostoId" UUID,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "importe" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PresupuestoImporte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Presupuesto_empresaId_ejercicioId_nombre_key" ON "Presupuesto"("empresaId", "ejercicioId", "nombre");

-- CreateIndex
CREATE INDEX "PresupuestoImporte_empresaId_presupuestoId_idx" ON "PresupuestoImporte"("empresaId", "presupuestoId");

-- AddForeignKey
ALTER TABLE "PresupuestoImporte" ADD CONSTRAINT "PresupuestoImporte_presupuestoId_fkey" FOREIGN KEY ("presupuestoId") REFERENCES "Presupuesto"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Una sola fila por línea (cuenta + centro, sin centro incluido) y mes
CREATE UNIQUE INDEX "PresupuestoImporte_linea_mes" ON "PresupuestoImporte" ("presupuestoId", "cuentaContableId", COALESCE("centroCostoId", '00000000-0000-0000-0000-000000000000'::uuid), "anio", "mes");
