import "@testing-library/jest-dom";

// Os módulos de Edge Function leem variáveis de ambiente pelo `Deno.env` já na
// carga do arquivo. No Node esse objeto não existe e o import inteiro morria,
// deixando a lógica dessas funções sem teste. Um `env.get` que devolve undefined
// basta: os módulos caem nos seus próprios valores padrão. Nenhum segredo entra
// aqui — se um teste precisar de um valor, ele mesmo o define.
if (!(globalThis as { Deno?: unknown }).Deno) {
  (globalThis as { Deno?: unknown }).Deno = {
    env: {
      get: () => undefined,
      has: () => false,
      toObject: () => ({}),
    },
  };
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
