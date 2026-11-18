# Entrega 28: Recordatorios por mail con el resumen de cuenta

## 1. Objetivo

Que el área de cobranzas pueda mandarle a un cliente, o a varios a la vez, un mail con su resumen de cuenta adjunto. Cada envío queda registrado como gestión de cobranza.

**Por qué:** completa el circuito de cobranzas de las Entregas 25 y 27. Hoy el resumen se arma afuera y el mail se manda a mano desde otra casilla, sin dejar rastro en la agenda.

**Éxito:**
- Desde la ficha de cobranza de un cliente, *Enviar resumen por mail* abre el mail armado; se retoca y se envía.
- Desde la agenda se tildan varios clientes y se envía a todos con el texto estándar.
- El cliente recibe el mail con el PDF de su resumen.
- La agenda muestra el envío como última gestión.

## 2. Objetivos, no objetivos y antiobjetivos

**Objetivos:**
- configuración del correo por empresa, con la clave cifrada y un envío de prueba;
- texto estándar con variables;
- PDF del resumen de cuenta;
- envío individual (editable) y masivo (hasta 50);
- registro como gestión.

**No objetivos:**
- envíos automáticos o programados (decisión del usuario: lo hace una persona);
- servicios de envío masivo (SendGrid y similares);
- confirmación de lectura;
- mails con otros documentos (facturas, recibos).

**Antiobjetivos:**
- guardar o mostrar la clave del correo en claro;
- registrar como gestión un mail que no salió;
- que un error con un cliente corte el envío masivo de los demás;
- mandar mails reales desde las pruebas.

## 3. Configuración del correo

*Ventas → Cobranzas → Configuración de correo*, con el permiso nuevo `correo.configurar`.

**Modelo `ConfigCorreo`**, uno por empresa:

| Campo | Contenido |
|---|---|
| `servidor` | host SMTP |
| `puerto` | por defecto 587 |
| `seguro` | boolean: TLS directo, puerto 465 |
| `usuario` | |
| `claveCifrada` | la clave, cifrada |
| `remitenteNombre` | |
| `remitenteEmail` | |
| `asunto` | plantilla del asunto |
| `cuerpo` | plantilla del texto |

**Cifrado de la clave:**
- AES-256-GCM con una clave maestra del servidor: la variable de entorno `CLAVE_CIFRADO`, 32 bytes en base64.
- Sin esa variable, guardar responde 400: `El servidor no tiene configurada la clave de cifrado (CLAVE_CIFRADO): no se puede guardar la clave del correo`.
- La API nunca devuelve la clave. Solo informa `claveCargada: boolean`.
- Al modificar la configuración, una clave vacía conserva la anterior.

**Envío de prueba:** `POST …/correo/prueba` con `{ destinatario }` manda un mail de prueba. Si falla, responde 400 con el error del servidor de correo (por ejemplo, autenticación inválida).

**Plantillas por defecto:**
- Asunto: `Resumen de cuenta - {empresa}`.
- Cuerpo: `Estimado/a {cliente}:\n\nLe enviamos adjunto su resumen de cuenta. Registra un saldo vencido de {vencido} con {diasAtraso} días de atraso, y {porVencer} por vencer.\n\nSi ya realizó el pago, por favor desestime este mensaje.\n\nSaludos,\n{empresa}`.

**Variables:**
- `{cliente}`, `{vencido}`, `{porVencer}`, `{diasAtraso}` y `{empresa}`.
- Los importes van con formato argentino (`$ 1.210,00`).
- Una variable desconocida queda tal cual.

## 4. PDF del resumen de cuenta

`GET /api/ventas/cobranzas/:terceroId/resumen.pdf`, con `venta.ver` o `cobranzas.gestionar`. Se descarga también desde la ficha.

**Contenido:**
- encabezado de la empresa (razón social y CUIT);
- datos del cliente;
- fecha de emisión;
- los comprobantes pendientes de la ficha de cobranza: comprobante, fecha, vencimiento, días de atraso, importe y saldo en pesos, con los vencidos resaltados;
- totales: vencido, por vencer y, si lo hay, saldo a favor sin aplicar.

Usa los mismos datos que la ficha de la Entrega 25.

## 5. Envío

**Individual:** `POST /api/ventas/cobranzas/:terceroId/mail` con `cobranzas.gestionar`.
- **Body:** `{ asunto?, cuerpo?, destinatario? }`.
- **Valores por defecto:**
  - sin asunto o sin cuerpo, se usa la plantilla con las variables reemplazadas;
  - sin destinatario, se usa el email del cliente.
- **Previsualización:** `GET …/mail/previsualizar` devuelve el asunto, el cuerpo y el destinatario armados, para el formulario.

**Masivo:** `POST /api/ventas/cobranzas/mail` con `{ terceroIds: string[] }`, de 1 a 50 clientes. Si son más: 400 `Se envían hasta 50 clientes por vez`.
- Se manda uno por uno, con la plantilla.
- Responde `{ enviados: [{ terceroId, cliente, destinatario }], omitidos: [{ terceroId, cliente, motivo }] }`.
- Los motivos de omisión son `Sin email` y el error del servidor de correo.

**Sin configuración del correo**, cualquier envío responde 400 `Configure el correo de la empresa`.

**Registro:** por cada mail enviado con éxito se crea una gestión de cobranza (E25):
- medio `MAIL`;
- fecha de hoy;
- nota `Resumen de cuenta enviado a <email>`, sin próxima acción ni promesa;
- creada por el usuario que envía.

Si el envío falla, no se registra.

**Adjunto:** el PDF del §4, con nombre `resumen-de-cuenta-<razón social simplificada>.pdf`.

## 6. Pruebas

**Transporte:** la API usa un `TransporteCorreo` inyectable.
- En las pruebas, uno falso guarda los mails en memoria; se puede hacer fallar para un destinatario.
- En producción, nodemailer con SMTP.
- Ninguna prueba manda mails reales.

**API:**
- configuración: clave cifrada, nunca devuelta; clave vacía conserva la anterior; sin `CLAVE_CIFRADO` → 400;
- envío de prueba, correcto y con falla;
- variables;
- envío individual con texto retocado y PDF adjunto, y la gestión registrada;
- cliente sin email;
- masivo con uno que falla (los demás salen) y el tope de 50;
- sin configuración → 400;
- permisos.

**Web:**
- formulario de configuración, que no muestra la clave;
- selección múltiple en la agenda y resultado del envío;
- formulario del mail en la ficha.

**E2E:** el administrador configura el correo (en modo de prueba), envía el resumen a un cliente desde la ficha y lo ve como última gestión.

## 7. Enfoques considerados

- **SMTP de cada empresa con nodemailer** (elegido). Usa la casilla propia de la empresa y no necesita cuentas nuevas.
- **Servicio de envíos masivos.** Exige cuenta, dominio validado y clave por empresa. Descartado.
- **Envío automático programado.** Lo descartó el usuario.

## 8. Decisiones

**Del usuario:**
- el envío lo hace una persona;
- texto estándar por empresa con variables, retocable en el envío individual.

**Del builder (pueden revisarse):**
- clave cifrada con `CLAVE_CIFRADO`;
- masivo síncrono, con un tope de 50 por vez;
- variables `{cliente}`, `{vencido}`, `{porVencer}`, `{diasAtraso}` y `{empresa}`;
- transporte falso en las pruebas;
- enviar con `cobranzas.gestionar` y configurar con el permiso nuevo `correo.configurar`, que la migración agrega a los Administrador;
- el registro va como gestión `MAIL`;
- en modo de prueba y en la demo, `TRANSPORTE_CORREO=prueba` hace que el transporte guarde los mails en vez de enviarlos. La e2e usa ese modo.

**Del builder, según la revisión:** *(se completa con el control del builder)*
