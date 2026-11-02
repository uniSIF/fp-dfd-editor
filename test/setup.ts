import '@testing-library/jest-dom/vitest';

// Node 25 以降は組み込みの localStorage が jsdom のものより優先されるため、jsdom 側に差し替える
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, { value: jsdomWindow[key], configurable: true, writable: true });
  }
}
