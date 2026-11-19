import { describe, expect, it } from "vitest";
import {
  motivoDasRecusas, selecionarArquivos, type RegrasDeSelecao,
} from "@/lib/selecao-de-arquivos";

// ═══════════════════════════════════════════════════════════════════════════
// O campo de PDF aceitava um arquivo por clique, e o arrastar pegava só o
// primeiro da pilha. O resto era descartado sem aviso. Quem anexou o capítulo 4
// de um manual e arrastou o capítulo das definições junto recebeu um curso
// gerado a partir de um capítulo só.
//
// O teste que importa aqui é o do limite numa chamada só: é a forma exata em
// que eu já errei este conserto uma vez, no wizard, onde o laço conferia um
// contador que não muda entre iterações.
// ═══════════════════════════════════════════════════════════════════════════

const REGRAS: RegrasDeSelecao = {
  extensoes: ["pdf", "docx"],
  tamanhoMaxBytes: 50 * 1024 * 1024,
  maxArquivos: 3,
};

function arquivo(nome: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], nome, { type: "application/pdf" });
}

const nomes = (fs: File[]) => fs.map((f) => f.name);

describe("seleção de vários arquivos de uma vez", () => {
  it("aceita os dois capítulos numa escolha só", () => {
    const r = selecionarArquivos(
      [arquivo("cap4.pdf"), arquivo("cap-definicoes.pdf")], [], REGRAS,
    );
    expect(nomes(r.aceitos)).toEqual(["cap4.pdf", "cap-definicoes.pdf"]);
    expect(r.recusados).toEqual([]);
  });

  it("preserva a ordem em que o usuário escolheu", () => {
    // A primeira análise é a que preenche título, tema e público do curso, então
    // a ordem não é cosmética.
    const r = selecionarArquivos(
      [arquivo("c.pdf"), arquivo("a.pdf"), arquivo("b.pdf")], [], REGRAS,
    );
    expect(nomes(r.aceitos)).toEqual(["c.pdf", "a.pdf", "b.pdf"]);
  });

  it("soma à lista que já existia, sem apagá-la", () => {
    const r = selecionarArquivos([arquivo("novo.pdf")], [arquivo("antigo.pdf")], REGRAS);
    expect(nomes(r.aceitos)).toEqual(["novo.pdf"]);
  });
});

describe("o limite é conferido contra a lista que cresce", () => {
  it("CINCO arquivos numa chamada só, limite 3: entram 3 e sobram 2 recusados", () => {
    // ESTE é o defeito que eu cometi na primeira versão deste conserto: contar
    // as vagas uma vez, antes do laço, contra um valor que não muda durante ele.
    const r = selecionarArquivos(
      ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"].map((n) => arquivo(n)), [], REGRAS,
    );
    expect(nomes(r.aceitos)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(r.recusados.map((x) => x.nome)).toEqual(["d.pdf", "e.pdf"]);
    expect(r.recusados[0].motivo).toContain("limite de 3");
  });

  it("conta o que já estava na lista, não só o desta escolha", () => {
    const r = selecionarArquivos(
      [arquivo("c.pdf"), arquivo("d.pdf")],
      [arquivo("a.pdf"), arquivo("b.pdf")],
      REGRAS,
    );
    expect(nomes(r.aceitos)).toEqual(["c.pdf"]);
    expect(r.recusados.map((x) => x.nome)).toEqual(["d.pdf"]);
  });

  it("lista cheia recusa tudo, e nada entra por engano", () => {
    const cheia = [arquivo("a.pdf"), arquivo("b.pdf"), arquivo("c.pdf")];
    const r = selecionarArquivos([arquivo("d.pdf")], cheia, REGRAS);
    expect(r.aceitos).toEqual([]);
    expect(r.recusados).toHaveLength(1);
  });

  it("limite de 1 continua funcionando como campo de um arquivo", () => {
    const r = selecionarArquivos(
      [arquivo("a.pdf"), arquivo("b.pdf")], [], { ...REGRAS, maxArquivos: 1 },
    );
    expect(nomes(r.aceitos)).toEqual(["a.pdf"]);
    expect(r.recusados[0].motivo).toContain("limite de 1 arquivo");
  });
});

describe("o que é recusado, e com que motivo dito", () => {
  it("formato não aceito é recusado com o formato no texto", () => {
    const r = selecionarArquivos([arquivo("planilha.xlsx")], [], REGRAS);
    expect(r.aceitos).toEqual([]);
    expect(r.recusados[0].motivo).toContain(".xlsx");
    expect(r.recusados[0].motivo).toContain("PDF");
  });

  it("arquivo sem extensão nenhuma é recusado", () => {
    const r = selecionarArquivos([arquivo("manual")], [], REGRAS);
    expect(r.aceitos).toEqual([]);
    expect(r.recusados).toHaveLength(1);
  });

  it("extensão maiúscula é aceita — .PDF é PDF", () => {
    const r = selecionarArquivos([arquivo("MANUAL.PDF")], [], REGRAS);
    expect(nomes(r.aceitos)).toEqual(["MANUAL.PDF"]);
  });

  it("arquivo acima do tamanho é recusado com o limite em MB", () => {
    const r = selecionarArquivos(
      [arquivo("gigante.pdf", 2048)], [], { ...REGRAS, tamanhoMaxBytes: 1024 },
    );
    expect(r.aceitos).toEqual([]);
    expect(r.recusados[0].motivo).toContain("maior que o limite");
  });

  it("o mesmo arquivo arrastado duas vezes não entra duas vezes", () => {
    const r = selecionarArquivos([arquivo("cap4.pdf")], [arquivo("cap4.pdf")], REGRAS);
    expect(r.aceitos).toEqual([]);
    expect(r.recusados[0].motivo).toBe("já estava na lista");
  });

  it("duas cópias do mesmo nome na MESMA escolha: entra uma", () => {
    const r = selecionarArquivos([arquivo("cap4.pdf"), arquivo("cap4.pdf")], [], REGRAS);
    expect(nomes(r.aceitos)).toEqual(["cap4.pdf"]);
    expect(r.recusados).toHaveLength(1);
  });

  it("o bom passa junto com o ruim — um arquivo errado não derruba a escolha", () => {
    // Arrastar três arquivos e acertar dois deve aproveitar os dois.
    const r = selecionarArquivos(
      [arquivo("cap4.pdf"), arquivo("foto.png"), arquivo("cap5.pdf")], [], REGRAS,
    );
    expect(nomes(r.aceitos)).toEqual(["cap4.pdf", "cap5.pdf"]);
    expect(r.recusados.map((x) => x.nome)).toEqual(["foto.png"]);
  });

  it("escolha vazia não quebra e não recusa nada", () => {
    expect(selecionarArquivos([], [], REGRAS)).toEqual({ aceitos: [], recusados: [] });
  });
});

describe("a frase das recusas", () => {
  it("sem recusa nenhuma não há frase", () => {
    expect(motivoDasRecusas([])).toBeNull();
  });

  it("cada recusa aparece com nome e motivo", () => {
    const f = motivoDasRecusas([
      { nome: "foto.png", motivo: "formato .png não aceito" },
      { nome: "d.pdf", motivo: "limite de 3 arquivos" },
    ]);
    expect(f).toContain("foto.png");
    expect(f).toContain("d.pdf");
    expect(f).toContain("limite de 3");
  });
});
