import '@testing-library/jest-dom/vitest';

// Mantine necesita matchMedia y ResizeObserver en jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});
class RO { observe() {} unobserve() {} disconnect() {} }
(window as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

// E57: jsdom no implementa scrollIntoView (lo usan los Select con búsqueda de Mantine al navegar las opciones)
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
