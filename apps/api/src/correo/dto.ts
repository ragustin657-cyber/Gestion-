import { z } from 'zod';

export const esquemaConfigCorreo = z.object({
  servidor: z.string().trim().min(1).max(200),
  puerto: z.number().int().min(1).max(65535).default(587),
  seguro: z.boolean().default(false),
  usuario: z.string().trim().min(1).max(200),
  clave: z.string().max(500).nullish(),
  remitenteNombre: z.string().trim().min(1).max(100),
  remitenteEmail: z.string().trim().email('Email inválido'),
  asunto: z.string().trim().min(1).max(200),
  cuerpo: z.string().trim().min(1).max(5000),
});
export type DatosConfigCorreo = z.infer<typeof esquemaConfigCorreo>;
export const esquemaPrueba = z.object({ destinatario: z.string().trim().email('Email inválido') });
