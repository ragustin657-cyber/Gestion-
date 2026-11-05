import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z, ZodError, ZodIssue, ZodTypeAny } from 'zod';

function mensaje(i: ZodIssue): string {
  if (i.message && i.message !== 'Required' && !i.message.startsWith('Expected') && !i.message.startsWith('Invalid') && !i.message.startsWith('String must') && !i.message.startsWith('Number must'))
    return i.message;
  switch (i.code) {
    case 'invalid_type':
      return i.received === 'undefined' || i.received === 'null' ? 'Campo obligatorio' : 'Valor inválido';
    case 'too_small':
      return i.type === 'string' && i.minimum === 1 ? 'Campo obligatorio' : `Debe ser como mínimo ${i.minimum}`;
    case 'too_big':
      return `Debe ser como máximo ${i.maximum}`;
    case 'invalid_string':
      return i.validation === 'email' ? 'Email inválido' : 'Formato inválido';
    case 'invalid_enum_value':
      return 'Opción inválida';
    default:
      return 'Valor inválido';
  }
}

export function erroresDeZod(e: ZodError): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join('.') || '_';
    if (!campos[k]) campos[k] = mensaje(i);
  }
  return campos;
}

/** Valida el body con un esquema zod; responde 400 { message, campos } en castellano. */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly esquema: T) {}
  transform(valor: unknown): z.infer<T> {
    const r = this.esquema.safeParse(valor ?? {});
    if (r.success) return r.data;
    const campos = erroresDeZod(r.error);
    throw new BadRequestException({ statusCode: 400, message: Object.values(campos)[0], campos });
  }
}
