# ARBA A-122R — diseño de registro de lotes de importación (vigente desde 01/03/2026, RN 22/25)

Fuente: ARBA, "Emisión Comprobante de Retención - A122R" (https://www.arba.gov.ar/archivos/Publicaciones/a122r.pdf)
y transcripción del diseño en https://contadoresenred.com/arba-diseno-de-registro-de-lotes-de-importacion-a-122r-nombre-de-lote-y-algunos-errores/

## ALTA Retenciones (Régimen General y Regímenes Especiales) — 67 posiciones

| Campo | Formato | Largo | Dec. | Desde | Hasta | Observación |
|---|---|---|---|---|---|---|
| Nro. transacción Agente | Numérico | 20 | | 1 | 20 | 99999999999999999999 |
| CUIT contribuyente retenido | Numérico | 11 | | 21 | 31 | sin guiones |
| Sucursal | Numérico | 5 | | 32 | 36 | > 0, ceros a la izquierda |
| Fecha de operación | Fecha | 10 | | 37 | 46 | dd/mm/aaaa, del período |
| Alícuota | Numérico | 5 | 2 | 47 | 51 | 99.99, separador . o , ; > 0 |
| Base imponible | Numérico | 16 | 2 | 52 | 67 | 9999999999999.99, ceros a la izquierda; > 0 |

## BAJA Retenciones — 66 posiciones

| Campo | Formato | Largo | Desde | Hasta | Observación |
|---|---|---|---|---|---|
| CUIT contribuyente retenido | Numérico | 11 | 1 | 11 | |
| Sucursal | Numérico | 5 | 12 | 16 | |
| Fecha de operación | Fecha | 10 | 17 | 26 | dd/mm/aaaa |
| Alícuota | Numérico | 5 | 27 | 31 | 99.99 |
| Base imponible | Numérico | 16 | 32 | 47 | 9999999999999.99 |
| Número de comprobante | Numérico | 19 | 48 | 66 | año/sucursal/nro 9999/99999/99999999 |

Nota: la longitud de importes y alícuotas incluye el separador decimal.

## Nombre del lote

`ER-CUIT-PERIODO-ACTIVIDAD-LOTEXXXXX.zip` (dentro, el TXT con el diseño).
- CUIT: del agente, sin guiones.
- Período: aaaammq (año + mes + quincena; mensual: quincena 0).
- Actividad: código de actividad de retención.
- LOTEXXXXX: identificador libre del usuario.
