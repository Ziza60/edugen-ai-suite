import { describe, expect, it, vi } from "vitest";
import {
  baixarImagem,
  buscarImagensDosModulos,
  escaparAtributo,
  figuraHtml,
  figuraMarkdown,
  nomeDoArquivoNoPacote,
} from "../../supabase/functions/_shared/course-images";

// ═══════════════════════════════════════════════════════════════════════════
// SCORM, Moodle e Notion não liam course_images: quem comprava o curso por
// esses canais recebia o material sem as imagens que o autor pagou para gerar,
// e nada acusava a falta. Estes testes cobrem a peça comum aos três — em
// especial o escape, porque o alt_text é texto de IA sobre o que o autor
// digitou e vai parar dentro de atributo HTML e de link markdown.
// ═══════════════════════════════════════════════════════════════════════════

function clienteFalso(
  linhas: Array<{ module_id: string; url: string; alt_text: string | null }> | null,
  error: { message: string } | null = null,
) {
  return {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: linhas, error }),
      }),
    }),
  };
}

describe("buscarImagensDosModulos", () => {
  it("indexa por module_id", async () => {
    const m = await buscarImagensDosModulos(
      clienteFalso([
        { module_id: "m1", url: "https://x/1.jpg", alt_text: "Gráfico" },
        { module_id: "m2", url: "https://x/2.png", alt_text: "Fluxo" },
      ]),
      ["m1", "m2"],
      "teste",
    );
    expect(m.size).toBe(2);
    expect(m.get("m1")).toEqual({ url: "https://x/1.jpg", altText: "Gráfico" });
  });

  it("não consulta quando não há módulo", async () => {
    const client = clienteFalso(null);
    const espia = vi.spyOn(client, "from");
    expect((await buscarImagensDosModulos(client, [], "teste")).size).toBe(0);
    expect(espia).not.toHaveBeenCalled();
  });

  it("erro de consulta não derruba a exportação — devolve mapa vazio", async () => {
    const m = await buscarImagensDosModulos(
      clienteFalso(null, { message: "permissão negada" }),
      ["m1"],
      "teste",
    );
    expect(m.size).toBe(0);
  });

  it("exceção também é absorvida", async () => {
    const explode = {
      from: () => {
        throw new Error("rede caiu");
      },
    };
    expect((await buscarImagensDosModulos(explode, ["m1"], "teste")).size).toBe(0);
  });

  it("linha sem url é descartada", async () => {
    const m = await buscarImagensDosModulos(
      clienteFalso([{ module_id: "m1", url: "", alt_text: "x" }]),
      ["m1"],
      "teste",
    );
    expect(m.size).toBe(0);
  });

  it("alt vazio ganha um texto padrão — leitor de tela precisa de algo", async () => {
    const m = await buscarImagensDosModulos(
      clienteFalso([{ module_id: "m1", url: "https://x/1.jpg", alt_text: "   " }]),
      ["m1"],
      "teste",
    );
    expect(m.get("m1")!.altText).toBe("Imagem do módulo");
  });
});

describe("escaparAtributo", () => {
  it("escapa a aspa, que é o que fecha o atributo", () => {
    // O escapeHtml que já existia no export-scorm não cobre aspas: um alt com
    // aspa escaparia de alt="…" e o resto viraria marcação.
    expect(escaparAtributo('Imagem IA: uma "mesa" institucional'))
      .toBe("Imagem IA: uma &quot;mesa&quot; institucional");
  });

  it("escapa & < > e aspa simples", () => {
    expect(escaparAtributo(`<b>a&b</b> 'x'`))
      .toBe("&lt;b&gt;a&amp;b&lt;/b&gt; &#39;x&#39;");
  });

  it("escapa o & antes dos outros, sem duplicar", () => {
    expect(escaparAtributo("a & b")).toBe("a &amp; b");
    expect(escaparAtributo("&lt;")).toBe("&amp;lt;");
  });
});

describe("figuraHtml", () => {
  it("monta figure com img e alt", () => {
    const h = figuraHtml("assets/modulo-1.jpg", "Fluxo de aprovação");
    expect(h).toContain('src="assets/modulo-1.jpg"');
    expect(h).toContain('alt="Fluxo de aprovação"');
  });

  // O alt responde a "o que a foto mostra"; legenda responderia a "o que esta
  // imagem tem a ver com a lição". Publicar um pelo outro pôs "Profissionais de
  // negócios discutindo amostras de design de interiores" sob a imagem de um
  // módulo de orçamento público. Foi tirado da apostila em PDF e aqui tinha
  // ficado. O alt fica — no HTML ele é lido por leitor de tela de verdade.
  it("não repete o alt como legenda visível", () => {
    const h = figuraHtml("assets/modulo-1.jpg", "Profissionais discutindo design de interiores");
    expect(h).not.toContain("<figcaption");
    expect(h.match(/Profissionais discutindo/g) ?? []).toHaveLength(1);
  });

  it("não deixa alt hostil quebrar o atributo", () => {
    const h = figuraHtml("x.jpg", '" onerror="alert(1)');
    expect(h).not.toContain('onerror="alert(1)"');
    expect(h).toContain("&quot;");
  });

  it("escapa também o & da URL assinada", () => {
    // URL do storage vem com ?token=…&v=…; & cru em atributo é HTML inválido.
    expect(figuraHtml("https://x/i.jpg?token=a&v=1", "a")).toContain("token=a&amp;v=1");
  });
});

describe("figuraMarkdown", () => {
  it("monta ![alt](<url>)", () => {
    expect(figuraMarkdown("https://x/1.jpg", "Gráfico de barras"))
      .toBe("![Gráfico de barras](<https://x/1.jpg>)");
  });

  it("põe a URL entre <> para o token não cortar o link", () => {
    const md = figuraMarkdown("https://x/1.jpg?token=abc&v=9", "a");
    expect(md).toContain("<https://x/1.jpg?token=abc&v=9>");
  });

  it("tira colchetes do alt, que fechariam o rótulo antes da hora", () => {
    expect(figuraMarkdown("u", "Imagem [IA]: teste")).toBe("![Imagem IA: teste](<u>)");
  });

  it("achata quebras de linha do alt", () => {
    expect(figuraMarkdown("u", "linha um\nlinha dois")).toBe("![linha um linha dois](<u>)");
  });
});

describe("nomeDoArquivoNoPacote", () => {
  it("usa a extensão do caminho, não da query", () => {
    // A URL assinada termina em ?token=…; pegar o que vem após o último ponto
    // devolveria pedaço de token como se fosse extensão.
    expect(nomeDoArquivoNoPacote("https://x/img.png?token=ab.cd&v=1", 0))
      .toBe("assets/modulo-1.png");
  });

  it("numera a partir de 1", () => {
    expect(nomeDoArquivoNoPacote("https://x/a.jpg", 4)).toBe("assets/modulo-5.jpg");
  });

  it("sem extensão reconhecível cai em jpg", () => {
    expect(nomeDoArquivoNoPacote("https://images.pexels.com/photos/12345", 0))
      .toBe("assets/modulo-1.jpg");
  });

  it("extensão estranha não vira nome de arquivo", () => {
    expect(nomeDoArquivoNoPacote("https://x/a.exe", 0)).toBe("assets/modulo-1.jpg");
  });

  it("normaliza a caixa da extensão", () => {
    expect(nomeDoArquivoNoPacote("https://x/A.PNG", 0)).toBe("assets/modulo-1.png");
  });

  it("ignora fragmento além da query", () => {
    expect(nomeDoArquivoNoPacote("https://x/a.gif#topo", 0)).toBe("assets/modulo-1.gif");
  });
});

describe("baixarImagem", () => {
  it("devolve os bytes quando a resposta é boa", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as never;
    expect(await baixarImagem("https://x/1.jpg", "teste")).toEqual(new Uint8Array([1, 2, 3]));
    globalThis.fetch = original;
  });

  it("resposta ruim devolve null, sem lançar", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as never;
    expect(await baixarImagem("https://x/1.jpg", "teste")).toBeNull();
    globalThis.fetch = original;
  });

  it("rede caindo devolve null, sem lançar", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as never;
    expect(await baixarImagem("https://x/1.jpg", "teste")).toBeNull();
    globalThis.fetch = original;
  });
});
