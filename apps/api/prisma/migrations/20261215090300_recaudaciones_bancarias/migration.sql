-- CreateTable
CREATE TABLE "RecaudacionBancaria" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "periodo" TEXT NOT NULL,
    "jurisdiccion" TEXT NOT NULL,
    "cuentaBancariaId" UUID,
    "cbu" TEXT,
    "importe" DECIMAL(18,2) NOT NULL,
    "referencia" TEXT,

    CONSTRAINT "RecaudacionBancaria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecaudacionBancaria_empresaId_periodo_idx" ON "RecaudacionBancaria"("empresaId", "periodo");


-- E48: concepto de las recaudaciones bancarias de IIBB en la cuenta de percepciones IIBB sufridas (1.1.03.003) de cada empresa
INSERT INTO "ConfigCuenta" ("id", "empresaId", "concepto", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", 'RECAUDACION_BANCARIA_IIBB', c."id" FROM "CuentaContable" c
WHERE c."codigo" = '1.1.03.003'
  AND NOT EXISTS (SELECT 1 FROM "ConfigCuenta" x WHERE x."empresaId" = c."empresaId" AND x."concepto" = 'RECAUDACION_BANCARIA_IIBB');
