-- Libro de Sueldos Digital (E30): código ARCA de los conceptos y número de liquidación del Libro

ALTER TABLE "Concepto" ADD COLUMN "codigoArca" TEXT NOT NULL DEFAULT '';

-- Códigos por defecto (mismo criterio que codigoArcaPorDefecto en src/sueldos/lsd-conceptos.ts)
UPDATE "Concepto" SET "codigoArca" = CASE
  WHEN "clase" = 'DESCUENTO' AND "destino" = 'SEGURIDAD_SOCIAL' AND "codigo" = '510' THEN '810001'
  WHEN "clase" = 'DESCUENTO' AND "destino" = 'SEGURIDAD_SOCIAL' THEN '810000'
  WHEN "clase" = 'DESCUENTO' AND "destino" = 'OBRA_SOCIAL' THEN '810002'
  WHEN "clase" = 'DESCUENTO' AND "destino" = 'SINDICAL' THEN '810004'
  WHEN "clase" = 'DESCUENTO' THEN '820000'
  WHEN "clase" = 'NO_REMUNERATIVO' THEN '550000'
  WHEN "tipo" IN ('BASICO', 'AUSENCIA') THEN '110000'
  WHEN "tipo" = 'ANTIGUEDAD' THEN '160001'
  WHEN "tipo" = 'HORAS_EXTRA' AND COALESCE(("parametros"->>'recargoPct')::numeric, 0) >= 100 THEN '130002'
  WHEN "tipo" = 'HORAS_EXTRA' THEN '130001'
  WHEN "tipo" = 'VACACIONES' AND COALESCE(("parametros"->>'descuenta')::boolean, false) THEN '110000'
  WHEN "tipo" = 'VACACIONES' THEN '150000'
  WHEN "tipo" = 'PORCENTAJE' AND "codigo" = '120' THEN '170001'
  ELSE '160000'
END;

ALTER TABLE "Concepto" ALTER COLUMN "codigoArca" DROP DEFAULT;

ALTER TABLE "Liquidacion" ADD COLUMN "numeroLsd" INTEGER;
