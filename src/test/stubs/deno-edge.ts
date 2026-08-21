// Ponte para os testes: os módulos de Edge Function importam do runtime do Deno
// (`jsr:` / `https://esm.sh/`), endereços que o Vite não resolve. Aqui eles
// viram este stub, para que a LÓGICA desses arquivos possa ser testada no Node
// sem que nada de rede seja tocado. Se um teste chamar de fato o cliente
// Supabase, ele quebra alto — de propósito: teste de lógica não fala com o banco.
export function createClient(): never {
  throw new Error("createClient não existe nos testes: isto é lógica pura.");
}
export default {};
