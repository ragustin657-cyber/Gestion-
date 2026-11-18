# Libro de Sueldos Digital: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** descargar el archivo de importación del Libro de Sueldos Digital por cada liquidación cerrada, y el de asociación de conceptos con sus códigos ARCA.

**Architecture:**
- Una tabla declarativa por registro (`lsd-diseno.ts`), como `f931-diseno.ts`.
- El cálculo de importes por recibo se extrae de `F931Service` a una función pura que usan el F.931 y el Libro.
- `LsdService` arma el archivo de la liquidación (registros 01 a 04) y el de conceptos, y asigna el número del Libro con un bloqueo por empresa y período.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, Jest/supertest, React 19, Mantine 7, Vitest y Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-entrega-30-libro-sueldos-design.md`

## Global Constraints

- **Largos de línea:**
  - registro 01: 35;
  - registro 02: 115;
  - registro 03: 51;
  - registro 04: 370;
  - archivo de conceptos: 195.
- **Formato del archivo:**
  - latin1 con CRLF;
  - alfanuméricos completados con espacios a la derecha;
  - numéricos con ceros a la izquierda;
  - importes sin separador decimal.
- **Rangos de `codigoArca`:**
  - remunerativo: 110000 a 499999;
  - no remunerativo: 510000 a 799999;
  - descuento: 810000 a 829999.
  - Error: `El código ARCA <código> no corresponde a un concepto <remunerativo|no remunerativo|descuento>`.
- **Mensajes:**
  - `Solo se descarga el Libro de una liquidación cerrada`;
  - `<Apellido, Nombre>: falta el CBU (22 dígitos) para la acreditación en cuenta`.
- **Nombres de archivo:** `LSD-<CUIT>-<AAAAMM>-<número>.txt` y `LSD-conceptos.txt`.
- **Permisos:** descargar con `sueldos.ver`; fijar el número con `sueldos.liquidar`. No hay permisos nuevos.
- **Migración:**
  - se genera con `prisma migrate diff`, sin crear antes la carpeta vacía;
  - se aplica en `gestion` y `gestion_test`;
  - los códigos por defecto se verifican en `gestion_mig`.

## Review Focus

1. **Concepto con código de más de 6 caracteres o con letras en `codigoArca`.** Responde 400; no se guarda ni rompe el archivo. Prueba en Task 1.
2. **Liquidación final de un empleado con transferencia sin CBU.** Responde 400 con el nombre, no 500. Prueba en Task 3.
3. **Renglón con cantidad decimal (vacaciones no gozadas 12,5 días).** Cantidad `01250` con unidad `D`. Prueba en Task 3.
4. **Reabrir y volver a cerrar una liquidación ya descargada.** Conserva su número del Libro. Prueba en Task 3.
5. **Concepto inactivo usado en una liquidación vieja.** Aparece en el archivo de conceptos, así su código queda asociado. Prueba en Task 2.

---

### Task 1: Código ARCA en los conceptos

**Files:**
- Modify:
  - `apps/api/prisma/schema.prisma` (`Concepto.codigoArca String`, `Liquidacion.numeroLsd Int?`);
  - migración nueva;
  - `apps/api/src/sueldos/dto.ts`, `maestros.service.ts` y `modelo.ts`.
- Create: `apps/api/src/sueldos/lsd-conceptos.ts`.
- Test: `apps/api/test/lsd-conceptos.e2e-spec.ts`; `apps/api/src/sueldos/lsd-conceptos.spec.ts`.

**Interfaces:**
- **Produces** (en `lsd-conceptos.ts`):
  - `codigoArcaPorDefecto(c: { codigo: string; clase: ClaseConcepto; tipo: TipoConcepto; parametros: unknown; destino: DestinoDescuento }): string`, con la tabla de §4.1;
  - `validarCodigoArca(codigo: string, clase: ClaseConcepto): string | null`, que devuelve el mensaje de error o `null`;
  - `RENGLONES_FIJOS: { codigo: string; nombre: string; codigoArca: string; clase: 'REMUNERATIVO' | 'NO_REMUNERATIVO' }[]`, con los 200, 201, 300, 310, 311, 320, 321, 330, 331 y 340 de §4.1;
  - en `dto.ts`, `esquemaConcepto` agrega `codigoArca: z.string().regex(/^\d{6}$/).optional()`.

- [ ] **Step 1: Pruebas que fallan.**
  - **Unitarias (`lsd-conceptos.spec.ts`):**
    - `codigoArcaPorDefecto` de cada concepto de `CONCEPTOS_MODELO` da:
      - 100 → 110000;
      - 110 → 160001;
      - 120 → 170001;
      - 130 → 130001;
      - 131 → 130002;
      - 140 → 110000;
      - 150 → 150000;
      - 151 → 110000;
      - 210 → 550000;
      - 500 → 810000;
      - 510 → 810001;
      - 520 → 810002;
      - 530 → 810004;
      - 540 → 810004.
    - Un FIJO remunerativo da 160000; un descuento OTRO, 820000.
    - `validarCodigoArca('810000', 'REMUNERATIVO')` devuelve `El código ARCA 810000 no corresponde a un concepto remunerativo`.
  - **E2E (`lsd-conceptos.e2e-spec.ts`):**
    - `it('precarga con códigos ARCA')`: los conceptos de una empresa nueva tienen el código por defecto.
    - `it('alta sin código usa el de defecto')`: POST de un FIJO remunerativo sin `codigoArca` → guarda 160000.
    - `it('código fuera de rango')`: PUT con 810000 en un remunerativo → 400 con el mensaje. Con `'12345A'` → 400 (Review Focus 1).
- [ ] **Step 2:** Correr y ver fallar (función y columna inexistentes).
- [ ] **Step 3: Implementar.**
  - **Esquema:** los dos campos.
  - **Migración:**
    - agrega `codigoArca` con `DEFAULT ''`;
    - completa los existentes con SQL que replica `codigoArcaPorDefecto`, usando `CASE` sobre `tipo`, `clase`, `destino`, `codigo` y `parametros->>'recargoPct'`;
    - quita el default.
  - **Precarga:** en `modelo.ts`, `codigoArca: codigoArcaPorDefecto(c)`.
  - **`maestros.service.ts`:**
    - en el alta y la modificación, si no viene `codigoArca` usa el valor por defecto en el alta y conserva el actual en la modificación;
    - si viene, `validarCodigoArca` → `BadRequestException`.
- [ ] **Step 4:**
  - Migración en `gestion` y `gestion_test`.
  - En `gestion_mig`, `SELECT codigo, "codigoArca" FROM "Concepto"` muestra los códigos de la tabla.
  - Pasan las pruebas y `test/sueldos-maestros`.
- [ ] **Step 5:** Commit `feat(sueldos): código ARCA de los conceptos`.

### Task 2: Diseño del Libro y archivo de conceptos

**Files:**
- Create:
  - `apps/api/src/sueldos/lsd-diseno.ts`;
  - `apps/api/src/sueldos/lsd.service.ts`;
  - `apps/api/src/sueldos/lsd.controller.ts`.
- Modify: `sueldos.module.ts`.
- Test: `apps/api/src/sueldos/lsd-diseno.spec.ts`; `apps/api/test/lsd-conceptos.e2e-spec.ts` (agrega casos).

**Interfaces:**
- **Consumes:** `RENGLONES_FIJOS` (Task 1).
- **Produces:**
  - `type CampoLsd<T> = { nombre: string; largo: number; tipo: 'N' | 'C' | 'I'; valor: (d: T) => string | number | Prisma.Decimal }`;
  - `REG01`, `REG02`, `REG03`, `REG04` y `REG_CONCEPTO`, con los campos de §3 y §4.1;
  - `linea<T>(campos: CampoLsd<T>[], d: T): string`:
    - `N`: ceros a la izquierda;
    - `C`: espacios a la derecha y truncado;
    - `I`: importe × 100, sin signo, con ceros a la izquierda;
    - un `N` o `I` que no entra lanza `Error('<nombre>: valor fuera de rango')`.
  - Tipos de datos: `Datos01`, `Datos02`, `Datos03` y `Datos04`, con los campos de §3 tal como se nombran en la spec.
  - `LsdService.conceptos(): Promise<{ nombre: string; contenido: Buffer }>`.
  - Ruta: `GET /api/sueldos/lsd/conceptos`, con `sueldos.ver`.

- [ ] **Step 1: Pruebas que fallan.**
  - **Unitarias (`lsd-diseno.spec.ts`):**
    - la suma de largos de cada tabla da 35, 115, 51, 370 y 195;
    - `linea(REG03, { cuil: '20123456786', codigo: '100', cantidad: 12.5, unidad: 'D', importe: 1234.5, dc: 'C' })` da `'0320123456786100       01250D000000000123450C000000'`;
    - un importe de 10^13 lanza `Importe: valor fuera de rango`.
  - **E2E (`lsd-conceptos.e2e-spec.ts`):**
    - `it('archivo de conceptos')`:
      - todas las líneas tienen 195 caracteres;
      - la del 100 empieza con `110000100       Sueldo básico`;
      - su `slice(167, 186)` es `'1111111100 1 1 10 0'`, según la tabla de posiciones de §4.1;
      - la del 500 tiene las 19 posiciones de subsistemas en `0` y las libres en blanco;
      - incluye las líneas fijas 201 (120003) y 300 (520014).
    - `it('incluye conceptos inactivos')`: se desactiva el 120 y sigue en el archivo (Review Focus 5).
    - `it('permisos')`: sin `sueldos.ver` → 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar las tablas, `linea`, el servicio y el controlador.
  - El archivo de conceptos va ordenado por código del empleador: primero los conceptos y después los fijos.
  - Marcas de subsistemas: un helper `marcas(clase)` que devuelve los 19 caracteres.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(sueldos): diseño del Libro de Sueldos Digital y archivo de conceptos`.

### Task 3: Archivo de la liquidación

**Files:**
- Create: `apps/api/src/sueldos/importes-recibo.ts`.
- Modify:
  - `f931.service.ts` (usa la función extraída);
  - `lsd.service.ts`;
  - `lsd.controller.ts`.
- Test: `apps/api/test/lsd-liquidacion.e2e-spec.ts`. Además siguen pasando `test/sueldos-f931*` y `test/sueldos-*`.

**Interfaces:**
- **Consumes:** Tasks 1 y 2.
- **Produces:**
  - `importesRecibo(r: ReciboConRenglones, liq: Liquidacion, param: { baseMaxima: Dec | null; detraccion: Dec }, conceptos: Map<string, Concepto>, opciones: { esSac: boolean; esFinal: boolean })`. Devuelve:
    - `remuneracionTotal`, `imponible1`, `imponible2`, `imponible3`, `imponible4`, `imponible5`, `imponible8`, `imponible9`, `imponible11`;
    - `detraccion`, `noRemunerativo`, `sueldoAdicionales`, `sac`, `horasExtrasImporte` y `vacaciones`.
    - Es exactamente el cuerpo actual del bucle de `F931Service`, y el F.931 suma sus resultados.
  - `LsdService.liquidacion(id: string): Promise<{ nombre: string; contenido: Buffer; numero: number }>`.
  - `LsdService.fijarNumero(id: string, numero: number)`.
  - Rutas:
    - `GET /api/sueldos/liquidaciones/:id/lsd`, con `sueldos.ver`;
    - `PUT /api/sueldos/liquidaciones/:id/numero-lsd`, con `sueldos.liquidar`. Se declaran en `LsdController` con el prefijo completo.

- [ ] **Step 1: Pruebas que fallan** (escenario como `sueldos-f931.e2e-spec.ts`, más un helper `lsd(id)` que devuelve el Buffer):
  - `it('mensual')`:
    - **línea 1:**
      - 35 caracteres;
      - `slice(0, 2)` = `'01'`;
      - `slice(2, 13)` = CUIT;
      - `slice(13, 22)` = `'SJ202611M'`;
      - `slice(22, 29)` = `'0000130'`;
      - `slice(29, 35)` = `'000001'`.
    - **Registros 02, 03 y 04:**
      - el 02 tiene 115 caracteres, termina en `'3'` y lleva el CBU del empleado en 73–95;
      - hay un 03 por renglón no nulo, cada uno de 51 caracteres;
      - el del 100 termina en `'C000000'`;
      - el 04 tiene 370 caracteres, y sus bases 1 (175–190) y 10 (340–355) coinciden con los campos de remuneración imponible 1 y 11 del F.931 del mismo mes.
    - El nombre del archivo es `LSD-<cuit>-202611-1.txt`.
  - `it('ausencia y horas extra')`:
    - con una novedad de horas extra 50 % (10 h), el 03 del 130 tiene cantidad `01000` y unidad `H`;
    - con una ausencia, el 03 del 140 termina en `D000000`.
  - `it('SAC después de la mensual')`:
    - con la mensual ya descargada (número 1), el SAC de diciembre da número 2;
    - sus días trabajados (47–49) son los de la mensual.
  - `it('final')`:
    - el 03 usa el código `201` con días y unidad `D`;
    - aparecen `300` con unidad `A` y `310` en días (meses × 30);
    - los días para el tope del 02 (95–98) son los días trabajados.
  - `it('vacaciones no gozadas con decimales')`: el 330 tiene cantidad `01250` cuando son 12,5 días (Review Focus 3).
  - `it('número estable')`: se descarga dos veces, se reabre, se cierra y se descarga de nuevo → siempre 1 (Review Focus 4).
  - `it('números simultáneos')`: `Promise.all` de la descarga de la mensual y del SAC sin números previos → números distintos {1, 2}.
  - `it('fijar número')`:
    - PUT `numero-lsd` con 5 → la descarga da 5;
    - otro PUT sobre la misma liquidación → 400 `La liquidación ya tiene número del Libro`.
  - `it('no cerrada')` → 400 `Solo se descarga el Libro de una liquidación cerrada`.
  - `it('sin CBU')`: empleado con transferencia y `cbu: null` en una final → 400 `<Apellido, Nombre>: falta el CBU (22 dígitos) para la acreditación en cuenta` (Review Focus 2).
  - `it('permisos')`: sin `sueldos.ver` → 403; PUT sin `sueldos.liquidar` → 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - **Extracción:** `importesRecibo` sale de `F931Service` sin cambiar el comportamiento. Corre `test/sueldos-f931` antes de seguir.
  - **`LsdService.liquidacion`:**
    - en una transacción, `pg_advisory_xact_lock(hashtext('lsd:' || empresaId || ':' || anio || mes))` con `$executeRawUnsafe`;
    - si `numeroLsd` es null, le asigna `max + 1` del período;
    - arma los registros según §3 y §4;
    - verifica los largos y la cantidad de 04 (si no coinciden, `InternalServerErrorException`);
    - los errores de `linea` se convierten en 400 con el nombre del empleado.
  - **Días del SAC:** se toman del recibo de la liquidación MENSUAL del mismo período y empleado.
- [ ] **Step 4:** PASS. También pasan `test/sueldos-f931`, `test/sueldos-final-cierre` y `test/sueldos-topes`. Corre la suite API completa en dos mitades.
- [ ] **Step 5:** Commit `feat(sueldos): archivo del Libro de Sueldos Digital por liquidación`.

### Task 4: Web y E2E

**Files:**
- Modify:
  - `apps/web/src/sueldos/LiquidacionPage.tsx`;
  - `apps/web/src/sueldos/ConceptosPage.tsx`;
  - `apps/web/src/sueldos/comun.ts` (`Concepto.codigoArca`, `CODIGOS_ARCA`).
- Create: `e2e/libro-sueldos.spec.ts`.
- Modify: `e2e/playwright.config.ts`, con el proyecto `libro-sueldos` después de `sueldos-final`.
- Test: `apps/web/src/sueldos/libro.test.tsx`.

**Interfaces:**
- **Consumes:**
  - las rutas de las Tasks 2 y 3;
  - `numeroLsd` en el GET de la liquidación. Si el GET no lo devuelve, se agrega en `liquidaciones.service.ts`.
- **Produces:** `CODIGOS_ARCA: { value: string; label: string }[]`, con los códigos de la tabla de §4.1 más 120000, 520014 y 820000.

- [ ] **Step 1: Pruebas que fallan (`libro.test.tsx`):**
  - el formulario de concepto muestra *Código ARCA*, con un select que acepta un valor libre de 6 dígitos;
  - la tabla de conceptos tiene la columna *Código ARCA*;
  - en una liquidación cerrada con `numeroLsd: 2` se ve el botón *Libro de Sueldos Digital* y el texto `Liquidación N° 2 del Libro`;
  - en una liquidación en borrador no está el botón.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar.**
  - Agregar *Archivo de conceptos para ARCA* en Conceptos.
  - Las descargas usan el helper `bajar` existente.
  - Después de descargar el Libro, la liquidación se refresca para mostrar el número.
- [ ] **Step 4:** Suite web y build en verde.
- [ ] **Step 5: E2E `libro-sueldos.spec.ts`:**
  - el contador abre una liquidación cerrada de la demo, o la cierra si hace falta, y descarga *Libro de Sueldos Digital* con `page.waitForEvent('download')`;
  - el archivo:
    - empieza con `01` + CUIT + `SJ`;
    - todas sus líneas tienen 35, 115, 51 o 370 caracteres según su tipo;
  - después se ve `Liquidación N° 1 del Libro`;
  - se recrea `gestion_e2e` y `pnpm e2e -- --trace off` da todo en verde.
- [ ] **Step 6:** Commit `feat(web): Libro de Sueldos Digital`.
