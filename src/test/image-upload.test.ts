import { describe, expect, it } from "vitest";
import { CORES_MINIMAS_DE_FOTO, LARGURA_MAXIMA, TAMANHO_MAXIMO_MB, altDoUpload, caminhoDoUpload, extensaoDoBlob, medidaReduzida, pareceFotografia, validarArquivo } from "../lib/image-upload";

// ═══════════════════════════════════════════════════════════════════════════
// Envio de imagem do computador do autor, ao lado do Pexels e da geração por
// IA. Três decisões carregam risco e por isso estão testadas:
//
//  • WebP recusado — o jsPDF não o desenha, e a imagem apareceria nos slides e
//    sumiria da apostila. Defeito que só aparece num formato é o pior tipo.
//  • Redução no navegador — foto de celular tem 4 a 12 MB e vai para dentro do
//    PPTX em base64, onde já esbarramos no limite de CPU da edge function.
//  • Caminho no bucket — a política exige que a PRIMEIRA pasta seja o id do
//    usuário. Errar isso não dá erro de sintaxe: dá acesso negado, ou pior,
//    arquivo visível para quem não deveria.
// ═══════════════════════════════════════════════════════════════════════════

const arq = (type: string, mb = 1, name = "foto") => ({
  type,
  size: Math.round(mb * 1024 * 1024),
  name,
});

describe("validarArquivo — o que entra", () => {
  it("aceita JPEG e PNG, dizendo a extensão", () => {
    expect(validarArquivo(arq("image/jpeg"))).toEqual({ ok: true, extensao: "jpg" });
    expect(validarArquivo(arq("image/png"))).toEqual({ ok: true, extensao: "png" });
  });

  it("aceita o tipo em caixa alta, que alguns navegadores mandam", () => {
    expect(validarArquivo(arq("IMAGE/JPEG")).ok).toBe(true);
  });
});

describe("validarArquivo — o que não entra, e por quê", () => {
  it("recusa WebP EXPLICANDO o motivo, não com 'formato inválido'", () => {
    const r = validarArquivo(arq("image/webp"));
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/PDF/i);
    expect(r.motivo).toMatch(/JPG ou PNG/i);
  });

  it("recusa PDF, SVG e GIF", () => {
    for (const t of ["application/pdf", "image/svg+xml", "image/gif"]) {
      expect(validarArquivo(arq(t)).ok, t).toBe(false);
    }
  });

  it("recusa arquivo acima do teto, dizendo qual é o teto", () => {
    const r = validarArquivo(arq("image/jpeg", TAMANHO_MAXIMO_MB + 1));
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain(String(TAMANHO_MAXIMO_MB));
  });

  it("recusa arquivo vazio e ausência de arquivo", () => {
    expect(validarArquivo(arq("image/jpeg", 0)).ok).toBe(false);
    expect(validarArquivo(null).ok).toBe(false);
    expect(validarArquivo(undefined).ok).toBe(false);
  });
});

describe("medidaReduzida", () => {
  it("reduz mantendo a proporção", () => {
    const m = medidaReduzida(4032, 3024);
    expect(m.largura).toBe(LARGURA_MAXIMA);
    expect(m.altura).toBe(Math.round(3024 * (LARGURA_MAXIMA / 4032)));
    expect(m.largura / m.altura).toBeCloseTo(4032 / 3024, 2);
  });

  it("NÃO amplia imagem já pequena — esticar não cria detalhe, só peso", () => {
    expect(medidaReduzida(800, 600)).toEqual({ largura: 800, altura: 600 });
  });

  it("imagem em pé também é tratada pela largura", () => {
    const m = medidaReduzida(3024, 4032);
    expect(m.largura).toBe(LARGURA_MAXIMA);
    expect(m.altura).toBeGreaterThan(m.largura);
  });

  it("altura nunca chega a zero, por mais achatada que seja a imagem", () => {
    expect(medidaReduzida(10000, 3).altura).toBeGreaterThanOrEqual(1);
  });

  it("dimensão inválida devolve zero em vez de NaN", () => {
    expect(medidaReduzida(0, 100)).toEqual({ largura: 0, altura: 0 });
    expect(medidaReduzida(NaN, NaN)).toEqual({ largura: 0, altura: 0 });
  });
});

describe("caminhoDoUpload — a política do bucket é literal", () => {
  const uid = "8b1e0c2a-1111-2222-3333-444455556666";

  it("a PRIMEIRA pasta é o id do usuário — é o que a política exige", () => {
    expect(caminhoDoUpload(uid, "module", "mod-1", "jpg").split("/")[0]).toBe(uid);
  });

  it("distingue módulo de capa", () => {
    expect(caminhoDoUpload(uid, "module", "m1", "png")).toBe(`${uid}/module-upload-m1.png`);
    expect(caminhoDoUpload(uid, "cover", "c1", "jpg")).toBe(`${uid}/course-cover-upload-c1.jpg`);
  });

  it("o caminho é estável por módulo — reenviar substitui, não acumula", () => {
    expect(caminhoDoUpload(uid, "module", "m1", "jpg"))
      .toBe(caminhoDoUpload(uid, "module", "m1", "jpg"));
  });

  it("id hostil não escapa da pasta do usuário", () => {
    const p = caminhoDoUpload(uid, "module", "../../outro-usuario/x", "jpg");
    expect(p.split("/")[0]).toBe(uid);
    expect(p).not.toContain("..");
    expect(p.split("/")).toHaveLength(2);
  });
});

describe("altDoUpload", () => {
  it("usa a descrição do autor quando ela existe", () => {
    expect(altDoUpload("Organograma da Secretaria de Finanças", "Controle"))
      .toBe("Organograma da Secretaria de Finanças");
  });

  it("sem descrição, diz o que se sabe — sem inventar o que a foto mostra", () => {
    expect(altDoUpload("", "Execução Orçamentária"))
      .toBe("Ilustração do módulo Execução Orçamentária");
    expect(altDoUpload(null, "Execução Orçamentária"))
      .toBe("Ilustração do módulo Execução Orçamentária");
  });

  it("sem descrição e sem título, ainda devolve algo legível", () => {
    expect(altDoUpload(undefined, "")).toBe("Ilustração do módulo");
  });

  it("descrição muito longa é limitada", () => {
    expect(altDoUpload("a".repeat(400), "M").length).toBeLessThanOrEqual(180);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FOTOGRAFIA EM PNG É DESPERDÍCIO QUE SE PAGA EM TODA EXPORTAÇÃO
//
// A foto do módulo 2 do curso de precificação — moedas sobre um catálogo, 940
// por 627 — chegou por upload em PNG e ficou PNG: 1105 KB, e 54 ms de CPU em
// CADA exportação, contra 2 ms se fosse JPEG. Nos logs de um curso de 8 módulos
// as imagens comeram 78% da CPU do export.
//
// Converter tudo seria pior. JPEG não tem canal alfa — um logotipo com fundo
// transparente sairia com fundo preto — e borra bordas duras, deixando ilegível
// a captura de uma planilha.
//
// A separação medida nas seis imagens reais dos cursos e num gráfico de barras,
// contando cores distintas em 4000 pixels amostrados:
//
//     fotografias .............. 509, 533, 651, 673, 813, 976
//     gráfico de barras ........ 3
//
// O piso de 200 fica com 2,5x de folga abaixo da foto mais pobre e 66x acima do
// gráfico. É ALTO de propósito: errar para cima mantém o PNG, que é o
// comportamento de hoje; errar para baixo borra texto, que é dano visível.
// ═══════════════════════════════════════════════════════════════════════════

/** RGBA cru, como `ctx.getImageData().data` devolve. */
function pixels(n: number, cor: (i: number) => [number, number, number, number]) {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b, a] = cor(i);
    d.set([r, g, b, a], i * 4);
  }
  return d;
}

describe("pareceFotografia", () => {
  // Gerador determinístico com Math.imul: a multiplicação direta estoura a
  // precisão do número em JavaScript e degenera a sequência — o primeiro
  // "ruído" que escrevi aqui produzia poucas cores e reprovava uma foto.
  function ruido(semente: number) {
    let s = semente >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return (s >>> 16) & 0xff;
    };
  }

  it("fotografia: muitas cores, sem transparência", () => {
    const r = ruido(1);
    expect(pareceFotografia(pixels(6000, () => [r(), r(), r(), 255]))).toBe(true);
  });

  it("gráfico de barras: poucas cores, fica PNG", () => {
    const paleta: Array<[number, number, number, number]> = [
      [255, 255, 255, 255], [30, 90, 160, 255], [0, 0, 0, 255],
    ];
    expect(pareceFotografia(pixels(6000, (i) => paleta[i % 3]))).toBe(false);
  });

  it("logotipo com transparência fica PNG mesmo com muitas cores", () => {
    // Sem esta guarda o fundo transparente viraria preto no JPEG.
    const r = ruido(7);
    const d = pixels(6000, () => [r(), r(), r(), 255]);
    d[3] = 0; // um único pixel transparente basta
    expect(pareceFotografia(d)).toBe(false);
  });

  it("amostra pequena demais não decide, e na dúvida fica PNG", () => {
    expect(pareceFotografia(pixels(10, () => [1, 2, 3, 255]))).toBe(false);
    expect(pareceFotografia(new Uint8ClampedArray(0))).toBe(false);
  });

  it("o piso é o medido, não um número redondo qualquer", () => {
    // Exatamente CORES_MINIMAS_DE_FOTO cores distintas passa; uma a menos, não.
    const comNCores = (n: number) =>
      pixels(6000, (i) => {
        const c = i % n;
        return [(c % 32) << 3, ((c >> 5) % 32) << 3, ((c >> 10) % 32) << 3, 255];
      });
    expect(pareceFotografia(comNCores(CORES_MINIMAS_DE_FOTO))).toBe(true);
    expect(pareceFotografia(comNCores(CORES_MINIMAS_DE_FOTO - 1))).toBe(false);
  });
});

describe("extensaoDoBlob", () => {
  it("segue o RESULTADO da redução, não o arquivo de entrada", () => {
    // A redução converte foto PNG em JPEG. Derivar do original gravaria bytes
    // de JPEG num caminho terminado em `.png`.
    expect(extensaoDoBlob(new Blob([], { type: "image/jpeg" }), "png")).toBe("jpg");
    expect(extensaoDoBlob(new Blob([], { type: "image/png" }), "jpg")).toBe("png");
  });

  it("tipo desconhecido cai no padrão de quem chamou", () => {
    expect(extensaoDoBlob(new Blob([], { type: "" }), "png")).toBe("png");
  });
});
