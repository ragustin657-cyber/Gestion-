# Entrega 25: Seguimiento de deudores vencidos

## 1. Objetivo

Que el área de cobranzas sepa cada día a quién reclamar, deje registrada cada gestión y no pierda de vista las promesas de pago.

**Por qué:**
- Hoy el sistema muestra saldos y la antigüedad de la deuda, pero el seguimiento (llamados, acuerdos, promesas) se lleva afuera.
- Lo que más trabajo y plata cuesta cuando un cliente se atrasa es ese seguimiento.

**Éxito:** al entrar a *Ventas → Cobranzas* se ve una agenda con los clientes vencidos, primero los que tienen una acción para hoy o atrasada. Desde la ficha de un cliente se registra la gestión, la próxima acción y la promesa de pago. Las promesas se marcan cumplidas o incumplidas solas, según los cobros.

## 2. Objetivos, no objetivos y antiobjetivos

**Objetivos:**
- agenda de cobranzas;
- ficha de cobranza por cliente;
- registro de gestiones con próxima acción y promesa de pago;
- estado automático de las promesas.

**No objetivos (para después):**
- envío de mails o recordatorios automáticos;
- intereses por mora y notas de débito;
- cobradores asignados por cliente;
- bloqueo de ventas por deuda o límite de crédito.

**Antiobjetivos:**
- tocar recibos, ingresos de valores o aplicaciones de cobro;
- que la agenda muestre una deuda distinta de la cuenta corriente;
- marcar cumplida una promesa con un cobro anulado.

## 3. Quién lo usa

Un área de cobranzas para toda la empresa (decisión del usuario):
- hay una sola agenda con todos los clientes;
- cualquier usuario con permiso registra gestiones;
- no hay asignación por vendedor ni por cobrador.

**Permisos:**
- ver la agenda y las fichas: `venta.ver`;
- registrar y eliminar gestiones: `cobranzas.gestionar` (nuevo).

## 4. Deuda vencida

Se calcula siempre en el momento desde la cuenta corriente del cliente.

**Movimientos que cuentan:**
- clientes: orígenes `VENTA`, `RECIBO`, `COBRO` y `CHEQUE_RECHAZADO_CLIENTE`;
- no anulados;
- con saldo distinto de cero.

**Montos:**
- **Vencido:** suma de `saldoPesos` de los movimientos con saldo positivo y `fechaVencimiento` anterior a hoy.
- **Por vencer:** saldo positivo con vencimiento hoy o posterior.
- **A favor:** saldo negativo, es decir cobros o notas de crédito sin aplicar. Se muestra aparte. No se resta del vencido, pero se avisa ("tiene $ X a favor sin aplicar").
- **Días de atraso:** días entre el vencimiento más viejo con saldo positivo y hoy.

Un cliente aparece en la agenda solo si su vencido es mayor que cero.

## 5. Gestiones

**Modelo `GestionCobranza`:**

| Campo | Contenido |
|---|---|
| id, empresaId, terceroId | |
| fecha | la de la gestión, por defecto hoy; no puede ser futura |
| medio | `LLAMADO`, `MAIL`, `WHATSAPP`, `VISITA` u `OTRO` |
| nota | texto obligatorio, hasta 1000 caracteres |
| proximaAccion | fecha opcional, igual o posterior a la gestión |
| promesaFecha y promesaImporte | opcionales, van juntos; importe mayor que cero y fecha igual o posterior a la gestión |
| creadoPor y creadoEn | |

**Reglas:**
- Las gestiones no se modifican.
- Se pueden eliminar, con `cobranzas.gestionar`, solo el mismo día en que se cargaron. Después quedan como historial.
- Solo se registran gestiones de clientes, es decir terceros con `esCliente`.

## 6. Promesas de pago

**Promesa vigente:** la de la gestión más reciente que tenga promesa. Una promesa nueva reemplaza a la anterior.

**Estado, calculado en el momento:**
- **Cumplida:** la suma en pesos de los cobros del cliente (movimientos `RECIBO` o `COBRO` no anulados) con fecha igual o posterior a la fecha de la gestión alcanza el importe prometido.
- **Incumplida:** no está cumplida y la fecha prometida ya pasó, es decir es anterior a hoy.
- **Pendiente:** en otro caso.

**Las promesas reemplazadas** también muestran su estado en el historial, calculado igual. Para ellas, los cobros solo cuentan hasta la fecha de la gestión que las reemplazó.

## 7. Agenda (*Ventas → Cobranzas*)

**Columnas, por cliente:**
- cliente;
- vencido, por vencer y a favor;
- días de atraso;
- última gestión: fecha, medio y el comienzo de la nota;
- próxima acción, es decir la de la última gestión que tenga una;
- promesa vigente, con fecha, importe y estado.

**Orden:**
1. con próxima acción hoy o atrasada, de la más vieja a la más nueva;
2. con promesa incumplida;
3. el resto, por días de atraso descendente y después por vencido descendente.

**Filtros:**
- *Acciones para hoy*: próxima acción hasta hoy;
- *Promesas incumplidas*;
- *Mínimo de días de atraso*;
- búsqueda por nombre.

**Marcas:**
- la próxima acción atrasada va en rojo;
- la promesa incumplida va en rojo y la cumplida en verde.

Al hacer clic en un cliente se abre su ficha.

```
Cobranzas                     [Acciones para hoy] [Promesas incumplidas]  Mín. días [  ]
Cliente              Vencido     Días  Última gestión          Próxima   Promesa
Constructora Norte   302.500,00   45   10/11 Llamado: dijo...  17/11 !   15/11 $ 100.000 Incumplida
Supermercados Lit.    85.000,00   12   —                       —         —
```

## 8. Ficha de cobranza (*Ventas → Cobranzas → cliente*)

**Encabezado:** razón social, CUIT, teléfono, email, vencido, por vencer, a favor y días de atraso.

**Comprobantes pendientes:** tipo y número, fecha, vencimiento, días de atraso, importe y saldo en pesos. Los vencidos van primero y resaltados.

**Historial de gestiones:** de la más nueva a la más vieja, con fecha, medio, nota, próxima acción, promesa con su estado y usuario.

**Registrar gestión:**
- un formulario con medio, fecha, nota, próxima acción y la promesa (fecha e importe) opcional;
- requiere `cobranzas.gestionar`.

## 9. Enfoques considerados

- **A. Grabar solo las gestiones y calcular deuda y promesas en el momento** (elegido). No toca recibos ni cobros, y la agenda muestra siempre la deuda real de la cuenta corriente.
- **B. Actualizar el estado de la promesa en cada cobro.** Obliga a tocar todos los caminos de cobro. Descartado.
- **C. Notas sobre el informe de antigüedad.** No da agenda, ni próximas acciones, ni promesas. Descartado.

## 10. Decisiones

**Del usuario:**
- empezar por el seguimiento de deudores vencidos;
- un área de cobranzas para toda la empresa;
- el enfoque A.

**Del builder (pueden revisarse):**
- montos en pesos (`saldoPesos`), así las facturas en dólares suman al vencido con el valor registrado;
- el saldo a favor no se resta del vencido; se muestra aparte con un aviso;
- una promesa se cumple con cobros desde la fecha de su gestión, sin importar a qué comprobante se aplicaron;
- las gestiones no se editan y solo se eliminan el mismo día;
- permiso nuevo `cobranzas.gestionar`, que en la demo se le da al Tesorero (el Administrador ya tiene todos);
- la demo no trae gestiones;
- sin filtro por sucursal: los clientes son de toda la empresa.

**Del builder, según la revisión:** *(se completa con el control del builder)*

## 11. Pruebas

**API:**
- agenda: vencido, por vencer, a favor, días y orden;
- factura en dólares;
- registrar gestión y sus validaciones;
- estados de una promesa: pendiente, cumplida con un recibo, incumplida y cumplida parcialmente;
- un cobro anulado no cumple;
- promesa reemplazada;
- eliminar solo el mismo día;
- permisos.

**Web:**
- la agenda con sus marcas y filtros;
- el formulario de gestión.

**E2E:** el administrador abre la agenda, entra al cliente vencido, registra un llamado con promesa y la agenda lo muestra con la promesa pendiente.
