# Sistema de Gestión — Especificación de diseño (Etapa 1)

**Fecha:** 2026-11-05
**Estado:** Aprobado en conversación, pendiente de revisión escrita

## 0. Contexto y objetivos

**Lo que pidió el usuario:**
- Sistema de gestión (ERP) para **medianas empresas**, escalable a **grandes empresas**.
- Modelo funcional: menú tipo árbol con Registraciones y Consultas, y módulos de Compras/Cuentas a Pagar, Ventas/Cuentas a Cobrar, Tesorería, Contabilidad General, Control Presupuestario, Informes Gerenciales y Administración del Sistema.
- Funciones explícitas: revisar comprobantes cargados e históricos, órdenes de compra, facturar, cargar facturas de proveedores, pagar desde el sistema, órdenes de pago, reportes, informes de recepción, recepción de valores y aceptación de transferencias.
- Modelo de negocio: **SaaS multi-empresa** primero; luego **instalación local** en cada cliente.
- País: **Argentina** (IVA, percepciones, retenciones, ARCA).
- Equipo: lo construye Claude ahora; se sumarán programadores contratados más adelante.
- Prioridad de la primera versión: **circuito completo de compras y pagos**.

**Supuestos (a confirmar):**
- La primera versión opera en ARS y USD; no hay otras monedas.
- Control de stock fuera de alcance en la Etapa 1.
- La interfaz es web (navegador), en castellano.

**Criterio de éxito de la Etapa 1:** una empresa demo puede completar en el navegador OC → Informe de Recepción → Factura de proveedor → Orden de Pago → Pago (transferencia/cheque), y ver correctamente la cuenta corriente del proveedor, las retenciones con certificado, los movimientos de tesorería y los asientos contables, además de emitir una factura de venta electrónica en homologación de ARCA y cobrarla.

## 1. Arquitectura general

**Enfoque:** monolito modular (descartados: microservicios por complejidad operativa; ERP abierto existente por dependencia tecnológica y de licencia).

**Stack:** TypeScript de punta a punta.
- Backend: Node.js + NestJS.
- Frontend: React.
- Base de datos: PostgreSQL.
- Despliegue: Docker / docker-compose (mismo artefacto para nube e instalación local).

**Estructura del repositorio:**
```
apps/api        backend NestJS
apps/web        frontend React
packages/shared tipos y validaciones compartidas (CUIT, cálculos de impuestos)
docker-compose.yml
```

**Módulos del backend** (cada uno con sus tablas, servicios y API; comunicación entre módulos solo por interfaces públicas y eventos de dominio, controlado con reglas de lint de dependencias):
`core` (empresas, usuarios, permisos, auditoría), `maestros`, `compras`, `pagos`, `tesoreria`, `contabilidad`, `ventas`, `impuestos`.

**Multi-empresa:**
- Toda tabla de negocio lleva `empresa_id`; el filtro se aplica automáticamente según la empresa activa del usuario.
- Un usuario puede tener acceso a varias empresas y elegir la activa.
- Instalación local = misma aplicación con una sola empresa.

**Usuarios y permisos:** roles configurables con permisos por acción (ej. `oc.crear`, `oc.aprobar`, `op.aprobar`, `pago.ejecutar`).

**Auditoría:** cada comprobante registra creación, modificación, aprobación y anulación, con usuario y fecha y hora.

## 2. Base común (maestros)

- **Empresa:** razón social, CUIT, condición IVA, domicilio, puntos de venta, ejercicio contable, agente de retención (Ganancias/IVA/SUSS/IIBB por jurisdicción).
- **Proveedores / Clientes:** CUIT validado (dígito verificador), condición IVA, condición de pago, datos de padrón para retenciones/percepciones (régimen Ganancias, alícuota IIBB por jurisdicción, exenciones con vigencia).
- **Artículos / Servicios:** código, descripción, unidad, alícuota IVA, cuenta contable de compra y de venta.
- **Plan de cuentas:** jerárquico, imputable / no imputable; modelo argentino estándar precargado.
- **Monedas y cotizaciones:** ARS, USD; cotización por fecha.
- **Bancos, cuentas bancarias, chequeras (físicas y e-cheq), cajas, centros de costo, depósitos/lugares de entrega.**

**Reglas transversales de comprobantes:**
- Numeración automática por tipo y punto de venta.
- Estados base: Borrador → Confirmado → (Aprobado) → Anulado.
- Lo confirmado no se edita ni se borra; se anula (con contra-asiento) y queda en el histórico.
- Todo comprobante confirmado genera asiento automático (ver §6).
- Trazabilidad: cada comprobante conoce sus vínculos de origen y destino (OC ↔ IR ↔ Factura ↔ OP ↔ Pago).

**Interfaz:** menú en árbol con ramas **Registraciones** (carga) y **Consultas** (comprobantes, histórico, reportes), por módulo.

## 3. Circuito de compras

### 3.1 Orden de compra (OC)
- Cabecera: proveedor, fecha, moneda, condición de pago, fecha de entrega, lugar de entrega.
- Renglones: artículo, cantidad, precio unitario, bonificación %, alícuota IVA, centro de costo.
- Estados: Borrador → Pendiente de aprobación → Aprobada → Parcialmente recibida → Cumplida | Anulada.
- Aprobación por niveles de monto configurables; por debajo del umbral se aprueba automáticamente.
- Impresión / PDF.

### 3.2 Informe de recepción (IR)
- Se genera desde una o varias OC aprobadas del mismo proveedor.
- Cantidad recibida por renglón; recepciones parciales.
- OC muestra pedido / recibido / pendiente por renglón.
- Registra número de remito del proveedor.
- Stock: fuera de alcance (estructura preparada).

### 3.3 Factura de proveedor
- Tipos: Factura A/B/C, Nota de Crédito, Nota de Débito, Ticket.
- Validación de formato de numeración (punto de venta - número) y de duplicados (proveedor + tipo + número).
- Modos de carga: vinculada a IR (control de 3 vías con tolerancia configurable de precio y cantidad: advertir o bloquear), vinculada a OC (servicios), o sin vínculo (gasto directo imputado a cuenta contable).
- Impuestos: IVA por alícuota (0, 2,5, 5, 10,5, 21, 27 %), percepciones IVA, percepciones IIBB por jurisdicción, impuestos internos, conceptos no gravados y exentos.
- Vencimiento calculado según condición de pago (editable).
- Al confirmar: movimiento en cuenta corriente del proveedor, asiento contable y registro en Libro IVA Compras.
- Futuro: validación de CAE contra ARCA.

### 3.4 Consultas de compras
- OC pendientes de recibir; IR pendientes de facturar; facturas pendientes de pago.
- Cuenta corriente y saldo por proveedor; antigüedad de deuda.
- Libro IVA Compras (exportable formato ARCA).
- Buscador de comprobantes (incluye anulados e histórico) con trazabilidad completa.

## 4. Órdenes de pago y pagos

### 4.1 Orden de pago (OP)
- Selección de proveedor y de sus comprobantes pendientes (FC, ND, NC) con imputación total o parcial; anticipos a cuenta de OC.
- Cálculo automático de retenciones:
  - Ganancias según RG 830 (régimen por concepto, mínimo no sujeto, acumulado mensual por proveedor).
  - IVA y SUSS cuando corresponda.
  - IIBB por jurisdicción según padrón.
  - Emisión de certificado de retención numerado (PDF).
- Estados: Borrador → Pendiente de aprobación → Aprobada → Pagada | Anulada.
- Aprobación por monto, igual que la OC. Separación entre quien aprueba y quien ejecuta.

### 4.2 Pago
- Medios combinables en una OP: transferencia bancaria, cheque propio (físico o e-cheq, con chequera, número y fecha de pago), endoso de cheques de terceros en cartera, efectivo desde caja.
- Al confirmar: cancela deuda en cuenta corriente, registra retenciones a depositar, mueve tesorería, genera asiento.
- Impresión de OP con detalle de medios de pago y certificados.

## 5. Tesorería

- **Recepción de valores:** ingreso de cheques de terceros (físicos/e-cheq) y transferencias recibidas en estado *pendiente de aceptación*; al verificarse se **aceptan** y quedan disponibles.
- **Cartera de cheques de terceros:** En cartera → Depositado → Acreditado | Rechazado; o Endosado/Entregado. Historial de estados por cheque.
- **Cheques propios:** Emitido → Debitado | Anulado.
- **Depósitos bancarios** de cheques y efectivo (boleta de depósito).
- **Movimientos bancarios:** débitos, créditos, gastos bancarios; transferencias entre cuentas propias.
- **Cajas:** apertura, movimientos, arqueo.
- **Cheques rechazados:** reversión y reimputación en la cuenta corriente del cliente o proveedor de origen.
- **Conciliación bancaria:** importación de extracto (CSV/Excel), conciliación automática por importe/fecha/referencia y manual.
- **Consultas:** OP pendientes de aprobar/pagar; proyección de pagos; cheques emitidos pendientes de débito; cartera por estado y fecha; saldos de bancos y cajas; flujo de fondos proyectado; retenciones practicadas por período con exportación SICORE / SIRE / ARBA.

## 6. Contabilidad automática

- Configuración de cuentas por tipo de comprobante y concepto (editable por el contador).
- Cada comprobante confirmado genera su asiento; la anulación genera contra-asiento.
- Invariante: todo asiento balancea (debe = haber); si no balancea, la confirmación falla.
- Asientos manuales.
- Consultas: Libro Diario, Mayor por cuenta, Balance de sumas y saldos; navegación asiento → comprobante de origen.
- Cierre de períodos mensuales: no se admiten comprobantes con fecha en un período cerrado.
- Fuera de alcance Etapa 1: balance general, estado de resultados, presupuesto, informes gerenciales.

## 7. Ventas (versión básica)

- Determinación automática del tipo de comprobante (A/B/C) según condición IVA de la empresa y del cliente.
- Factura, Nota de Crédito, Nota de Débito con IVA por alícuota.
- Factura electrónica ARCA (WSAA + WSFE): solicitud de CAE al confirmar, PDF con código QR. Desarrollo y pruebas en homologación; producción requiere certificado digital propio de cada empresa.
- Recibos y cobranzas con imputación a comprobantes pendientes; medios: transferencia, cheque, efectivo (ingresan por recepción de valores de Tesorería).
- Cuenta corriente de clientes; Libro IVA Ventas.
- Fuera de alcance Etapa 1: remitos, listas de precios, pedidos de venta, gestión de cobranzas.

## 8. Manejo de errores

- Validaciones de negocio en el backend (fuente de verdad) y repetidas en el frontend para dar feedback inmediato (compartidas vía `packages/shared`).
- Operaciones que afectan varios módulos (confirmar factura, pagar OP) se ejecutan en una única transacción de base de datos: o se registra todo (comprobante + cuenta corriente + tesorería + asiento) o nada.
- Errores de negocio con mensajes claros en castellano (ej. "La factura 0001-00001234 de este proveedor ya fue cargada").
- Integración ARCA: si ARCA no responde, el comprobante queda en estado *pendiente de CAE* y se puede reintentar; nunca se numera localmente un comprobante sin CAE.

## 9. Pruebas

- **Unitarias:** cálculo de IVA, percepciones y retenciones (casos RG 830 con acumulados y mínimos), validación de CUIT, determinación de tipo de comprobante.
- **Integración (contra PostgreSQL real):** saldos de cuenta corriente, asientos balanceados, aislamiento entre empresas, transiciones de estado y anulaciones, control de 3 vías.
- **Punta a punta (navegador):** OC → IR → Factura → OP → Pago, verificando cuenta corriente, tesorería y asiento.
- **Datos de demo:** empresa ejemplo con maestros y comprobantes, para demostraciones comerciales.

## 10. Orden de construcción (entregas)

1. **Base:** estructura del proyecto, login, empresas, usuarios y roles, maestros, plan de cuentas.
2. **Compras:** OC → IR → Factura de proveedor + consultas.
3. **Pagos:** OP, retenciones, medios de pago, certificados.
4. **Tesorería:** valores, cheques, depósitos, bancos, cajas.
5. **Contabilidad:** asientos automáticos, consultas, cierre de períodos.
6. **Ventas básicas:** facturación electrónica en homologación, recibos, cuenta corriente de clientes.
7. **Conciliación bancaria y exportaciones impositivas** (SICORE, SIRE, ARBA, Libros IVA).

Cada entrega se planifica en detalle y queda funcionando y probada antes de pasar a la siguiente.

## 11. Fuera de alcance de la Etapa 1

Control de stock, ventas completas (remitos, listas de precios, pedidos), presupuesto, informes gerenciales, balance general y estado de resultados, gestión de cobranzas, multi-moneda más allá de ARS/USD, app móvil.
