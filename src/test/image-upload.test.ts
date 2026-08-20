import { describe, expect, it } from "vitest";
import {
  altDoUpload,
  caminhoDoUpload,
  LARGURA_MAXIMA,
  medidaReduzida,
  TAMANHO_MAXIMO_MB,
  validarArquivo,
} from "../lib/image-upload";

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
