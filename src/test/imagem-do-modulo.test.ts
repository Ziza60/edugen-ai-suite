import { describe, expect, it, vi } from "vitest";
import { gravarImagemDoModulo } from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// A GRAVAÇÃO DA IMAGEM, SEPARADA DA GERAÇÃO
//
// A imagem era a última coisa da fila e só era tentada com mais de 20 s de
// folga. No curso de estoques de 27/08 dois módulos de oito saíram sem ela —
// justamente os que precisaram de reparo de lição:
//
//   Módulo 4 entregue sem imagem: restam 3s.    (reparo de 20,5 s)
//   Módulo 6 entregue sem imagem: restam 11s.   (reparo de 35,0 s)
//
// Ela nunca dependeu das lições: só do media_brief, que vem no envelope em ~8 s.
// A chamada cara passou a começar ali, e o que sobra no fim é o que estes
// testes cobrem — subir o arquivo e registrar a linha.
// ═══════════════════════════════════════════════════════════════════════════

function clienteFalso(opcoes: { falhaNoUpload?: boolean; semUrl?: boolean } = {}) {
  const upload = vi.fn(
    async (_caminho: string, _bytes: Uint8Array, _opcoesUpload: Record<string, unknown>) => ({
      error: opcoes.falhaNoUpload ? { message: "quota" } : null,
    }),
  );
  const createSignedUrl = vi.fn(async () => ({
    data: opcoes.semUrl ? null : { signedUrl: "https://x/y.jpg?token=abc" },
    error: opcoes.semUrl ? { message: "sem url" } : null,
  }));
  const insert = vi.fn(async () => ({ error: null }));
  return {
    upload, createSignedUrl, insert,
    storage: { from: () => ({ upload, createSignedUrl }) },
    from: () => ({ insert }),
  };
}

const JPEG = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), ext: "jpg" as const, mime: "image/jpeg", alt: "Uma balança" };
const PNG = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), ext: "png" as const, mime: "image/png", alt: "Um gráfico" };

describe("gravarImagemDoModulo", () => {
  it("o caminho e o contentType saem da imagem, não de um palpite", async () => {
    const c = clienteFalso();
    await gravarImagemDoModulo({ serviceClient: c as any, userId: "u1", moduleId: "m1", imagem: JPEG });
    expect(c.upload).toHaveBeenCalledWith("u1/module-m1.jpg", JPEG.bytes, {
      contentType: "image/jpeg", upsert: true,
    });
  });

  it("PNG que não converteu é gravado como PNG", async () => {
    const c = clienteFalso();
    await gravarImagemDoModulo({ serviceClient: c as any, userId: "u1", moduleId: "m1", imagem: PNG });
    expect(c.upload.mock.calls[0][0]).toBe("u1/module-m1.png");
    expect(c.upload.mock.calls[0][2].contentType).toBe("image/png");
  });

  it("a primeira pasta é o id do usuário, que é o que a política do bucket exige", async () => {
    const c = clienteFalso();
    await gravarImagemDoModulo({ serviceClient: c as any, userId: "abc-123", moduleId: "m9", imagem: JPEG });
    expect(c.upload.mock.calls[0][0].split("/")[0]).toBe("abc-123");
  });

  it("registra a linha com a URL assinada e o alt da imagem", async () => {
    const c = clienteFalso();
    await gravarImagemDoModulo({ serviceClient: c as any, userId: "u1", moduleId: "m1", imagem: JPEG });
    expect(c.insert).toHaveBeenCalledWith({
      module_id: "m1", url: "https://x/y.jpg?token=abc", alt_text: "Uma balança",
    });
  });

  it("upload que falha não registra linha órfã em course_images", async () => {
    const c = clienteFalso({ falhaNoUpload: true });
    await gravarImagemDoModulo({ serviceClient: c as any, userId: "u1", moduleId: "m1", imagem: JPEG });
    expect(c.insert).not.toHaveBeenCalled();
  });

  it("sem URL assinada também não registra", async () => {
    const c = clienteFalso({ semUrl: true });
    await gravarImagemDoModulo({ serviceClient: c as any, userId: "u1", moduleId: "m1", imagem: JPEG });
    expect(c.insert).not.toHaveBeenCalled();
  });

  it("não lança quando o insert falha — perder o registro não pode custar o módulo", async () => {
    const c = clienteFalso();
    c.insert.mockImplementationOnce(async () => ({ error: { message: "fk" } }) as any);
    await expect(
      gravarImagemDoModulo({ serviceClient: c as any, userId: "u1", moduleId: "m1", imagem: JPEG }),
    ).resolves.toBeUndefined();
  });
});
