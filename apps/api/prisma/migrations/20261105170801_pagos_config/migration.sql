-- CreateEnum
CREATE TYPE "SinPadron" AS ENUM ('NO_RETENER', 'ALICUOTA_DEFECTO');

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "montoAprobacionOp" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Tercero" ADD COLUMN     "inscriptoGanancias" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "RegimenGanancias" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "minimoNoSujeto" DECIMAL(18,2) NOT NULL,
    "alicuotaInscripto" DECIMAL(18,6) NOT NULL,
    "alicuotaNoInscripto" DECIMAL(18,6) NOT NULL,
    "usaEscala" BOOLEAN NOT NULL DEFAULT false,
    "minimoRetencion" DECIMAL(18,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "editadoEn" TIMESTAMP(3),

    CONSTRAINT "RegimenGanancias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalaGanancias" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "desde" DECIMAL(18,2) NOT NULL,
    "hasta" DECIMAL(18,2),
    "fijo" DECIMAL(18,2) NOT NULL,
    "porcentaje" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "EscalaGanancias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JurisdiccionIibb" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "jurisdiccion" TEXT NOT NULL,
    "alicuotaDefecto" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "minimoRetencion" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "usaPadron" BOOLEAN NOT NULL DEFAULT false,
    "sinPadron" "SinPadron" NOT NULL DEFAULT 'ALICUOTA_DEFECTO',

    CONSTRAINT "JurisdiccionIibb_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegimenGanancias_empresaId_codigo_key" ON "RegimenGanancias"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdiccionIibb_empresaId_jurisdiccion_key" ON "JurisdiccionIibb"("empresaId", "jurisdiccion");

-- Conceptos contables nuevos para empresas existentes
INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", m.concepto, c."id"
FROM (VALUES
  ('RETENCION_GANANCIAS', '2.1.02.002'), ('RETENCION_IIBB', '2.1.02.004'), ('ANTICIPOS_PROVEEDORES', '1.1.04.001'),
  ('CHEQUES_DIFERIDOS', '2.1.01.002'), ('DIFERENCIA_CAMBIO_POSITIVA', '4.2.01'), ('DIFERENCIA_CAMBIO_NEGATIVA', '5.2.03')
) AS m(concepto, codigo)
JOIN "CuentaContable" c ON c."codigo" = m.codigo
ON CONFLICT DO NOTHING;

-- Permisos nuevos para los roles Administrador existentes
UPDATE "Rol" SET "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['op.ver','op.anular','retenciones.config','padron.cargar']))
WHERE "nombre" = 'Administrador';

-- Regímenes, escala y jurisdicciones para empresas existentes (valores a verificar)
INSERT INTO "RegimenGanancias" ("id","empresaId","codigo","descripcion","minimoNoSujeto","alicuotaInscripto","alicuotaNoInscripto","usaEscala","minimoRetencion")
SELECT gen_random_uuid(), e."id", r.codigo, r.descripcion, r.minimo, r.ins, r.noins, r.escala, 240
FROM "Empresa" e CROSS JOIN (VALUES
  ('78','Enajenación de bienes de cambio',224000,2,10,false), ('94','Locaciones de obra y servicios',67170,2,28,false),
  ('110','Alquileres de inmuebles urbanos',11200,6,28,false), ('116','Honorarios profesionales',67170,0,28,true)
) AS r(codigo, descripcion, minimo, ins, noins, escala)
ON CONFLICT DO NOTHING;

INSERT INTO "EscalaGanancias" ("id","empresaId","desde","hasta","fijo","porcentaje")
SELECT gen_random_uuid(), e."id", t.desde, t.hasta, t.fijo, t.pct
FROM "Empresa" e CROSS JOIN (VALUES
  (0,8000,0,5),(8000,16000,400,9),(16000,24000,1120,12),(24000,32000,2080,15),(32000,48000,3280,19),(48000,64000,6320,23),(64000,96000,10000,27),(96000,NULL,18640,31)
) AS t(desde, hasta, fijo, pct);

INSERT INTO "JurisdiccionIibb" ("id","empresaId","jurisdiccion","usaPadron","sinPadron")
SELECT gen_random_uuid(), e."id", j::text, j IN (901, 902), CASE WHEN j IN (901, 902) THEN 'NO_RETENER'::"SinPadron" ELSE 'ALICUOTA_DEFECTO'::"SinPadron" END
FROM "Empresa" e CROSS JOIN generate_series(901, 924) AS j
ON CONFLICT DO NOTHING;
