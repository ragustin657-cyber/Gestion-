# Entrega 2: Circuito de compras. Especificación de diseño

**Fecha:** 2026-11-05
**Estado:** aprobado en conversación, pendiente de revisión escrita
**Spec general:** `docs/superpowers/specs/2026-11-05-sistema-gestion-design.md` (§3 y §6)
**Construye sobre:** Entrega 1 (base). Usa TenantPrisma, AuditoriaService, NumeracionService, maestros y plan de cuentas.

## 0. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Aprobación de OC | Un solo nivel por monto. Bajo el monto límite de la empresa se aprueba sola; arriba requiere `oc.aprobar`. El diseño debe permitir pasar después a varios niveles sin migrar datos. |
| Asientos | Se generan desde esta entrega: motor mínimo (asiento, renglones, configuración de cuentas por concepto, balanceo, contra-asiento). Las consultas contables (diario, mayor, balances) quedan para la Entrega 5. |
| Moneda | OC y facturas en ARS o USD. Se guarda la cotización; el asiento va en pesos; la cuenta corriente guarda importe original e importe en pesos. |
| Modelo de datos | Una tabla por tipo de comprobante, con renglones vinculados a su origen. Los servicios de numeración, estados, auditoría y asientos se comparten. |

**Criterio de éxito:** en la empresa demo, un usuario crea una OC en USD, otro usuario la aprueba, se recibe en dos recepciones parciales, se factura con una diferencia de precio dentro de la tolerancia, y se ven correctos el estado de la OC, la cuenta corriente del proveedor (en USD y en ARS), el asiento balanceado y el Libro IVA Compras. Al anular la factura, todo vuelve atrás con contra-asiento.

**Fuera de alcance:** stock, aprobación multinivel, pagos (Entrega 3), consultas contables (Entrega 5), archivo de ARCA del Libro IVA (Entrega 7), validación de CAE contra ARCA.

## 1. Configuración de compras

Campos nuevos en `Empresa`:

- `montoAprobacionOc Decimal(18,2)`, por defecto 0, que significa que toda OC requiere aprobación. Es el límite en pesos.
- `toleranciaPrecioPct Decimal(18,6)`, por defecto 2.
- `toleranciaCantidadPct Decimal(18,6)`, por defecto 0.
- `modoControlTresVias`: `AVISAR` (por defecto) o `BLOQUEAR`.

Tabla nueva `ConfigCuenta { empresaId, concepto, cuentaContableId }`, única por `empresaId + concepto`. Los conceptos de esta entrega y su cuenta del plan modelo son:

| Concepto | Cuenta del plan modelo |
|---|---|
| `PROVEEDORES` | 2.1.01.001 |
| `IVA_CREDITO_FISCAL` | 1.1.03.001 |
| `PERCEPCION_IVA` | 1.1.03.002 |
| `PERCEPCION_IIBB` | 1.1.03.003 |
| `IMPUESTOS_INTERNOS` | 5.2.01 |
| `GASTO_POR_DEFECTO` | 5.2.01 |

- Se precarga al crear la empresa y en las empresas existentes (por migración de datos o seed).
- Es editable por quien tiene `plancuentas.editar`, y solo acepta cuentas imputables.

Permisos nuevos: `compras.config`, `oc.ver`, `ir.ver`, `fc.ver`, `fc.anular`, `oc.anular`. Los existentes `oc.crear`, `oc.aprobar`, `ir.crear` y `fc.crear` se mantienen.

## 2. Motor de asientos

- `Asiento { empresaId, numero (talonario "ASIENTO"), fecha, descripcion, origenTipo, origenId, anulaAId?, creadoPor }` y `AsientoRenglon { asientoId, cuentaContableId, centroCostoId?, debe Decimal(18,2), haber Decimal(18,2), detalle? }`.
- `AsientosService.generar(tx, { fecha, descripcion, origen, renglones })`:
  - Agrupa los renglones por cuenta y centro de costo.
  - Valida que todas las cuentas sean imputables y activas.
  - Valida que **debe = haber**. Si no balancea, lanza un error y la operación completa se revierte.
- `AsientosService.contraasiento(tx, asientoId, fecha)`: crea un asiento con debe y haber invertidos y `anulaAId` apuntando al original.
- Conversión a pesos: cada importe se convierte y se redondea a 2 decimales. La diferencia de redondeo se ajusta en el renglón de mayor importe del lado que corresponda.
- Toda la generación es por código: en esta entrega no hay pantalla de asientos manuales (Entrega 5).

## 3. Orden de compra

**Tablas**
- `OrdenCompra { empresaId, numero Int, puntoVenta (1), terceroId, fecha, fechaEntrega?, depositoId?, monedaCodigo, cotizacion, diasPago, observaciones?, estado, neto, iva, total, totalPesos, creadoPor, aprobadoPor?, aprobadoEn?, motivoRechazo?, motivoAnulacion?, version Int }`.
- `OrdenCompraRenglon { ordenCompraId, orden, articuloId?, descripcion, cantidad Decimal(18,4), precioUnitario Decimal(18,4), bonificacionPct, alicuotaIva, centroCostoId?, importe, cantidadRecibida, cantidadFacturada }`.

**Estados:** `BORRADOR`, `PENDIENTE_APROBACION`, `APROBADA`, `PARCIALMENTE_RECIBIDA`, `CUMPLIDA`, `ANULADA`.

**Reglas**
- **Borrador:** se edita y se borra libremente. El número se asigna recién al confirmar; mientras es borrador no tiene número.
- **Confirmar:**
  - Recalcula los totales en el servidor.
  - `totalPesos` = total × cotización (ARS: cotización 1; USD: la vigente a la fecha de la OC).
  - Si `totalPesos <= montoAprobacionOc` y el monto es mayor a 0, queda `APROBADA` con `aprobadoPor = sistema`. Si no, queda `PENDIENTE_APROBACION`.
- **Aprobar:**
  - Requiere `oc.aprobar` y estado `PENDIENTE_APROBACION`.
  - Quien la creó no puede aprobarla, salvo que sea el único usuario activo de la empresa con `oc.aprobar`. En ese caso se aprueba igual y se audita como "autoaprobación".
- **Rechazar:** requiere `oc.aprobar` y un motivo. Vuelve a `BORRADOR`.
- **Anular:** requiere `oc.anular`, un motivo y que ningún renglón tenga `cantidadRecibida > 0` ni `cantidadFacturada > 0`.
- **Cerrar:** pasa una OC aprobada o parcialmente recibida a `CUMPLIDA`, dando por cancelado el saldo pendiente. Requiere `oc.aprobar` y queda auditado.
- **Concurrencia:** cada transición verifica `version` (bloqueo optimista). Si no coincide, responde 409 "El comprobante fue modificado por otro usuario".
- La OC no genera asiento.

**Pantallas:** alta y edición con grilla de renglones y totales en vivo; lista con filtros; bandeja de pendientes de aprobación; detalle con pedido, recibido, facturado y pendiente por renglón, comprobantes vinculados e historial; PDF.

## 4. Informe de recepción

**Tablas**
- `InformeRecepcion { empresaId, numero, terceroId, fecha, depositoId?, remitoNumero, observaciones?, estado (CONFIRMADO | ANULADO), creadoPor }`, único por `empresaId + terceroId + remitoNumero` (incluye los anulados).
- `InformeRecepcionRenglon { informeRecepcionId, ordenCompraRenglonId, cantidad Decimal(18,4), cantidadFacturada }`.

**Reglas**
- Solo admite renglones de OC del mismo proveedor en estado `APROBADA` o `PARCIALMENTE_RECIBIDA`.
- `cantidad > 0` y `cantidad <= pendiente`, donde pendiente = cantidad pedida − cantidad recibida. La verificación se hace con `SELECT ... FOR UPDATE` sobre los renglones de la OC.
- Al confirmar: suma a `cantidadRecibida` y recalcula el estado de cada OC afectada (todo recibido → `CUMPLIDA`, parte → `PARCIALMENTE_RECIBIDA`).
- **Anular:** requiere que ningún renglón tenga `cantidadFacturada > 0`. Resta las cantidades y recalcula los estados.
- El formato del remito es `NNNN-NNNNNNNN` (punto de venta de 4 a 5 dígitos y número de 8). Se guarda normalizado.

## 5. Comprobante de compra (factura de proveedor)

**Tablas**
- `ComprobanteCompra`:
  - Identificación: `empresaId, numeroInterno (talonario "FC"), terceroId, tipo (FACTURA | NOTA_DEBITO | NOTA_CREDITO | TICKET), letra (A | B | C | M | null para ticket), puntoVenta Int, numero Int`.
  - Fechas y moneda: `fechaEmision, fechaContable, fechaVencimiento, monedaCodigo, cotizacion`.
  - Importes: `netoGravado, iva, percepcionIva, impuestosInternos, noGravado, exento, total, totalPesos`.
  - Estado y vínculos: `estado (CONFIRMADO | ANULADO), comprobanteAsociadoId? (NC/ND), asientoId, asientoAnulacionId?, aceptoDiferencias Bool, creadoPor, motivoAnulacion?`.
  - Unicidad: única por `empresaId + terceroId + tipo + letra + puntoVenta + numero`.
- `ComprobanteCompraRenglon { comprobanteId, origen (RECEPCION | ORDEN_COMPRA | DIRECTO), informeRecepcionRenglonId?, ordenCompraRenglonId?, articuloId?, descripcion, cantidad, precioUnitario, bonificacionPct, alicuotaIva, cuentaContableId, centroCostoId?, importe }`.
- `ComprobanteCompraIva { comprobanteId, alicuota, base, importe }`, una fila por alícuota.
- `ComprobanteCompraPercepcionIibb { comprobanteId, jurisdiccion, importe }`.

**Validación de letra.** Empresa = condición IVA de la empresa; Proveedor = condición del proveedor.

| Empresa | Proveedor | Letras válidas |
|---|---|---|
| Responsable Inscripto | Responsable Inscripto | A o M |
| Responsable Inscripto | Monotributo | C |
| Responsable Inscripto | Exento | B o C |
| Monotributo o Exento | Responsable Inscripto | B |
| Monotributo o Exento | Monotributo | C |

Ticket no lleva letra. Cualquier otra combinación da 400 "La letra X no corresponde para este proveedor".

**Cálculos**
- `importe` del renglón = cantidad × precio × (1 − bonificación / 100), redondeado a 2 decimales.
- IVA por alícuota: con letras A y M, IVA = base × alícuota / 100, redondeado por alícuota. Con B, C y Ticket no se discrimina IVA: el IVA es 0 y todo el importe va a la cuenta del renglón.
- `total` = neto + IVA + percepciones de IVA + percepciones de IIBB + impuestos internos + no gravado + exento.
- **Control de total:** el request trae `totalDeclarado`. Si `|totalDeclarado − total| > 0,05`, responde 400 "El total calculado ($X) no coincide con el total del comprobante ($Y)".
- Cotización: ARS = 1. USD = la vigente a la fecha de emisión, salvo que venga explícita en el request y sea mayor a 0.
- Vencimiento: si no viene, es la fecha de emisión + los `diasPago` del proveedor.

**Control de 3 vías**
- Aplica a los renglones con origen `RECEPCION` u `ORDEN_COMPRA`.
- **Precio:** si |precio facturado − precio OC| / precio OC × 100 supera la tolerancia de precio, es una diferencia de precio.
- **Cantidad:** se compara contra lo pendiente de facturar, que es la cantidad recibida menos la facturada (en un renglón de IR) o la cantidad pedida menos la facturada (en un renglón de OC sin recepción). Superarlo en más de la tolerancia de cantidad es una diferencia de cantidad.
- Comportamiento:
  - En modo `BLOQUEAR`, cualquier diferencia da 400 con el detalle por renglón.
  - En modo `AVISAR`, si `aceptoDiferencias` no es true, responde 422 con la lista de diferencias para que la web las muestre. Si es true, se graba y se audita con el detalle.
- Al confirmar se suma a `cantidadFacturada` del renglón de IR (si existe) y del renglón de OC.

**Al confirmar (una transacción):**
1. Valida tercero proveedor activo, letra, duplicado (409 "Este comprobante ya fue cargado"), total declarado y control de 3 vías.
2. Crea el comprobante, sus renglones, el IVA por alícuota y las percepciones.
3. Crea `MovimientoCuentaCorriente { empresaId, terceroId, origenTipo "COMPRA", origenId, fecha, fechaVencimiento, monedaCodigo, importe, importePesos, saldo, saldoPesos }`. En una nota de crédito, los importes son negativos.
4. Genera el asiento en pesos, con estas líneas (en una nota de crédito, debe y haber invertidos):

   | Debe | Haber |
   |---|---|
   | Cuenta de cada renglón (neto) | PROVEEDORES (total) |
   | IVA_CREDITO_FISCAL | |
   | PERCEPCION_IVA | |
   | PERCEPCION_IIBB | |
   | IMPUESTOS_INTERNOS | |
   | GASTO_POR_DEFECTO (no gravado y exento) | |

5. Audita.

**Anular** (requiere `fc.anular` y un motivo)
- Requiere que el movimiento de cuenta corriente no tenga aplicaciones: `saldo == importe`.
- Crea el contra-asiento con fecha de hoy.
- Deja en 0 el saldo del movimiento y lo marca anulado.
- Resta las cantidades facturadas.
- Marca el comprobante como `ANULADO`.

## 6. Consultas

- **Comprobantes de compra:** filtros de proveedor, tipo, estado y rango de fechas contables; detalle con renglones, IVA, percepciones, asiento y vínculos.
- **Cuenta corriente de un proveedor:** movimientos con saldo acumulado, en moneda original y en pesos, y totales por moneda.
- **Antigüedad de deuda:** saldo pendiente por proveedor en tramos "por vencer", 0–30, 31–60, 61–90 y +90 días vencidos, calculados a una fecha de corte (por defecto hoy).
- **Libro IVA Compras:** rango de fechas contables, una fila por comprobante (fecha, tipo, número, proveedor, CUIT, neto por alícuota, IVA por alícuota, percepciones, no gravado, exento y total en pesos), totales al pie y exportación a Excel (`.xlsx`). Las NC restan.
- **Buscador de comprobantes:** OC, IR y FC unidas por proveedor, número o rango de fechas, incluidas las anuladas, con enlace al detalle.
- **OC pendientes de recibir** y **recepciones pendientes de facturar.**

## 7. Web

- Rama del menú **Registraciones → Compras y Cuentas a Pagar**: Orden de compra, Aprobación de OC, Informe de recepción, Factura de proveedor.
- Rama del menú **Consultas → Compras y Cuentas a Pagar**: Órdenes de compra, Recepciones, Comprobantes de compra, Cuenta corriente de proveedores, Antigüedad de deuda, Libro IVA Compras, Buscador de comprobantes, Pendientes.
- **Administración → Configuración de compras:** monto límite, tolerancias, modo de control y cuentas por concepto.
- **Grilla de renglones reutilizable,** con totales en vivo calculados por la misma función de `packages/shared` que usa el servidor. Así la pantalla y el servidor dan siempre el mismo resultado.
- **PDF de la OC,** generado en el servidor (`GET /api/compras/ordenes/:id/pdf`).

## 8. Errores y concurrencia

- Mensajes en castellano y detalle por campo, igual que en la Entrega 1.
- Cada operación de estado es una sola transacción.
- Bloqueo optimista por `version` en OC y facturas.
- `FOR UPDATE` sobre los renglones de la OC y de la recepción al recibir o facturar.
- Una cotización faltante da 400 con el mensaje de la Entrega 1.

## 9. Pruebas

- **Puras (shared):** importe del renglón con bonificación; IVA por alícuota y redondeo; letras válidas por condición; conversión a pesos y ajuste de redondeo que deja el asiento balanceado.
- **Integración (API contra PostgreSQL):** todos los casos de las secciones 3 a 5, entre ellos:
  - aprobación automática y pendiente;
  - el creador no puede aprobar (salvo la excepción de único aprobador);
  - rechazo;
  - recepción parcial y total;
  - exceso de recepción bloqueado;
  - remito duplicado;
  - factura desde recepción, desde OC y directa;
  - 3 vías en modo avisar (422 y luego OK) y en modo bloquear (400);
  - duplicado 409;
  - total declarado distinto;
  - asiento balanceado en ARS y en USD;
  - una NC resta;
  - anulación con contra-asiento y liberación de cantidades;
  - aislamiento entre empresas en todos los endpoints nuevos.
- **Concurrencia:** dos recepciones simultáneas no superan lo pedido; dos aprobaciones simultáneas producen una sola aprobación.
- **E2E (Playwright):** OC → aprobar (con otro usuario) → recibir → facturar → ver el saldo en la cuenta corriente.
- **Seed demo:** OC en cada estado, recepciones, facturas en ARS y USD, y una NC.

## 10. Orden de construcción

1. Configuración de compras y `ConfigCuenta`.
2. Motor de asientos.
3. Orden de compra (API).
4. Informe de recepción (API).
5. Comprobante de compra (API).
6. Consultas (API).
7. Web: OC con PDF.
8. Web: recepción y factura.
9. Web: consultas y configuración.
10. Seed, e2e y README.
