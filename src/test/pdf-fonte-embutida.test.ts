import { describe, expect, it, vi } from "vitest";
import {
  apenasDesenhaveis,
  edusansDesenha,
} from "../../supabase/functions/_shared/pdf-layout";
import {
  EDUSANS,
  glifosDaFonte,
  registrarEduSans,
} from "../../supabase/functions/_shared/fontes/edusans";
import { EDUSANS_NORMAL } from "../../supabase/functions/_shared/fontes/edusans-normal";
import { EDUSANS_BOLD } from "../../supabase/functions/_shared/fontes/edusans-bold";
import { EDUSANS_ITALIC } from "../../supabase/functions/_shared/fontes/edusans-italic";

// ═══════════════════════════════════════════════════════════════════════════
// A FONTE EMBUTIDA
//
// O PDF usava Helvetica, que não é embutida no arquivo e cujo repertório
// garantido para no Latin-1. Tudo acima disso era traduzido — "≥" virava ">=" —
// ou removido em silêncio. Foi a remoção que doeu: num curso de estoque, o √
// sumiu e a apostila passou a afirmar que 40000 é 200.
//
// Com EduSans (subconjunto da Liberation Sans) embutida, o símbolo é desenhado
// como foi escrito. Estes testes cobrem as três coisas que podem dar errado:
//
//   1. o registro falhar e derrubar a exportação inteira;
//   2. o texto perder caracteres que a fonte sabe desenhar;
//   3. o repertório declarado divergir dos glifos que a fonte realmente tem —
//      o pior dos três, porque o leitor desenha um retângulo vazio e ninguém
//      descobre até o material chegar ao cliente.
// ═══════════════════════════════════════════════════════════════════════════

// ── um jsPDF de mentira, só com o que registrarEduSans toca ────────────────
function docFalso(opts: { listaVazia?: boolean; semLista?: boolean; explode?: boolean } = {}) {
  const vfs: Record<string, string> = {};
  const familias: Record<string, string[]> = { helvetica: ["normal", "bold", "italic"] };
  return {
    vfs,
    familias,
    addFileToVFS(nome: string, dados: string) {
      if (opts.explode) throw new Error("VFS cheio");
      vfs[nome] = dados;
    },
    addFont(_arquivo: string, familia: string, estilo: string) {
      if (opts.listaVazia) return; // registrou "com sucesso" e não registrou nada
      (familias[familia] ??= []).push(estilo);
    },
    getFontList: opts.semLista ? undefined : () => familias,
  };
}

describe("registrarEduSans", () => {
  it("embute as três variantes e devolve true", () => {
    const doc = docFalso();
    expect(registrarEduSans(doc)).toBe(true);
    expect(Object.keys(doc.vfs).sort()).toEqual([
      "EduSans-bold.ttf",
      "EduSans-italic.ttf",
      "EduSans-normal.ttf",
    ]);
    expect(doc.familias[EDUSANS].sort()).toEqual(["bold", "italic", "normal"]);
  });

  it("devolve false quando o jsPDF não reconheceu a família", () => {
    // addFont que falha em silêncio. Sem esta checagem, cada linha do documento
    // pediria uma fonte inexistente.
    expect(registrarEduSans(docFalso({ listaVazia: true }))).toBe(false);
  });

  it("aceita um jsPDF sem getFontList", () => {
    expect(registrarEduSans(docFalso({ semLista: true }))).toBe(true);
  });

  it("não lança quando o registro explode — devolve false e o PDF sai em Helvetica", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(registrarEduSans(docFalso({ explode: true }))).toBe(false);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe("os dados da fonte", () => {
  const faces: Array<[string, string]> = [
    ["normal", EDUSANS_NORMAL],
    ["bold", EDUSANS_BOLD],
    ["italic", EDUSANS_ITALIC],
  ];

  it.each(faces)("%s é base64 de um TrueType de verdade", (_nome, dados) => {
    expect(dados.length).toBeGreaterThan(10_000);
    expect(dados).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // sfntVersion 0x00010000 — o cabeçalho de todo TrueType.
    expect(bytes(dados).slice(0, 4)).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it("as três variantes são fontes diferentes", () => {
    expect(new Set(faces.map(([, d]) => d)).size).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O REPERTÓRIO VEM DA FONTE, NÃO DE UMA LISTA
//
// A primeira versão mantinha à mão a lista de intervalos que o gerador
// consultava. Estes testes a pegaram divergindo da fonte na primeira execução:
// ela prometia ∛, ≪, ✓ e ➡, que a Liberation Sans não desenha, e o bloco de
// controle C1 (U+0080–U+009F), que ninguém desenha. Pedir glifo inexistente
// imprime caixa vazia — pior que a tradução que a fonte veio substituir.
//
// Agora `edusansDesenha` lê o cmap do próprio TTF. Não há como divergir do que
// existe; o que resta testar é se a leitura funciona e se a fonte tem mesmo o
// que o curso precisa.
// ═══════════════════════════════════════════════════════════════════════════

/** base64 → bytes, sem depender de Buffer. */
function bytes(b64: string): number[] {
  const bin = atob(b64);
  const out = new Array<number>(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe("o repertório lido do cmap", () => {
  it("tem tamanho de fonte de verdade", () => {
    expect(glifosDaFonte().size).toBeGreaterThan(300);
  });

  it("é o mesmo objeto nas chamadas seguintes — lê o cmap uma vez só", () => {
    expect(glifosDaFonte()).toBe(glifosDaFonte());
  });

  it("não promete o bloco de controle C1, que fonte nenhuma desenha", () => {
    for (let cp = 0x7f; cp <= 0x9f; cp++) {
      expect(edusansDesenha(cp)).toBe(false);
    }
  });

  it.each([
    ["√", 0x221a],
    ["≥", 0x2265],
    ["≤", 0x2264],
    ["≠", 0x2260],
    ["≈", 0x2248],
    ["∑", 0x2211],
    ["∏", 0x220f],
    ["∞", 0x221e],
    ["Δ", 0x0394],
    ["π", 0x03c0],
    ["→", 0x2192],
    ["←", 0x2190],
    ["•", 0x2022],
    ["—", 0x2014],
    ["\u201C", 0x201c],
    ["…", 0x2026],
    ["€", 0x20ac],
    ["⅓", 0x2153],
    ["⁶", 0x2076],
  ])("a fonte desenha %s", (_c, cp) => {
    expect(edusansDesenha(cp)).toBe(true);
  });

  it("o português inteiro está lá", () => {
    for (const ch of "áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇºª§") {
      expect(edusansDesenha(ch.codePointAt(0)!)).toBe(true);
    }
  });
});

describe("edusansDesenha", () => {
  it("reconhece o que a fonte tem", () => {
    for (const ch of "aZ0 áç√≥→•Δπ—“…€") {
      expect(edusansDesenha(ch.codePointAt(0)!)).toBe(true);
    }
  });

  it("recusa o que ela não tem", () => {
    for (const ch of "漢字🎯😀") {
      expect(edusansDesenha(ch.codePointAt(0)!)).toBe(false);
    }
  });
});

describe("apenasDesenhaveis", () => {
  it("a raiz quadrada sobrevive — é o defeito que originou tudo isto", () => {
    const f = "LEC = √((2 × D × CP) / CM)";
    expect(apenasDesenhaveis(f)).toBe(f);
    expect(apenasDesenhaveis("LEC = √(40000) = 200")).toBe("LEC = √(40000) = 200");
  });

  it("não traduz nada: ≥ continua ≥, → continua →", () => {
    const t = "Gasto ≥ Mínimo — PPA → LDO → LOA “conforme” a LRF…";
    expect(apenasDesenhaveis(t)).toBe(t);
  });

  it("remove o que a fonte não desenha, com aviso no log", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(apenasDesenhaveis("Total 漢字 final")).toBe("Total  final");
    expect(aviso).toHaveBeenCalled();
    expect(String(aviso.mock.calls[0][0])).toContain("U+6F22");
    aviso.mockRestore();
  });

  it("não faz barulho quando não removeu nada", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    apenasDesenhaveis("Execução orçamentária: √ e ≥ inclusive.");
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("preserva quebra de linha e tabulação — elas são estrutura, não glifo", () => {
    // O splitTextToSize do jsPDF quebra o parágrafo olhando para o \n. Apagá-lo
    // colaria a última palavra de uma linha na primeira da seguinte.
    expect(apenasDesenhaveis("primeira\nsegunda")).toBe("primeira\nsegunda");
    expect(apenasDesenhaveis("col1\tcol2\r\nfim")).toBe("col1\tcol2\r\nfim");
  });

  it("é idempotente", () => {
    const t = "Meta 🎯 de √2 ≥ 1,41";
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const uma = apenasDesenhaveis(t);
    expect(apenasDesenhaveis(uma)).toBe(uma);
    aviso.mockRestore();
  });

  it("vazio e nulo não quebram", () => {
    expect(apenasDesenhaveis("")).toBe("");
    expect(apenasDesenhaveis(null as unknown as string)).toBe("");
    expect(apenasDesenhaveis(undefined as unknown as string)).toBe("");
  });

  it("todo caractere que sai a fonte desenha", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const saida = apenasDesenhaveis("Ação 漢 √ 🎯 ≥ ⚗ π");
    for (const ch of saida) {
      expect(edusansDesenha(ch.codePointAt(0)!)).toBe(true);
    }
    aviso.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O QUE A FONTE NÃO DESENHA
//
// A Liberation Sans não tem ∛, ≪, ≫, ✓, ✗ nem ➡. Apagá-los repetiria, em
// menor escala, o defeito da raiz quadrada — o texto sairia faltando um pedaço
// que mudava o sentido. Então o caminho da fonte embutida traduz esses poucos,
// e só esses, usando o mesmo mapa do caminho da Helvetica.
// ═══════════════════════════════════════════════════════════════════════════

describe("apenasDesenhaveis — o que a fonte não tem, mas dá para dizer", () => {
  it("a raiz cúbica vira texto em vez de sumir da fórmula", () => {
    expect(apenasDesenhaveis("Lado = ∛27 = 3")).toBe("Lado = raiz cubica de 27 = 3");
  });

  it("muito-maior e muito-menor viram sinais de máquina", () => {
    expect(apenasDesenhaveis("Giro ≫ 1 e Ruptura ≪ 1")).toBe("Giro >> 1 e Ruptura << 1");
  });

  it("as marcas de conferência viram palavra", () => {
    expect(apenasDesenhaveis("Contagem ✓ e Divergência ✗")).toBe(
      "Contagem OK e Divergência X",
    );
  });

  it("traduz sem avisar: não houve perda para registrar", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    apenasDesenhaveis("∛8 ≫ ✓");
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("o que a fonte desenha continua sem tradução, mesmo tendo equivalente", () => {
    // ≥ e → estão no mapa de tradução, mas a fonte os desenha: traduzir seria
    // piorar de graça. Esta é a diferença entre os dois caminhos.
    const t = "Gasto ≥ Mínimo, PPA → LDO";
    expect(apenasDesenhaveis(t)).toBe(t);
  });
});
