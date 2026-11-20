-- CreateTable
CREATE TABLE "IntentoLogin" (
    "id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntentoLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntentoLogin_clave_creadoEn_idx" ON "IntentoLogin"("clave", "creadoEn");

