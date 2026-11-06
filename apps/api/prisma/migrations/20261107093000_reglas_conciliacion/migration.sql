-- CreateEnum
CREATE TYPE "SentidoRegla" AS ENUM ('DEBITO', 'CREDITO', 'AMBOS');

-- CreateTable
CREATE TABLE "ReglaConciliacion" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "prioridad" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "sentido" "SentidoRegla" NOT NULL DEFAULT 'AMBOS',
    "cuentaBancariaId" UUID,
    "cuentaContableId" UUID NOT NULL,
    "concepto" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReglaConciliacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReglaConciliacion_empresaId_prioridad_idx" ON "ReglaConciliacion"("empresaId", "prioridad");


-- Cuentas nuevas del plan modelo
INSERT INTO "CuentaContable" ("id", "empresaId", "codigo", "nombre", "padreId", "imputable", "tipo")
SELECT gen_random_uuid(), p."empresaId", n.codigo, n.nombre, p."id", true, n.tipo::"TipoCuenta"
FROM (VALUES
  ('5.2.05', 'Impuesto a los débitos y créditos bancarios', '5.2', 'RESULTADO_NEGATIVO'),
  ('4.2.02', 'Intereses ganados', '4.2', 'RESULTADO_POSITIVO')
) AS n(codigo, nombre, padre, tipo)
JOIN "CuentaContable" p ON p."codigo" = n.padre
WHERE NOT EXISTS (SELECT 1 FROM "CuentaContable" x WHERE x."empresaId" = p."empresaId" AND x."codigo" = n.codigo);

-- Reglas iniciales de conciliación
INSERT INTO "ReglaConciliacion" ("id", "empresaId", "prioridad", "texto", "sentido", "cuentaContableId")
SELECT gen_random_uuid(), c."empresaId", r.prioridad, r.texto, r.sentido::"SentidoRegla", c."id"
FROM (VALUES
  (10, 'PERCEP IVA', 'DEBITO', '1.1.03.002'),
  (20, 'PERCEP IIBB', 'DEBITO', '1.1.03.003'),
  (30, 'SIRCREB', 'DEBITO', '1.1.03.003'),
  (40, 'LEY 25413', 'AMBOS', '5.2.05'),
  (50, 'IMP DEB', 'DEBITO', '5.2.05'),
  (60, 'IMP CRED', 'AMBOS', '5.2.05'),
  (70, 'IVA', 'DEBITO', '1.1.03.001'),
  (80, 'COMISION', 'DEBITO', '5.2.02'),
  (90, 'MANTENIMIENTO', 'DEBITO', '5.2.02'),
  (100, 'INTERES', 'CREDITO', '4.2.02')
) AS r(prioridad, texto, sentido, codigo)
JOIN "CuentaContable" c ON c."codigo" = r.codigo;
