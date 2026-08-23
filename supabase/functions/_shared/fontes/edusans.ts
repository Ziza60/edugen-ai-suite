// ═══════════════════════════════════════════════════════════════════════════
// EduSans — a fonte do PDF, embutida
//
// O QUE ISTO RESOLVE
//
// O PDF usava Helvetica, uma das catorze fontes-padrão do formato. Ela não é
// embutida no arquivo: o leitor a substitui pela que tiver, e o repertório
// garantido para em Latin-1. Tudo acima disso precisava ser traduzido — "≥"
// virava ">=", "→" virava "->" — ou era removido em silêncio.
//
// Foi a remoção silenciosa que doeu. No curso de gestão de estoque de 23/08, o
// PDF imprimiu:
//
//     LEC = ((2 * 1200 * 50) / 3)
//     LEC = (40000)
//     LEC = 200 unidades
//
// O √ tinha sido apagado, e a apostila afirmava que 40000 é 200. Um curso que
// ensina a calcular não pode imprimir a conta errada.
//
// POR QUE LIBERATION SANS
//
// Porque é metricamente compatível com Helvetica — cada caractere tem a mesma
// largura de avanço. Toda a diagramação deste gerador foi ajustada contra as
// métricas da Helvetica ao longo de meses: quebra de linha, justificação,
// medição sem kerning. Uma fonte com métricas próprias exigiria refazer tudo
// isso. Esta troca é invisível para o layout e visível só onde faltava glifo.
//
// COMO USAR
//
//   registrarEduSans(doc);            // uma vez, logo após criar o jsPDF
//   doc.setFont(EDUSANS, "bold");     // no lugar de setFont("helvetica", …)
//
// Se o registro falhar por qualquer motivo, `registrarEduSans` devolve false e
// o chamador segue com Helvetica: um PDF com "sqrt" é muito melhor que
// nenhum PDF. Exportar nunca pode morrer por causa de fonte.
// ═══════════════════════════════════════════════════════════════════════════

import { EDUSANS_NORMAL } from "./edusans-normal.ts";
import { EDUSANS_BOLD } from "./edusans-bold.ts";
import { EDUSANS_ITALIC } from "./edusans-italic.ts";

/** Nome da família registrada no jsPDF. */
export const EDUSANS = "EduSans";

interface DocComFonte {
  addFileToVFS(nome: string, dadosBase64: string): void;
  addFont(nomeArquivo: string, familia: string, estilo: string): void;
  getFontList?(): Record<string, string[]>;
}

const FACES: Array<[string, string, string]> = [
  ["EduSans-normal.ttf", "normal", EDUSANS_NORMAL],
  ["EduSans-bold.ttf", "bold", EDUSANS_BOLD],
  ["EduSans-italic.ttf", "italic", EDUSANS_ITALIC],
];

/**
 * Embute as três variantes no documento. Devolve true quando a família ficou
 * disponível — o chamador usa isso para decidir entre EduSans e Helvetica.
 */
export function registrarEduSans(doc: DocComFonte): boolean {
  try {
    for (const [arquivo, estilo, dados] of FACES) {
      doc.addFileToVFS(arquivo, dados);
      doc.addFont(arquivo, EDUSANS, estilo);
    }
    // Confirma que o jsPDF realmente reconheceu a família. Sem esta checagem,
    // um addFont que falhasse em silêncio nos deixaria pedindo uma fonte
    // inexistente em cada linha do documento.
    const lista = doc.getFontList?.();
    if (lista && !lista[EDUSANS]) return false;
    return true;
  } catch (err) {
    console.warn(`[PDF-FONTE] EduSans não pôde ser embutida: ${err}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// QUAIS GLIFOS A FONTE TEM — PERGUNTANDO A ELA, NÃO A UMA LISTA
//
// A primeira versão disto mantinha à mão uma lista de intervalos que o gerador
// consultava para decidir o que preservar. Duas listas para a mesma verdade: a
// que o código acreditava e a que a fonte tinha. Elas divergiram no primeiro
// teste — a lista prometia ∛, ≪, ✓ e ➡, que a Liberation Sans não desenha, e
// prometia o bloco de controle C1 (U+0080–U+009F), que ninguém desenha. Pedir
// um glifo inexistente faz o leitor imprimir uma caixa vazia: pior que a
// tradução que a fonte embutida veio substituir.
//
// Então o repertório passou a ser lido do cmap do próprio TTF. Não há como
// divergir do que existe. A leitura acontece uma vez por processo (~1 ms) e o
// resultado é a INTERSEÇÃO das três variantes: um caractere que existisse só na
// normal viraria caixa vazia ao ser posto em negrito.
// ═══════════════════════════════════════════════════════════════════════════

function bytesDeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Code points mapeados pelo cmap de um TrueType (subtabelas formato 4 e 12). */
function lerCmap(b64: string): Set<number> {
  const b = bytesDeBase64(b64);
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const u32 = (o: number) =>
    b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

  let cmap = -1;
  for (let i = 0, n = u16(4); i < n; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(b[rec], b[rec + 1], b[rec + 2], b[rec + 3]);
    if (tag === "cmap") cmap = u32(rec + 8);
  }
  if (cmap < 0) throw new Error("fonte sem tabela cmap");

  const cps = new Set<number>();
  for (let i = 0, n = u16(cmap + 2); i < n; i++) {
    const sub = cmap + u32(cmap + 4 + i * 8 + 4);
    const formato = u16(sub);
    if (formato === 4) {
      const segCount = u16(sub + 6) / 2;
      const fim = sub + 14;
      const ini = fim + segCount * 2 + 2;
      for (let s = 0; s < segCount; s++) {
        const de = u16(ini + s * 2);
        const ate = u16(fim + s * 2);
        if (de === 0xffff) continue;
        for (let cp = de; cp <= ate && cp !== 0xffff; cp++) cps.add(cp);
      }
    } else if (formato === 12) {
      for (let g = 0, gn = u32(sub + 12); g < gn; g++) {
        const base = sub + 16 + g * 12;
        for (let cp = u32(base); cp <= u32(base + 4); cp++) cps.add(cp);
      }
    }
  }
  return cps;
}

/** Rede de segurança: se o cmap não puder ser lido, prometemos só o ASCII
 *  imprimível e o Latin-1 acima do bloco de controle C1 — o que qualquer fonte
 *  desta família tem. */
function apenasLatin1(): Set<number> {
  const s = new Set<number>();
  for (let cp = 0x20; cp <= 0x7e; cp++) s.add(cp);
  for (let cp = 0xa0; cp <= 0xff; cp++) s.add(cp);
  return s;
}

let cacheGlifos: Set<number> | null = null;

/** Os code points que EduSans desenha nas três variantes. Cacheado. */
export function glifosDaFonte(): Set<number> {
  if (cacheGlifos) return cacheGlifos;
  try {
    const [normal, bold, italic] = FACES.map(([, , dados]) => lerCmap(dados));
    const comum = new Set<number>();
    for (const cp of normal) if (bold.has(cp) && italic.has(cp)) comum.add(cp);
    if (comum.size < 200) throw new Error(`cmap com apenas ${comum.size} entradas`);
    cacheGlifos = comum;
  } catch (err) {
    console.warn(`[PDF-FONTE] cmap ilegível (${err}); assumindo só Latin-1`);
    cacheGlifos = apenasLatin1();
  }
  return cacheGlifos;
}
