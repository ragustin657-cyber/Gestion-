-- CreateEnum
CREATE TYPE "ClaseConcepto" AS ENUM ('REMUNERATIVO', 'NO_REMUNERATIVO', 'DESCUENTO');

-- CreateEnum
CREATE TYPE "TipoConcepto" AS ENUM ('BASICO', 'ANTIGUEDAD', 'PORCENTAJE', 'HORAS_EXTRA', 'AUSENCIA', 'FIJO', 'DESCUENTO_LEY');

-- CreateEnum
CREATE TYPE "FormaPagoSueldo" AS ENUM ('EFECTIVO', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "TipoNovedad" AS ENUM ('HORAS_EXTRA_50', 'HORAS_EXTRA_100', 'AUSENCIA_INJUSTIFICADA', 'IMPORTE');

-- CreateEnum
CREATE TYPE "TipoLiquidacion" AS ENUM ('MENSUAL', 'SAC');

-- CreateEnum
CREATE TYPE "EstadoLiquidacion" AS ENUM ('BORRADOR', 'CERRADA');

-- CreateTable
CREATE TABLE "Convenio" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "horasMensuales" INTEGER NOT NULL DEFAULT 200,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Convenio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "convenioId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escala" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "categoriaId" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "basico" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "Escala_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Empleado" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "legajo" INTEGER NOT NULL,
    "apellido" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuil" TEXT NOT NULL,
    "domicilio" TEXT NOT NULL,
    "fechaIngreso" DATE NOT NULL,
    "fechaEgreso" DATE,
    "categoriaId" UUID NOT NULL,
    "centroCostoId" UUID,
    "sucursalId" UUID,
    "afiliadoSindicato" BOOLEAN NOT NULL DEFAULT false,
    "obraSocial" TEXT NOT NULL DEFAULT '',
    "formaPago" "FormaPagoSueldo" NOT NULL DEFAULT 'TRANSFERENCIA',
    "cbu" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Empleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concepto" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "convenioId" UUID,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "clase" "ClaseConcepto" NOT NULL,
    "tipo" "TipoConcepto" NOT NULL,
    "parametros" JSONB NOT NULL DEFAULT '{}',
    "orden" INTEGER NOT NULL,
    "soloAfiliados" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Concepto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Liquidacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipo" "TipoLiquidacion" NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "fechaPago" DATE NOT NULL,
    "estado" "EstadoLiquidacion" NOT NULL DEFAULT 'BORRADOR',
    "ultimoDepositoFecha" DATE,
    "ultimoDepositoBanco" TEXT,
    "ultimoDepositoPeriodo" TEXT,
    "creadoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoPor" TEXT,
    "cerradoEn" TIMESTAMP(3),

    CONSTRAINT "Liquidacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Novedad" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "liquidacionId" UUID NOT NULL,
    "empleadoId" UUID NOT NULL,
    "conceptoId" UUID,
    "tipo" "TipoNovedad" NOT NULL,
    "cantidad" DECIMAL(18,4),
    "importe" DECIMAL(18,2),
    "detalle" TEXT,

    CONSTRAINT "Novedad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReciboSueldo" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "liquidacionId" UUID NOT NULL,
    "empleadoId" UUID NOT NULL,
    "numero" INTEGER,
    "apellido" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuil" TEXT NOT NULL,
    "legajo" INTEGER NOT NULL,
    "categoria" TEXT NOT NULL,
    "basico" DECIMAL(18,2) NOT NULL,
    "fechaIngreso" DATE NOT NULL,
    "antiguedadAnios" INTEGER NOT NULL,
    "diasTrabajados" INTEGER NOT NULL,
    "totalRemunerativo" DECIMAL(18,2) NOT NULL,
    "totalNoRemunerativo" DECIMAL(18,2) NOT NULL,
    "totalDescuentos" DECIMAL(18,2) NOT NULL,
    "neto" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ReciboSueldo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReciboSueldoRenglon" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "reciboId" UUID NOT NULL,
    "conceptoId" UUID,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "clase" "ClaseConcepto" NOT NULL,
    "cantidad" DECIMAL(18,4),
    "base" DECIMAL(18,2),
    "porcentaje" DECIMAL(9,4),
    "importe" DECIMAL(18,2) NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "ReciboSueldoRenglon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Convenio_empresaId_codigo_key" ON "Convenio"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_empresaId_convenioId_nombre_key" ON "Categoria"("empresaId", "convenioId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Escala_categoriaId_anio_mes_key" ON "Escala"("categoriaId", "anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "Empleado_empresaId_legajo_key" ON "Empleado"("empresaId", "legajo");

-- CreateIndex
CREATE UNIQUE INDEX "Empleado_empresaId_cuil_key" ON "Empleado"("empresaId", "cuil");

-- CreateIndex
CREATE UNIQUE INDEX "Concepto_empresaId_codigo_key" ON "Concepto"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Liquidacion_empresaId_tipo_anio_mes_key" ON "Liquidacion"("empresaId", "tipo", "anio", "mes");

-- CreateIndex
CREATE INDEX "Novedad_empresaId_liquidacionId_empleadoId_idx" ON "Novedad"("empresaId", "liquidacionId", "empleadoId");

-- CreateIndex
CREATE UNIQUE INDEX "ReciboSueldo_liquidacionId_empleadoId_key" ON "ReciboSueldo"("liquidacionId", "empleadoId");

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_convenioId_fkey" FOREIGN KEY ("convenioId") REFERENCES "Convenio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escala" ADD CONSTRAINT "Escala_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Novedad" ADD CONSTRAINT "Novedad_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "Liquidacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReciboSueldo" ADD CONSTRAINT "ReciboSueldo_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "Liquidacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReciboSueldoRenglon" ADD CONSTRAINT "ReciboSueldoRenglon_reciboId_fkey" FOREIGN KEY ("reciboId") REFERENCES "ReciboSueldo"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Datos: Comercio precargado en cada empresa existente
INSERT INTO "Convenio" ("id", "empresaId", "nombre", "codigo", "horasMensuales", "activo")
SELECT gen_random_uuid(), e."id", 'Comercio (CCT 130/75)', 'CCT130-75', 200, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Convenio" x WHERE x."empresaId" = e."id" AND x."codigo" = 'CCT130-75');

INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Maestranza A', 1, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Maestranza A');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Maestranza B', 2, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Maestranza B');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Maestranza C', 3, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Maestranza C');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Administrativo A', 4, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Administrativo A');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Administrativo B', 5, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Administrativo B');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Administrativo C', 6, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Administrativo C');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Administrativo D', 7, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Administrativo D');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Administrativo E', 8, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Administrativo E');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Administrativo F', 9, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Administrativo F');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Cajero A', 10, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Cajero A');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Cajero B', 11, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Cajero B');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Cajero C', 12, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Cajero C');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Auxiliar A', 13, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Auxiliar A');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Auxiliar B', 14, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Auxiliar B');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Auxiliar C', 15, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Auxiliar C');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Auxiliar especializado A', 16, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Auxiliar especializado A');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Auxiliar especializado B', 17, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Auxiliar especializado B');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Vendedor A', 18, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Vendedor A');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Vendedor B', 19, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Vendedor B');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Vendedor C', 20, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Vendedor C');
INSERT INTO "Categoria" ("id", "empresaId", "convenioId", "nombre", "orden", "activa")
SELECT gen_random_uuid(), v."empresaId", v."id", 'Vendedor D', 21, true FROM "Convenio" v WHERE v."codigo" = 'CCT130-75'
  AND NOT EXISTS (SELECT 1 FROM "Categoria" x WHERE x."convenioId" = v."id" AND x."nombre" = 'Vendedor D');

INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '100', 'Sueldo básico', 'REMUNERATIVO', 'BASICO', '{}'::jsonb, 100, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '100');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '110', 'Antigüedad', 'REMUNERATIVO', 'ANTIGUEDAD', '{"pctPorAnio": 1}'::jsonb, 110, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '110');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '120', 'Presentismo', 'REMUNERATIVO', 'PORCENTAJE', '{"pct": 8.33, "base": "BASICO_MAS_ANTIGUEDAD", "pierdeConAusencia": true}'::jsonb, 120, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '120');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '130', 'Horas extra 50 %', 'REMUNERATIVO', 'HORAS_EXTRA', '{"recargoPct": 50}'::jsonb, 130, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '130');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '131', 'Horas extra 100 %', 'REMUNERATIVO', 'HORAS_EXTRA', '{"recargoPct": 100}'::jsonb, 131, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '131');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '140', 'Ausencias injustificadas', 'REMUNERATIVO', 'AUSENCIA', '{}'::jsonb, 140, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '140');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '500', 'Jubilación', 'DESCUENTO', 'DESCUENTO_LEY', '{"pct": 11, "base": "REMUNERATIVO"}'::jsonb, 500, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '500');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '510', 'Ley 19.032', 'DESCUENTO', 'DESCUENTO_LEY', '{"pct": 3, "base": "REMUNERATIVO"}'::jsonb, 510, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '510');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '520', 'Obra social', 'DESCUENTO', 'DESCUENTO_LEY', '{"pct": 3, "base": "REMUNERATIVO_MAS_NO_REMUNERATIVO"}'::jsonb, 520, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '520');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '530', 'FAECYS', 'DESCUENTO', 'DESCUENTO_LEY', '{"pct": 0.5, "base": "REMUNERATIVO_MAS_NO_REMUNERATIVO"}'::jsonb, 530, false, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '530');
INSERT INTO "Concepto" ("id", "empresaId", "codigo", "nombre", "clase", "tipo", "parametros", "orden", "soloAfiliados", "activo")
SELECT gen_random_uuid(), e."id", '540', 'Sindicato', 'DESCUENTO', 'DESCUENTO_LEY', '{"pct": 2, "base": "REMUNERATIVO_MAS_NO_REMUNERATIVO"}'::jsonb, 540, true, true FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "Concepto" x WHERE x."empresaId" = e."id" AND x."codigo" = '540');
