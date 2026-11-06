/**
 * Las pruebas usan datos del ejercicio 2026: el reloj de Node queda fijo en esa fecha (y avanza desde ahí)
 * para que la suite no dependa del día en que se corre. Solo se reemplaza Date; los temporizadores son reales.
 */
const HOY = process.env.FECHA_TEST ?? '2026-11-06T15:00:00Z';
jest.useFakeTimers({
  now: new Date(HOY),
  advanceTimers: true,
  doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
});
