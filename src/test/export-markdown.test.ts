import { describe, it, expect } from "vitest";
import { linhaDeImagem, montarMarkdownDoCurso } from "@/lib/export-markdown";

const modulos = [
  { id: "m1", title: "Fundamentos", content: "Texto do primeiro módulo." },
  { id: "m2", title: "Aplicação", content: "Texto do segundo módulo." },
];

describe("linhaDeImagem", () => {
  it("monta a linha com alt e url", () => {
    expect(linhaDeImagem("https://x/a.jpg", "Duas pessoas numa reunião", "Módulo 1"))
      .toBe("![Duas pessoas numa reunião](https://x/a.jpg)");
  });

  it("cai no alt padrão quando não há alt_text", () => {
    expect(linhaDeImagem("https://x/a.jpg", null, "Módulo 1"))
      .toBe("![Módulo 1](https://x/a.jpg)");
    expect(linhaDeImagem("https://x/a.jpg", "   ", "Módulo 1"))
      .toBe("![Módulo 1](https://x/a.jpg)");
  });

  it("devolve vazio sem url utilizável", () => {
    expect(linhaDeImagem(null, "alt", "Módulo 1")).toBe("");
    expect(linhaDeImagem("   ", "alt", "Módulo 1")).toBe("");
    expect(linhaDeImagem(undefined, "alt", "Módulo 1")).toBe("");
  });

  it("escapa colchete no alt, que fecharia o link cedo", () => {
    const linha = linhaDeImagem("https://x/a.jpg", "Gráfico [2026] de vendas", "M");
    expect(linha).toBe("![Gráfico \\[2026\\] de vendas](https://x/a.jpg)");
    // O que importa: o primeiro ']' NÃO escapado é o que fecha o alt.
    expect(linha.indexOf("](")).toBe(linha.length - "](https://x/a.jpg)".length);
  });

  it("envolve em <> a url com espaço ou parêntese", () => {
    expect(linhaDeImagem("https://x/a b.jpg", "alt", "M"))
      .toBe("![alt](<https://x/a b.jpg>)");
    expect(linhaDeImagem("https://x/a(1).jpg", "alt", "M"))
      .toBe("![alt](<https://x/a(1).jpg>)");
  });

  it("não envolve url normal", () => {
    expect(linhaDeImagem("https://x/a-1_b.jpg?t=2", "alt", "M"))
      .toContain("](https://x/a-1_b.jpg?t=2)");
  });

  it("colapsa quebras de linha do alt", () => {
    expect(linhaDeImagem("https://x/a.jpg", "duas\nlinhas", "M"))
      .toBe("![duas linhas](https://x/a.jpg)");
  });
});

describe("montarMarkdownDoCurso", () => {
  it("sem imagens, produz exatamente o texto de antes", () => {
    const antes = modulos.map((m) => `# ${m.title}\n\n${m.content}`).join("\n\n---\n\n");
    expect(montarMarkdownDoCurso({ modulos })).toBe(antes);
  });

  it("insere a imagem logo abaixo do título do módulo", () => {
    const md = montarMarkdownDoCurso({
      modulos,
      imagens: [{ module_id: "m1", url: "https://x/1.jpg", alt_text: "Uma reunião" }],
    });
    expect(md.startsWith("# Fundamentos\n\n![Uma reunião](https://x/1.jpg)\n\nTexto do primeiro"))
      .toBe(true);
  });

  it("só ilustra o módulo dono da imagem", () => {
    const md = montarMarkdownDoCurso({
      modulos,
      imagens: [{ module_id: "m2", url: "https://x/2.jpg", alt_text: "Aplicação prática" }],
    });
    expect(md).toContain("# Aplicação\n\n![Aplicação prática](https://x/2.jpg)");
    expect(md).toContain("# Fundamentos\n\nTexto do primeiro módulo.");
  });

  it("põe a capa antes de tudo, com o título do curso no alt", () => {
    const md = montarMarkdownDoCurso({
      modulos,
      capaUrl: "https://x/capa.jpg",
      tituloDoCurso: "Gestão de Estoques",
    });
    expect(md.startsWith("![Capa do curso: Gestão de Estoques](https://x/capa.jpg)\n\n# Fundamentos"))
      .toBe(true);
  });

  it("sem título do curso, a capa ainda tem alt honesto", () => {
    const md = montarMarkdownDoCurso({ modulos, capaUrl: "https://x/capa.jpg" });
    expect(md.startsWith("![Capa do curso](https://x/capa.jpg)")).toBe(true);
  });

  it("mantém o separador entre módulos e o rodapé no fim", () => {
    const md = montarMarkdownDoCurso({
      modulos,
      imagens: [{ module_id: "m1", url: "https://x/1.jpg", alt_text: "a" }],
      rodape: "\n\n---\n\n*Gerado com CourseAI*\n",
    });
    expect(md.split("\n---\n").length).toBe(3); // 1 entre módulos + 1 do rodapé
    expect(md.endsWith("*Gerado com CourseAI*\n")).toBe(true);
  });

  it("não duplica imagem que o conteúdo já referencia", () => {
    const md = montarMarkdownDoCurso({
      modulos: [{ id: "m1", title: "T", content: "Antes.\n\n![x](https://x/1.jpg)\n\nDepois." }],
      imagens: [{ module_id: "m1", url: "https://x/1.jpg", alt_text: "a" }],
    });
    expect(md.match(/https:\/\/x\/1\.jpg/g)).toHaveLength(1);
  });

  it("ignora linha de course_images sem url", () => {
    const md = montarMarkdownDoCurso({
      modulos,
      imagens: [{ module_id: "m1", url: null, alt_text: "a" }],
    });
    expect(md).not.toContain("![");
  });

  it("ignora imagem de módulo que não está no curso", () => {
    const md = montarMarkdownDoCurso({
      modulos,
      imagens: [{ module_id: "m9", url: "https://x/9.jpg", alt_text: "a" }],
    });
    expect(md).not.toContain("https://x/9.jpg");
  });

  it("com duas imagens do mesmo módulo, usa a primeira", () => {
    const md = montarMarkdownDoCurso({
      modulos,
      imagens: [
        { module_id: "m1", url: "https://x/a.jpg", alt_text: "a" },
        { module_id: "m1", url: "https://x/b.jpg", alt_text: "b" },
      ],
    });
    expect(md).toContain("https://x/a.jpg");
    expect(md).not.toContain("https://x/b.jpg");
  });

  it("módulo sem id não quebra a exportação", () => {
    const md = montarMarkdownDoCurso({
      modulos: [{ title: "Sem id", content: "corpo" }],
      imagens: [{ module_id: "m1", url: "https://x/1.jpg", alt_text: "a" }],
    });
    expect(md).toBe("# Sem id\n\ncorpo");
  });

  it("conteúdo nulo continua produzindo o título", () => {
    const md = montarMarkdownDoCurso({ modulos: [{ id: "m1", title: "T", content: null }] });
    expect(md).toBe("# T\n\n");
  });

  it("curso sem módulos não vira arquivo com lixo", () => {
    expect(montarMarkdownDoCurso({ modulos: [] })).toBe("");
    expect(montarMarkdownDoCurso({ modulos: [], capaUrl: "https://x/c.jpg" }))
      .toBe("![Capa do curso](https://x/c.jpg)\n\n");
  });

  it("o alt cai no título do módulo quando alt_text vem vazio", () => {
    const md = montarMarkdownDoCurso({
      modulos,
      imagens: [{ module_id: "m1", url: "https://x/1.jpg", alt_text: "" }],
    });
    expect(md).toContain("![Fundamentos](https://x/1.jpg)");
  });
});
