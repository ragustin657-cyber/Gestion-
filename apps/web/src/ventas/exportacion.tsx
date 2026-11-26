import { IDIOMAS_FEX, INCOTERMS, PAISES_FEX, TIPOS_EXPORTACION } from '@gestion/shared';
import { ActionIcon, Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import type { RenglonVentaEditable } from './GrillaVenta';

/** E58: datos de la factura de exportación (letra E). */
export interface DatosExportacion {
  tipoExportacion: 'BIENES' | 'SERVICIOS' | 'OTROS';
  paisDestino: number | null;
  incoterm: string | null;
  incotermDescripcion: string;
  formaPago: string;
  idioma: 1 | 2 | 3;
  permisoExistente: 'S' | 'N' | null;
  permisos: { numero: string; paisDestino: number | null }[];
}
export const exportacionVacia = (): DatosExportacion => ({ tipoExportacion: 'SERVICIOS', paisDestino: null, incoterm: null, incotermDescripcion: '', formaPago: '', idioma: 1, permisoExistente: null, permisos: [] });

const PAISES = Object.entries(PAISES_FEX).map(([value, label]) => ({ value, label: `${label} (${value})` })).sort((a, b) => a.label.localeCompare(b.label, 'es'));

/** Cuerpo para la API: incoterm y permisos solo en bienes (permisos solo con permiso existente). */
export function cuerpoExportacion(v: DatosExportacion) {
  const bienes = v.tipoExportacion === 'BIENES';
  return {
    tipoExportacion: v.tipoExportacion, paisDestino: v.paisDestino, formaPago: v.formaPago || null, idioma: v.idioma,
    incoterm: bienes ? v.incoterm : null, incotermDescripcion: bienes ? v.incotermDescripcion || null : null,
    permisoExistente: bienes ? v.permisoExistente : null,
    permisos: bienes && v.permisoExistente === 'S' ? v.permisos.filter((p) => p.numero.trim()).map((p) => ({ numero: p.numero.trim(), paisDestino: p.paisDestino ?? v.paisDestino })) : [],
  };
}

/** La exportación no lleva IVA: los renglones pasan a exento. */
export const exentoParaExportacion = (rs: RenglonVentaEditable[]): RenglonVentaEditable[] => rs.map((r) => (r.alicuota === 'EXENTO' ? r : { ...r, alicuota: 'EXENTO' }));

export function SeccionExportacion({ valor, onChange, disabled }: { valor: DatosExportacion; onChange: (v: DatosExportacion) => void; disabled?: boolean }) {
  const c = (x: Partial<DatosExportacion>) => onChange({ ...valor, ...x });
  const bienes = valor.tipoExportacion === 'BIENES';
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>Exportación (sin IVA)</Text>
      <Group align="flex-end">
        <Select label="Tipo de exportación" w={200} allowDeselect={false} data={Object.entries(TIPOS_EXPORTACION).map(([value, label]) => ({ value, label }))} value={valor.tipoExportacion} onChange={(v) => c({ tipoExportacion: (v ?? 'SERVICIOS') as DatosExportacion['tipoExportacion'] })} disabled={disabled} />
        <Select label="País de destino" w={240} searchable data={PAISES} value={valor.paisDestino ? String(valor.paisDestino) : null} onChange={(v) => c({ paisDestino: v ? Number(v) : null })} disabled={disabled} />
        <TextInput label="Forma de pago" w={200} value={valor.formaPago} onChange={(e) => c({ formaPago: e.currentTarget.value })} disabled={disabled} />
        <Select label="Idioma" w={130} allowDeselect={false} data={Object.entries(IDIOMAS_FEX).map(([value, label]) => ({ value, label }))} value={String(valor.idioma)} onChange={(v) => c({ idioma: Number(v ?? 1) as 1 | 2 | 3 })} disabled={disabled} />
      </Group>
      {bienes && (
        <Group align="flex-end">
          <Select label="Incoterm" w={120} data={[...INCOTERMS]} value={valor.incoterm} onChange={(v) => c({ incoterm: v })} disabled={disabled} />
          <TextInput label="Lugar del incoterm" w={220} value={valor.incotermDescripcion} onChange={(e) => c({ incotermDescripcion: e.currentTarget.value })} disabled={disabled} />
          <Select label="Permiso de embarque" w={180} data={[{ value: 'S', label: 'Sí' }, { value: 'N', label: 'No' }]} value={valor.permisoExistente} onChange={(v) => c({ permisoExistente: v as 'S' | 'N' | null })} disabled={disabled} />
        </Group>
      )}
      {bienes && valor.permisoExistente === 'S' && (
        <Stack gap={4}>
          {valor.permisos.map((p, i) => (
            <Group key={i} align="flex-end">
              <TextInput size="xs" w={220} aria-label={`Permiso ${i + 1}`} placeholder="16 caracteres" value={p.numero} onChange={(e) => c({ permisos: valor.permisos.map((x, j) => (j === i ? { ...x, numero: e.currentTarget.value.toUpperCase() } : x)) })} disabled={disabled} />
              <Select size="xs" w={220} aria-label={`País del permiso ${i + 1}`} searchable data={PAISES} value={p.paisDestino ? String(p.paisDestino) : null} onChange={(v) => c({ permisos: valor.permisos.map((x, j) => (j === i ? { ...x, paisDestino: v ? Number(v) : null } : x)) })} disabled={disabled} />
              <ActionIcon variant="subtle" color="red" aria-label={`Quitar permiso ${i + 1}`} onClick={() => c({ permisos: valor.permisos.filter((_, j) => j !== i) })} disabled={disabled}><IconTrash size={14} /></ActionIcon>
            </Group>
          ))}
          <Group><Button size="xs" variant="light" onClick={() => c({ permisos: [...valor.permisos, { numero: '', paisDestino: valor.paisDestino }] })} disabled={disabled}>Agregar permiso</Button></Group>
        </Stack>
      )}
    </Stack>
  );
}
