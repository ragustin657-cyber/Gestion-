# Entrega 29: Pulido de las Entregas 26 a 28

## 1. Objetivo y alcance

Corregir los menores pendientes que el usuario puede notar:
- avisos que hoy salen como error del sistema;
- datos que se muestran mal;
- acciones que pueden alcanzar a clientes no vistos;
- consultas que se vuelven lentas con volumen;
- fechas que dependen de la zona horaria.

Son arreglos puntuales. Cada uno lleva una prueba que falla antes. No hay modelos nuevos: solo una migración de permisos.

**Fuera de alcance:**
- lo que es solo prolijidad interna (la importación duplicada del módulo de correo);
- la prueba web de `hoy()` en una máquina con hora argentina;
- las limitaciones de la e2e de intereses;
- el rol Facturación de demos ya existentes.

**Decisión del usuario:** hacer el pulido con esta lista (la eligió el builder y el usuario la aprobó).

## 2. Arreglos

### A. Sueldos y comisiones (E26)

1. **Concepto de comisiones configurado.** Además de no poder desactivarse, no puede cambiar a:
   - un tipo que no sea `FIJO`;
   - la clase `DESCUENTO`;
   - un convenio;
   - `soloAfiliados`.

   Si se intenta, responde 400 `Es el concepto de comisiones de vendedores: debe seguir siendo fijo, sin convenio, para todos los empleados y no de descuento`.
2. **Concepto ya inactivo.** Un concepto configurado que ya estaba inactivo se puede editar. Solo se bloquea el paso de activo a inactivo.
3. **Permisos de empresas existentes.** La migración agrega al rol Administrador todos los permisos que todavía no tenga. Es la lista completa actual de `TODOS_LOS_PERMISOS`, que es lo que recibe una empresa nueva.

### B. Tarjetas y cobranzas

4. **Cupón que vuelve a la lista.** En la liquidación de tarjetas, un cupón que sale de la lista de pendientes queda destildado. Si vuelve, aparece sin tildar.
5. **Creador de gestión inválido.** La ficha de cobranza busca el usuario creador solo con un uuid válido (expresión estricta), así un valor inválido no produce un error del sistema.

### C. Intereses (E27)

6. **Nota eliminada en el historial.** Muestra el cliente (el del renglón).
7. **Cálculo acotado.** El cálculo solo considera comprobantes cuyo movimiento tiene saldo positivo, o que recibieron aplicaciones con un crédito de fecha posterior al cierre. Ya no recorre toda la historia.
8. **Configuración simultánea.** La configuración de intereses se guarda con `upsert`: dos primeros guardados simultáneos no dan error del sistema.
9. **Validación interna.** Un error de validación al armar la nota de débito responde 400 con su mensaje, no 500.

### D. Correo y recordatorios (E28)

10. **Auditoría.** Guardar la configuración de correo registra una auditoría con servidor, puerto, usuario y remitente, sin la clave.
11. **Configuración simultánea.** La configuración de correo se guarda con `upsert`.
12. **Selección en la agenda.** Al cambiar los filtros o la búsqueda, se limpia la selección del envío masivo.
13. **Validación del formulario.** El botón *Guardar* de la configuración de correo exige nombre y email del remitente, asunto y texto.
14. **Aviso visible.** Cuando el mail salió pero la gestión no se registró, la pantalla muestra el aviso. En el envío individual va como mensaje; en el masivo, junto al enviado.
15. **Una consulta por cliente.** El envío masivo arma la ficha y busca la empresa una sola vez por cliente (y la empresa, una vez por envío).

### E. Fechas

16. **Pantalla de Monedas.** Usa `hoy()` de `compras/formato` (hora argentina).
17. **E2E.** Las de liquidación final y ajuste por inflación calculan "hoy" en hora argentina, con el navegador en esa zona.

## 3. Pruebas

- Una prueba por arreglo, que falla antes.
- API para 1, 2, 5, 6, 7, 8, 9, 10, 11 y 15.
- Web para 4, 12, 13 y 14.
- Los arreglos 3, 16 y 17 se verifican sobre la demo y con las e2e.
- Al final, suites completas en verde.

## 4. Lo que queda al builder

El orden de las pruebas y los textos secundarios.
