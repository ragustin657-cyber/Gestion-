export enum CondicionIva {
  RESPONSABLE_INSCRIPTO = 'RESPONSABLE_INSCRIPTO',
  MONOTRIBUTO = 'MONOTRIBUTO',
  EXENTO = 'EXENTO',
  CONSUMIDOR_FINAL = 'CONSUMIDOR_FINAL',
  NO_RESPONSABLE = 'NO_RESPONSABLE',
}

export const ETIQUETAS_CONDICION_IVA: Record<CondicionIva, string> = {
  [CondicionIva.RESPONSABLE_INSCRIPTO]: 'Responsable Inscripto',
  [CondicionIva.MONOTRIBUTO]: 'Monotributo',
  [CondicionIva.EXENTO]: 'Exento',
  [CondicionIva.CONSUMIDOR_FINAL]: 'Consumidor Final',
  [CondicionIva.NO_RESPONSABLE]: 'No Responsable',
};
