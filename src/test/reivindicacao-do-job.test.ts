import { describe, expect, it } from "vitest";
import {
  ganhouOPortao, moduloJaGravado, reivindicou,
} from "../../supabase/functions/_shared/course-dispatch";

// ═══════════════════════════════════════════════════════════════════════════
// O CURSO DE 8 MÓDULOS QUE SAIU COM 10
//
// `claim_course_generation_job` era declarada `returns course_generation_jobs`
// — um registro, não `setof`. Quando o UPDATE não casa linha nenhuma, uma
// função SQL assim não devolve zero linhas: devolve UMA linha com todas as
// colunas nulas. O PostgREST roda `select * from fn(...)`, acha essa linha, e
// entrega `{"id": null, "status": null, ...}`.
//
// O worker checava `if (!claimed)`. Esse objeto é truthy. A checagem nunca
// disparou — nenhuma vez desde que existe —, e o worker que PERDEU a disputa
// gerava o módulo inteiro do mesmo jeito que o que ganhou.
//
// MEDIDO em Postgres 16.13, com a tabela e a função deste projeto:
//
//     1a chamada .................. id preenchido, status running, attempts 1
//     2a chamada .................. 1 LINHA, colunas todas nulas, attempts 1
//     duas transações simultâneas . a 2a espera o lock da 1a (2,0 s no teste)
//                                   e sai com o mesmo registro todo nulo
//     depois da migração `setof` .. 2a chamada devolve 0 linhas
//
// O banco sempre serializou certo: `attempts` fica em 1, nunca 2. Quem não
// sabia ler era este lado.
//
// A conta no curso 4f278899 (08/09), lida no log da função:
//
//     course-module-done .......... 12 eventos para 6 índices (2 a 7)
//     execution_ids distintos ..... 11 (um isolate serviu duas requisições)
//     início dos 12 workers ....... dentro de 145 ms um do outro
//     claim_ms dos pares .......... 101/613, 679/76, 60/722 — a espera de lock
//                                   prova que os dois miravam a MESMA linha
//     course-quality-gate-done .... 5 execuções
//     módulos gravados ............ 10 para 8 pedidos, 2 títulos repetidos
//
// A causa a montante é MODULOS_DA_PONTE = 2: os módulos 1 e 2 terminam quase
// juntos e cada um abre a porta para os seis seguintes. Isso é o desenho, e é
// para ser inofensivo — a fila é reivindicada no banco. O que não era
// inofensivo é o código não saber ler o que o banco respondeu.
// ═══════════════════════════════════════════════════════════════════════════

/** O registro que o Postgres devolve quando o claim NÃO reivindica nada. */
const CLAIM_PERDIDO = {
  id: null,
  course_id: null,
  user_id: null,
  module_index: null,
  status: null,
  attempts: null,
  last_error: null,
  started_at: null,
  finished_at: null,
  created_at: null,
  updated_at: null,
};

/** O registro do worker que ficou com o job. */
const CLAIM_GANHO = {
  id: "7f1c0d2e-0a3b-4c5d-8e9f-a0b1c2d3e4f5",
  course_id: "4f278899-c506-4bd3-b7f6-ea788e4ec186",
  user_id: "33333333-3333-3333-3333-333333333333",
  module_index: 4,
  status: "running",
  attempts: 1,
  last_error: null,
  started_at: "2026-09-08T22:26:01.266Z",
  finished_at: null,
  created_at: "2026-09-08T22:20:00.000Z",
  updated_at: "2026-09-08T22:26:01.266Z",
};

describe("reivindicou", () => {
  it("reconhece o worker que ficou com o job", () => {
    expect(reivindicou(CLAIM_GANHO)).toBe(true);
  });

  it("RECUSA o registro de colunas nulas — o defeito que duplicou o curso", () => {
    // A checagem antiga, escrita aqui para deixar o contraste no arquivo.
    expect(!CLAIM_PERDIDO).toBe(false); // dizia "reivindiquei"
    expect(reivindicou(CLAIM_PERDIDO)).toBe(false); // diz a verdade
  });

  it("recusa null, que é o que a migração `setof` passa a devolver", () => {
    expect(reivindicou(null)).toBe(false);
    expect(reivindicou(undefined)).toBe(false);
  });

  it("recusa qualquer coisa que não seja um registro com id preenchido", () => {
    expect(reivindicou({})).toBe(false);
    expect(reivindicou({ id: "" })).toBe(false);
    expect(reivindicou({ status: "running" })).toBe(false);
    expect(reivindicou([])).toBe(false);
    expect(reivindicou("ok")).toBe(false);
    expect(reivindicou(0)).toBe(false);
  });

  it("não aceita id de outro tipo — um número não é uuid de job", () => {
    expect(reivindicou({ id: 1 })).toBe(false);
  });

  it("os 12 workers do curso 4f278899: 6 ficam com o job, 6 desistem", () => {
    // Cada par disputou a MESMA linha (o lock de 613, 679 e 722 ms no log
    // prova isso em três dos seis pares). Com a leitura certa, um de cada par
    // gera o módulo e o outro sai com 409.
    const respostas = [0, 1, 2, 3, 4, 5].flatMap((n) => [
      { ...CLAIM_GANHO, module_index: n + 2, id: `job-${n}` },
      CLAIM_PERDIDO,
    ]);
    expect(respostas.filter(reivindicou)).toHaveLength(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A CAMADA QUE NÃO DEPENDE DE NINGUÉM ACERTAR
//
// O claim e o portão de execução única reduzem desperdício: eles evitam que
// dois workers façam o mesmo trabalho. Só o índice único
// `course_modules (course_id, order_index)` evita que o trabalho duplicado
// CHEGUE ao curso — é a única garantia que sobrevive a um erro de leitura como
// o de cima.
//
// MEDIDO em Postgres 16.13:
//
//   índice com duplicata já na tabela ... falha, e nomeia a chave duplicada
//   segundo insert na mesma posição .... 23505, duplicate key value
// ═══════════════════════════════════════════════════════════════════════════

describe("moduloJaGravado", () => {
  it("reconhece o 23505 do índice de posição", () => {
    // A forma real que o supabase-js entrega.
    expect(moduloJaGravado({
      code: "23505",
      details: 'Key (course_id, order_index)=(4f278899…, 3) already exists.',
      hint: null,
      message: 'duplicate key value violates unique constraint "course_modules_curso_ordem_uniq"',
    })).toBe(true);
  });

  it("não confunde com outros erros do banco", () => {
    expect(moduloJaGravado({ code: "23503", message: "foreign key" })).toBe(false);
    expect(moduloJaGravado({ code: "PGRST116", message: "no rows" })).toBe(false);
    expect(moduloJaGravado({ message: 'duplicate key value violates unique constraint' })).toBe(false);
    expect(moduloJaGravado(null)).toBe(false);
    expect(moduloJaGravado(undefined)).toBe(false);
    expect(moduloJaGravado("23505")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O PORTÃO RODOU 5 VEZES PARA UM CURSO SÓ
//
// A checagem antiga era uma CONTAGEM seguida de uma decisão, em duas idas ao
// banco. Entre uma e outra cabe outro worker fazendo o mesmo.
//
// `try_claim_quality_gate` junta as duas num UPDATE condicional. MEDIDO em
// Postgres 16.13, rodando o arquivo da migração sem edição:
//
//   com um job ainda 'running' ......... false
//   duas transações simultâneas ........ A true, B false (B esperou o lock)
//   3o, 4o e 5o workers ................ false
//   fila volta a se mexer (regeração) .. TRUE — o portão reabre sozinho
//   e fecha de novo .................... false
//   coluna zerada à mão ................ true
//
// A reabertura existe porque "reivindicado uma vez, para sempre" bloquearia em
// silêncio qualquer reavaliação futura. A condição compara `claimed_at` com o
// último `updated_at` da fila: dentro de um mesmo fechamento a marca é sempre
// mais recente que a fila, e um fechamento novo a ultrapassa.
//
// O app já mostra o laudo mais recente (`order by created_at desc limit 1`, em
// CourseQualityReport.tsx), então "a última vence" sempre foi verdade do lado
// da leitura. O que faltava era a última ser a única — sem isso, um worker que
// fecha enquanto outro ainda escreve grava um laudo sobre um curso incompleto,
// e basta ele ser o último a gravar para o usuário ver esse veredito.
// ═══════════════════════════════════════════════════════════════════════════

describe("ganhouOPortao", () => {
  it("só o true do banco autoriza rodar o portão", () => {
    expect(ganhouOPortao(true)).toBe(true);
  });

  it("recusa tudo que não é true — inclusive o que 'parece' sim", () => {
    expect(ganhouOPortao(false)).toBe(false);
    expect(ganhouOPortao(null)).toBe(false);
    expect(ganhouOPortao(undefined)).toBe(false);
    // As formas que uma leitura por veracidade trataria como sim.
    expect(ganhouOPortao("false")).toBe(false);
    expect(ganhouOPortao(1)).toBe(false);
    expect(ganhouOPortao({})).toBe(false);
    expect(ganhouOPortao([])).toBe(false);
  });
});
