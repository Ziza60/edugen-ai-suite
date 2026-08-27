// ═══════════════════════════════════════════════════════════════════════════
// Declarações para o TypeScript do app enxergar os módulos de Edge Function.
//
// Os testes importam arquivos de `supabase/functions/`, que rodam no Deno e
// usam `Deno.env` e endereços de import que o TypeScript do navegador não
// conhece. Sem estas declarações, `tsc` acusava onze erros que não são erros:
// o arquivo está correto, só não é código de navegador.
//
// Isto declara TIPOS, não implementação. Em teste, `Deno.env.get` vem do stub
// em `src/test/setup.ts` e devolve undefined; em produção, do runtime real.
//
// O nome NÃO pode ser `deno-edge.d.ts`: ao lado de `deno-edge.ts`, o TypeScript
// o trata como a declaração gerada daquele arquivo e o deixa fora do programa —
// as declarações abaixo simplesmente não valeriam.
// ═══════════════════════════════════════════════════════════════════════════

declare const Deno: {
  env: {
    get(chave: string): string | undefined;
    has(chave: string): boolean;
    toObject(): Record<string, string>;
  };
};

declare module "https://esm.sh/@supabase/supabase-js@2" {
  // deno-lint-ignore no-explicit-any
  export function createClient(...args: any[]): any;
}

declare module "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Import DINÂMICO, e mesmo assim o `tsc` quer resolvê-lo: a conversão de PNG
// para JPEG em `_shared/imagem-jpeg.ts`. O módulo é buscado em tempo de
// execução, no Deno; não conseguir carregá-lo é um desfecho previsto lá (grava
// o PNG como estava), e aqui só o tipo interessa.
declare module "https://deno.land/x/imagescript@1.3.0/mod.ts" {
  // deno-lint-ignore no-explicit-any
  export function decode(bytes: Uint8Array): Promise<any>;
}
