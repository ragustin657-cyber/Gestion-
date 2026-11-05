import { PrismaClient } from '@prisma/client';
import { DEMO, sembrarDemo } from '../src/seed/demo';

async function main() {
  const prisma = new PrismaClient();
  try {
    const r = await sembrarDemo(prisma);
    console.log(r === 'creada'
      ? `Empresa demo creada. Ingresá con ${DEMO.email} / ${DEMO.password}`
      : 'La empresa demo ya existía; no se modificó nada.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
