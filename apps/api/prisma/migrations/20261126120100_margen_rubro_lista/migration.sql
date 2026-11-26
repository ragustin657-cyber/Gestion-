-- CreateTable
CREATE TABLE "MargenRubroLista" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "listaId" UUID NOT NULL,
    "rubroId" UUID NOT NULL,
    "margenPct" DECIMAL(9,2) NOT NULL,

    CONSTRAINT "MargenRubroLista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MargenRubroLista_empresaId_listaId_rubroId_key" ON "MargenRubroLista"("empresaId", "listaId", "rubroId");

