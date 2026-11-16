-- AlterTable
ALTER TABLE "Liquidacion" ADD COLUMN     "baseMaximaAportes" DECIMAL(18,2),
ADD COLUMN     "detraccion" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "ReciboSueldo" ADD COLUMN     "formaPago" "FormaPagoSueldo";

-- Copia de la forma de pago en los recibos existentes
UPDATE "ReciboSueldo" r SET "formaPago" = e."formaPago" FROM "Empleado" e WHERE e."id" = r."empleadoId" AND r."formaPago" IS NULL;

-- Presentismo, FAECYS y sindicato de Comercio quedan asociados a su convenio (no se aplican a otros convenios)
UPDATE "Concepto" k SET "convenioId" = v."id" FROM "Convenio" v
WHERE v."empresaId" = k."empresaId" AND v."codigo" = 'CCT130-75' AND k."codigo" IN ('120', '530', '540') AND k."convenioId" IS NULL;
