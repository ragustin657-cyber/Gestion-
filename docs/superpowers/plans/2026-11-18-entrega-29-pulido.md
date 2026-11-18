# Entrega 29: Pulido de las Entregas 26 a 28. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** corregir los 17 menores pendientes del spec.

**Architecture:** arreglos puntuales en:
- `apps/api/src/{sueldos,ventas/cobranzas,ventas/intereses,correo}`;
- `apps/web/src/{tesoreria,ventas,correo,monedas}`;
- dos e2e;
- una migración de permisos.

**Tech Stack:** NestJS 11, Prisma 6, Jest/supertest, React 19 + Mantine 7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-entrega-29-pulido-design.md` (los números de arreglo son los del spec).

## Global Constraints

- **Mensajes:** los exactos del spec.
- **Pruebas:** cada arreglo con una prueba que falla antes; reloj de pruebas de la API 2026-11-06.
- **Migración:** `20261128090000_permisos_administrador`. Agrega al Administrador cada permiso de `TODOS_LOS_PERMISOS` que le falte, con un `array_append` por permiso o un `UPDATE` con `array(select distinct unnest(...))`. No borra índices.

## Review Focus

1. **PUT del concepto de comisiones configurado sin cambiar nada (mismos datos, activo).** Responde 200; solo se bloquean los cambios prohibidos. Prueba en Task 1.
2. **Envío masivo después de cambiar el filtro de la agenda.** La selección vacía deshabilita el botón. Prueba en Task 3.
3. **Cálculo de intereses con una factura saldada antes del cierre y pagada después.** Sigue entrando, porque el saldo al cierre es positivo. Prueba en Task 2.
4. **Liquidación de intereses con un comprobante que hace fallar la validación del esquema.** Responde 400, no 500. Prueba en Task 2.
5. **Nota eliminada de un cliente dado de baja.** El historial muestra el nombre. Prueba en Task 2.

---

### Task 1: API de sueldos, comisiones, cobranzas y permisos (arreglos 1, 2, 3 y 5)

**Files:**
- Modify:
  - `apps/api/src/sueldos/maestros.service.ts`;
  - `apps/api/src/ventas/cobranzas/agenda.service.ts`;
  - la migración.
- Test: `apps/api/test/pulido29-sueldos-cobranzas.e2e-spec.ts`.

- [ ] **Step 1: Tests que fallan:**
  - `it('concepto de comisiones configurado')`:
    - PUT del 210 con `tipo: 'PORCENTAJE'` → 400 con el mensaje del arreglo 1;
    - con un `convenioId` → 400;
    - con `soloAfiliados: true` → 400;
    - con `clase: 'DESCUENTO'` → 400;
    - los mismos datos sin cambios → 200 (Review Focus 1).
  - `it('concepto configurado inactivo se edita')`: se marca inactivo por prisma; un PUT que cambia el nombre y sigue `activo: false` → 200.
  - `it('creador inválido')`: una gestión con `creadoPor: '------------------------------------'` (36 guiones) → la ficha responde 200.
  - **Migración:** sobre una demo previa, se le sacan al Administrador `sueldos.ver` y `bienes.gestionar`; después del deploy los vuelve a tener.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. Pasan `test/pulido29*`, `test/sueldos-maestros*` y `test/cobranzas*`.
- [ ] **Step 5:** Commit `fix(pulido): sueldos, comisiones, cobranzas y permisos`.

### Task 2: API de intereses y correo (arreglos 6, 7, 8, 9, 10, 11 y 15)

**Files:**
- Modify:
  - `apps/api/src/ventas/intereses/{calculo.service.ts,liquidaciones.service.ts,config.service.ts}`;
  - `apps/api/src/correo/config-correo.service.ts`;
  - `apps/api/src/ventas/cobranzas/mail.service.ts`.
- Test: `apps/api/test/pulido29-intereses-correo.e2e-spec.ts`.

- [ ] **Step 1: Tests que fallan:**
  - `it('nota eliminada muestra el cliente')` (Review Focus 5):
    - liquidar octubre; borrar por prisma la nota de débito (su movimiento y el comprobante);
    - el historial muestra `cliente: 'Distribuidora Norte SA'` y `estado: 'ELIMINADA'`.
  - `it('cálculo acotado')`:
    - **Rendimiento:** con un espía en `tx.comprobanteVenta.findMany` (Jest `spyOn` sobre el cliente de la transacción no es práctico), se verifica por resultado: una factura pagada por completo antes del cierre no se consulta. En la prueba: 3 facturas de octubre, 2 pagadas el 2026-10-15 y una pendiente; el GET devuelve 1 renglón. Es guarda de comportamiento; ver la decisión de la Task 2.
    - Una factura pagada el 2026-11-03 sigue entrando (Review Focus 3).
  - `it('configuraciones simultáneas')`: `Promise.all` de dos PUT de intereses y de dos de correo en una empresa nueva → todos 200.
  - `it('validación interna como 400')` (Review Focus 4): con la descripción de la configuración de intereses de 200 caracteres (la de la nota supera el máximo del renglón) → la confirmación responde 400, no 500.
  - `it('auditoría del correo')`:
    - después de un PUT de correo existe una `Auditoria` con `entidad: 'ConfigCorreo'`;
    - sus `datos` no contienen la clave.
  - `it('masivo consulta una vez')`: se espía `AgendaCobranzasService.prototype.ficha` → con 2 clientes se llama 2 veces (hoy son 4).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
  - **Cálculo:** el filtro de movimientos se hace en la consulta: `saldo > 0` o una aplicación posterior al cierre.
  - **Upsert por `empresaId`** en las dos configuraciones.
  - **Errores de esquema:** `safeParse`, con el primer error como 400.
  - **Auditoría:** con `AuditoriaService`.
  - **Envío masivo:** recibe la ficha ya armada y la empresa una vez por envío.
- [ ] **Step 4:** PASS. Pasan `test/intereses*`, `test/correo*` y `test/cobranzas*`; suite API completa en dos mitades.
- [ ] **Step 5:** Commit `fix(pulido): intereses y correo`.

### Task 3: Web (arreglos 4, 12, 13, 14 y 16)

**Files:**
- Modify:
  - `apps/web/src/tesoreria/TarjetasPages.tsx`;
  - `apps/web/src/ventas/CobranzasPages.tsx`;
  - `apps/web/src/correo/ConfigCorreoPage.tsx`;
  - `apps/web/src/maestros/MonedasPage.tsx` (o donde esté).
- Test: `apps/web/src/pulido29.test.tsx`.

**Interfaces:**
- **Produces:**
  - `AgendaCobranzasPage` limpia `seleccion` en un efecto cuando cambian los filtros, el mínimo de días o la búsqueda;
  - `FormLiquidacion` poda `elegidos` a los cupones presentes cuando cambia `cupones`;
  - `avisoEnvio(r: { aviso?: string }): string | null`, exportada de `CobranzasPages`.

- [ ] **Step 1: Tests que fallan:**
  - `FormLiquidacion`:
    - tildar c1 y c2;
    - volver a renderizar con solo c1, y después con c1 y c2;
    - la casilla de c2 está destildada.
  - `FormConfigCorreo`: con asunto vacío, `Guardar` está deshabilitado.
  - `avisoEnvio({ aviso: 'El mail se envió, pero no se pudo registrar la gestión' })` devuelve el texto; sin aviso, `null`. En el resultado masivo, un enviado con aviso muestra el texto.
  - **Selección de la agenda:** se prueba como función pura, `seleccionTrasFiltro()` (al cambiar los filtros devuelve `[]`), y como componente sobre `TablaAgenda`, que con una selección vacía no tilda nada.
  - **Monedas:** `hoy` importada de `compras/formato`, verificada por tipo y por búsqueda (sin prueba de unidad; ver la decisión de la Task 3).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS. Suite web y build en verde.
- [ ] **Step 5:** Commit `fix(web): pulido de tarjetas, cobranzas y correo`.

### Task 4: E2E en hora argentina (arreglo 17) y cierre

- [ ] **Step 1:** En `e2e/sueldos-final.spec.ts` y `e2e/ajuste-inflacion.spec.ts`:
  - `test.use({ timezoneId: 'America/Argentina/Buenos_Aires' })`;
  - los cálculos de "hoy" pasan a `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })`.
- [ ] **Step 2:** Recrear `gestion_e2e` y correr `pnpm e2e -- --trace off` → 24/24.
- [ ] **Step 3:** Commit `test(e2e): fechas en hora argentina`.
