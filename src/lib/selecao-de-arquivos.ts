/**
 * Escolher VÁRIOS arquivos de uma vez — por clique ou arrastando.
 *
 * ─── O DEFEITO QUE ISTO FECHA ─────────────────────────────────────────────────
 *
 * A tela "PDF / DOCX → Curso" lia `files[0]` e descartava o resto em silêncio:
 * tanto no `input` (sem `multiple`, portanto o seletor do sistema nem deixava
 * marcar dois) quanto no arrastar (`e.dataTransfer.files[0]`). Quem arrastou o
 * capítulo 4 de um manual junto com o capítulo das definições viu UM capítulo
 * entrar, sem aviso nenhum de que o outro tinha sido jogado fora — e o curso
 * saiu sem os conceitos que só existiam no capítulo perdido.
 *
 * ─── POR QUE A CONTAGEM DE VAGAS É FEITA DENTRO DO LAÇO ───────────────────────
 *
 * Eu já errei isto exatamente uma vez, na versão deste mesmo conserto feita no
 * wizard: o laço chamava um `handleFileUpload` que conferia `uploadedSources
 * .length` — estado do React, que NÃO muda entre iterações do mesmo laço. Cinco
 * arquivos passavam num limite de três, e a checagem que justificava o laço era
 * a única que não podia funcionar nele.
 *
 * Aqui a vaga é conferida contra `aceitos.length`, a lista que está crescendo.
 * O teste `selecao-de-arquivos.test.ts` prova isso com uma seleção maior que o
 * limite numa chamada só, que é a forma em que o defeito aparecia.
 */

export interface RegrasDeSelecao {
  /** Extensões aceitas, minúsculas e sem ponto: `["pdf", "docx"]`. */
  extensoes: string[];
  tamanhoMaxBytes: number;
  maxArquivos: number;
}

export interface ArquivoRecusado {
  nome: string;
  motivo: string;
}

export interface Selecao {
  aceitos: File[];
  /** Todo arquivo descartado aparece aqui COM o motivo: nada sai em silêncio. */
  recusados: ArquivoRecusado[];
}

function extensaoDe(nome: string): string {
  const partes = nome.split(".");
  return partes.length > 1 ? (partes.pop() ?? "").toLowerCase() : "";
}

function megabytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1).replace(/\.0$/, "");
}

/**
 * Decide, arquivo por arquivo, o que entra na lista e o que é recusado.
 *
 * @param escolhidos    o que o usuário acabou de marcar ou arrastar, na ordem
 * @param jaSelecionados o que já estava na lista antes desta escolha
 */
export function selecionarArquivos(
  escolhidos: readonly File[],
  jaSelecionados: readonly File[],
  regras: RegrasDeSelecao,
): Selecao {
  const aceitos: File[] = [];
  const recusados: ArquivoRecusado[] = [];
  const nomesEmUso = new Set(jaSelecionados.map((f) => f.name));

  for (const arquivo of escolhidos) {
    const ext = extensaoDe(arquivo.name);

    if (!regras.extensoes.includes(ext)) {
      const aceitas = regras.extensoes.map((e) => e.toUpperCase()).join(" ou ");
      recusados.push({
        nome: arquivo.name,
        motivo: ext ? `formato .${ext} não aceito — só ${aceitas}` : `só ${aceitas}`,
      });
      continue;
    }

    if (arquivo.size > regras.tamanhoMaxBytes) {
      recusados.push({
        nome: arquivo.name,
        motivo: `maior que o limite de ${megabytes(regras.tamanhoMaxBytes)} MB`,
      });
      continue;
    }

    if (nomesEmUso.has(arquivo.name)) {
      recusados.push({ nome: arquivo.name, motivo: "já estava na lista" });
      continue;
    }

    // A vaga é conferida contra a lista QUE ESTÁ CRESCENDO nesta chamada.
    if (jaSelecionados.length + aceitos.length >= regras.maxArquivos) {
      recusados.push({
        nome: arquivo.name,
        motivo: `limite de ${regras.maxArquivos} arquivo${regras.maxArquivos > 1 ? "s" : ""}`,
      });
      continue;
    }

    nomesEmUso.add(arquivo.name);
    aceitos.push(arquivo);
  }

  return { aceitos, recusados };
}

/** Uma frase para a tela, ou `null` quando nada foi recusado. */
export function motivoDasRecusas(recusados: readonly ArquivoRecusado[]): string | null {
  if (recusados.length === 0) return null;
  return recusados.map((r) => `${r.nome}: ${r.motivo}`).join(" · ");
}
