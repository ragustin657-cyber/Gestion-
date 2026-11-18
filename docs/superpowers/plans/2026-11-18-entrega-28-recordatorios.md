# Entrega 28: Recordatorios por mail. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mandarle a uno o varios clientes un mail con su resumen de cuenta en PDF y registrar cada envío como gestión de cobranza.

**Architecture:**
- Módulo nuevo `apps/api/src/correo/`: configuración con la clave cifrada (reutiliza `src/arca/cifrado.ts`), `TransporteCorreo` inyectable (nodemailer en producción, en memoria en pruebas) y plantillas.
- El PDF y los envíos van en `apps/api/src/ventas/cobranzas/` y usan `AgendaCobranzasService.ficha()`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, nodemailer, pdfkit, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-entrega-28-recordatorios-design.md` (§8 vinculante).

## Global Constraints

- **Mensajes exactos del spec:**
  - `El servidor no tiene configurada la clave de cifrado (ARCA_CLAVE_MAESTRA): no se puede guardar la clave del correo`;
  - `Configure el correo de la empresa`;
  - `Se envían hasta 50 clientes por vez`.
- **Motivos de omisión:** `Cliente inexistente`, `Sin saldo pendiente`, `Sin email` y el error del servidor de correo.
- **Variables:** `{cliente}`, `{vencido}`, `{porVencer}`, `{diasAtraso}` y `{empresa}`. Importes en formato `$ 1.210,00`. Una variable desconocida queda igual.
- **La clave del correo** nunca sale de la API; solo se informa `claveCargada`.
- **Modo de prueba:** `TRANSPORTE_CORREO=prueba` usa el transporte en memoria. Es el modo de las pruebas de API y de la e2e (la configuración de la e2e agrega esa variable y `ARCA_CLAVE_MAESTRA` a la API de pruebas).
- **Migración:** `20261127090000_correo`. Agrega `correo.configurar` a los Administrador y no borra índices parciales.

## Review Focus

1. **Envío masivo con un cliente sin email, otro inexistente y otro que falla en el servidor.** Los demás salen y cada omitido tiene su motivo. Prueba en Task 3.
2. **Modificar la configuración con la clave vacía.** Se conserva la clave anterior. Prueba en Task 1.
3. **Texto retocado con `{cliente}`.** Se reemplaza. Prueba en Task 3.
4. **Envío que falla en el servidor.** No se registra la gestión y se informa el error. Prueba en Task 3.
5. **Cliente sin saldo en el masivo.** Se omite con `Sin saldo pendiente`. Prueba en Task 3.

---

### Task 1: Configuración del correo, transporte y plantillas

**Files:**
- Create:
  - `apps/api/src/correo/{correo.module.ts,config-correo.service.ts,correo.controller.ts,transporte.ts,plantilla.ts,plantilla.spec.ts,dto.ts}`;
  - `apps/api/test/correo-config.e2e-spec.ts`.
- Modify:
  - `apps/api/prisma/schema.prisma` y la migración;
  - `modelos-empresa.ts`;
  - `packages/shared/src/permisos.ts`;
  - `apps/api/src/app.module.ts`;
  - `apps/api/test/env.ts` (`TRANSPORTE_CORREO=prueba`);
  - `apps/api/package.json` (agregar `nodemailer` y `@types/nodemailer`).

**Interfaces:**
- **Produces, esquema:** `ConfigCorreo { id, empresaId @unique, servidor, puerto Int default 587, seguro Boolean default false, usuario, claveCifrada, remitenteNombre, remitenteEmail, asunto, cuerpo }`.
- **Produces, permiso:** `'correo.configurar': 'Configurar el correo de la empresa'`.
- **Produces, transporte:**
  - `interface MailSaliente { de: string; para: string; asunto: string; texto: string; adjuntos: { nombre: string; contenido: Buffer }[] }`;
  - `abstract class TransporteCorreo { abstract enviar(config: { servidor; puerto; seguro; usuario; clave }, mail: MailSaliente): Promise<void> }`.
  - `TransporteMemoria`, para pruebas:
    - `enviados: MailSaliente[]` y `fallarPara: Set<string>`;
    - si el destinatario está en `fallarPara`, lanza `Error('550 Destinatario rechazado')`.
  - `TransporteSmtp` con nodemailer.
  - El provider elige según `TRANSPORTE_CORREO`.
- **Produces, servicio:**
  - `ConfigCorreoService.requerida(tx)` devuelve `{ ...config, clave: string }` (descifrada); sin configuración, 400 `Configure el correo de la empresa`;
  - `ConfigCorreoService.remitente(cfg): string` → `"Nombre" <email>`.
- **Produces, plantilla:** `reemplazar(texto: string, valores: Record<string, string>): string`.
- **Produces, API** (todo con `correo.configurar`):
  - `GET /api/correo/configuracion` → `{ servidor, puerto, seguro, usuario, remitenteNombre, remitenteEmail, asunto, cuerpo, claveCargada }`; sin configuración, devuelve las plantillas por defecto y `servidor: null`;
  - `PUT /api/correo/configuracion` con todos los campos y `clave?`;
  - `POST /api/correo/prueba { destinatario }` → `{ ok: true }`, o 400 con el error del servidor.

- [ ] **Step 1: Tests que fallan:**
  - **Unit** (`plantilla.spec.ts`):
    - `reemplazar('Hola {cliente}, debe {vencido} {otra}', { cliente: 'Norte', vencido: '$ 1.210,00' })` → `'Hola Norte, debe $ 1.210,00 {otra}'`;
    - reemplaza todas las apariciones.
  - **E2E** (`correo-config.e2e-spec.ts`):
    - `it('guardar y leer sin la clave')`:
      - PUT con `clave: 'secreta'` → 200;
      - el GET no tiene ninguna propiedad con `secreta` y trae `claveCargada: true`;
      - en la base, `claveCifrada` empieza con `v1:` y no contiene `secreta`.
    - `it('clave vacía conserva la anterior')` (Review Focus 2): PUT sin `clave` → la clave descifrada sigue siendo `secreta`.
    - `it('sin clave maestra')`: sin `ARCA_CLAVE_MAESTRA` (se borra y se restaura en la prueba), el PUT responde 400 con el mensaje del spec.
    - `it('envío de prueba')`:
      - con el transporte en memoria, `POST prueba { destinatario: 'a@b.com' }` → 200, y hay un mail con `para: 'a@b.com'`;
      - con `fallarPara` para `x@y.com` → 400 con un mensaje que contiene `550`.
    - `it('plantillas por defecto')`: el GET sin configuración trae el asunto `Resumen de cuenta - {empresa}`.
    - `it('permisos')`: un usuario con `cobranzas.gestionar` → GET 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - `pnpm --filter @gestion/api add nodemailer` y `pnpm --filter @gestion/api add -D @types/nodemailer`.
  - En las pruebas se accede al transporte con `app.get(TransporteCorreo) as TransporteMemoria`.
  - Migración con el permiso para los Administrador. Recompilar shared.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(correo): configuración, transporte y plantillas`.

### Task 2: PDF del resumen de cuenta

**Files:**
- Create: `apps/api/src/ventas/cobranzas/pdf-resumen.ts`.
- Modify: `cobranzas.controller.ts` y `agenda.service.ts` (método `resumenPdf(terceroId)`).
- Test: `apps/api/test/cobranzas-resumen.e2e-spec.ts`.

**Interfaces:**
- **Produces:**
  - `AgendaCobranzasService.resumenPdf(terceroId): Promise<{ nombre: string; contenido: Buffer; ficha }>`. El nombre es `resumen-de-cuenta-<slug>.pdf`, donde el slug es la razón social en minúsculas, sin tildes y con guiones;
  - `GET /api/ventas/cobranzas/:terceroId/resumen.pdf`, con `@RequiereAlguno('venta.ver', 'cobranzas.gestionar')`.

- [ ] **Step 1: Test que falla:** `it('resumen en PDF')`, con una factura vencida de 1.210:
  - 200 `application/pdf`;
  - el texto (`compress: false` en pruebas) contiene `Distribuidora Norte SA` y `1.210,00`;
  - el nombre del archivo es `resumen-de-cuenta-distribuidora-norte-sa.pdf`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar con pdfkit, siguiendo el estilo de `pdf-comisiones.ts`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(cobranzas): resumen de cuenta en PDF`.

### Task 3: Envío individual y masivo

**Files:**
- Create: `apps/api/src/ventas/cobranzas/mail.service.ts`.
- Modify: `cobranzas.controller.ts` y `ventas.module.ts` (importa `CorreoModule`).
- Test: `apps/api/test/cobranzas-mail.e2e-spec.ts`.

**Interfaces:**
- **Consumes:**
  - `ConfigCorreoService.requerida`, `TransporteCorreo` y `reemplazar` (Task 1);
  - `resumenPdf` (Task 2);
  - para registrar el envío, crea una `GestionCobranza` con `prisma.gestionCobranza.create` (medio `MAIL`, fecha de hoy y `creadoEn: new Date()`, como `GestionesService`).
- **Produces** (todo con `cobranzas.gestionar`; las rutas de mail se declaran antes de `GET :terceroId`):
  - `GET /api/ventas/cobranzas/:terceroId/mail/previsualizar` → `{ destinatario: string | null, asunto, cuerpo }`, con las variables reemplazadas;
  - `POST /api/ventas/cobranzas/:terceroId/mail { asunto?, cuerpo?, destinatario? }` → `{ destinatario }`.
    - Sin email (y sin `destinatario`) → 400 `El cliente no tiene email`.
    - Error del servidor → 400 con el mensaje.
  - `POST /api/ventas/cobranzas/mail { terceroIds }` → `{ enviados: [{ terceroId, cliente, destinatario }], omitidos: [{ terceroId, cliente, motivo }] }`.
- **Valores de las variables:**
  - `cliente`: la razón social;
  - `vencido` y `porVencer`: los de la ficha, en formato `$ 1.210,00`;
  - `diasAtraso`: los días de la ficha;
  - `empresa`: la razón social de la empresa.

- [ ] **Step 1: Tests que fallan.** Escenario: `prepararVentas`, correo configurado, cliente con email `cobranzas@norte.com` y una factura vencida de 1.210.
  - `it('previsualizar')`: el cuerpo contiene `Distribuidora Norte SA` y `$ 1.210,00`; el destinatario es `cobranzas@norte.com`.
  - `it('envío individual')`:
    - POST con `cuerpo: 'Hola {cliente}, adjuntamos el resumen.'` (Review Focus 3) → 200;
    - el transporte tiene un mail con el texto `Hola Distribuidora Norte SA, adjuntamos el resumen.`, un adjunto `resumen-de-cuenta-distribuidora-norte-sa.pdf` y `de` con el remitente;
    - la ficha tiene una gestión `MAIL` con la nota `Resumen de cuenta enviado a cobranzas@norte.com`.
  - `it('falla del servidor')` (Review Focus 4): `fallarPara` con el email → 400 con `550` y ninguna gestión.
  - `it('sin email')` → 400 `El cliente no tiene email`.
  - `it('masivo')` (Review Focus 1 y 5), con cinco ids:
    - A: con email y deuda → enviado;
    - B: sin email → `Sin email`;
    - C: un uuid inexistente → `Cliente inexistente`;
    - D: un cliente sin saldo → `Sin saldo pendiente`;
    - E: uno que falla en el servidor → el mensaje del servidor;
    - más A repetido;
    - resultado: un enviado y cuatro omitidos, y una sola gestión nueva (la de A).
  - `it('tope y sin configuración')`:
    - 51 ids → 400 `Se envían hasta 50 clientes por vez`;
    - sin configuración → 400 `Configure el correo de la empresa`.
  - `it('permisos')`: un usuario con `venta.ver` → POST 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. Suite API completa en dos mitades.
- [ ] **Step 5:** Commit `feat(cobranzas): envío del resumen por mail`.

### Task 4: Web

**Files:**
- Create:
  - `apps/web/src/correo/ConfigCorreoPage.tsx`;
  - `apps/web/src/ventas/correo.test.tsx`.
- Modify:
  - `apps/web/src/ventas/CobranzasPages.tsx`: en la agenda, una casilla por fila, *Enviar resumen a los seleccionados* y el resultado; en la ficha, *Descargar resumen* y *Enviar resumen por mail* con un formulario editable;
  - el menú (*Ventas → Configuración de correo*, con `correo.configurar`) y las rutas.

**Interfaces:**
- **Produces:**
  - `FormConfigCorreo({ inicial, onGuardar })`: el campo clave arranca vacío, con la ayuda `Dejar vacío para conservar la actual` si `claveCargada`;
  - `ResultadoEnvio({ enviados, omitidos })`;
  - `TablaAgenda` gana las props opcionales `seleccion?: string[]` y `onSeleccion?(ids)`.

- [ ] **Step 1: Tests que fallan:**
  - `FormConfigCorreo` con `claveCargada: true` → el campo `Clave` está vacío y se lee la ayuda; al guardar sin tocarla, `onGuardar` no incluye `clave`;
  - `ResultadoEnvio` con 1 enviado y 1 omitido `Sin email` → muestra `1 enviado` y `Sin email`;
  - `TablaAgenda` con selección → al tildar una fila se llama a `onSeleccion(['t1'])`;
  - el menú muestra `Configuración de correo` con `correo.configurar`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. Suite web y build en verde.
- [ ] **Step 5:** Commit `feat(web): recordatorios por mail`.

### Task 5: E2E y README

- [ ] **Step 1: Test** `test('recordatorios: el administrador configura el correo, envía el resumen a un cliente y lo ve como gestión')`:
  - **Base:** en `e2e/playwright.config.ts`, la API recibe `TRANSPORTE_CORREO=prueba` y una `ARCA_CLAVE_MAESTRA` de prueba.
  - **Recorrido:**
    - el admin carga el correo (servidor `smtp.prueba.local`, usuario, clave y remitente) y lo guarda;
    - da de alta su propio cliente con email (como la e2e de intereses) y le emite una factura vencida ayer, en hora argentina;
    - en la ficha de cobranza, *Enviar resumen por mail* → `Mail enviado`;
    - el historial muestra `Resumen de cuenta enviado a …`.
  - **Proyecto:** `general`, porque no comparte estado.
- [ ] **Step 2:** recrear `gestion_e2e` y correr `pnpm e2e -- --trace off` → 24/24.
- [ ] **Step 3:** README, sección "Recordatorios por mail (Entrega 28)": configuración, modo de prueba y `ARCA_CLAVE_MAESTRA`.
- [ ] **Step 4:** Commit `test(e2e): recordatorios; docs: README entrega 28`.
