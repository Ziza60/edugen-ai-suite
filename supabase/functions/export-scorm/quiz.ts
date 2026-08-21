// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o quiz do SCORM passa a valer nota
//
// O QUE HAVIA
//
// O quiz saía como HTML estático: a pergunta, as alternativas numa lista, e um
// "✓" ao lado da certa. Dois problemas, e o segundo é pior que o primeiro.
//
// 1) O ALUNO NÃO RESPONDE NADA. Ele lê a resposta junto com a pergunta. Isso é
//    material de consulta, não avaliação — e um curso vendido como avaliativo
//    que entrega o gabarito impresso não avalia coisa alguma.
//
// 2) O LMS NÃO FICA SABENDO DE NADA. O pacote informava apenas
//    `cmi.core.lesson_status = "completed"`, e informava isso NA ABERTURA da
//    página. Ou seja: o Moodle registrava "concluído" no instante em que o
//    aluno abria o módulo, tivesse lido ou não. Para quem precisa comprovar
//    aproveitamento — e é esse o caso de quem compra curso para equipe — o
//    relatório do LMS não dizia absolutamente nada.
//
// O QUE PASSA A HAVER
//
// Alternativas clicáveis, correção sob demanda, e o resultado enviado ao LMS
// pelas variáveis que ele entende:
//
//   cmi.core.score.raw / .min / .max      a nota
//   cmi.core.lesson_status                passed ou failed, pela nota
//   cmi.interactions.N.*                  questão a questão
//
// As interactions são o que permite ao instrutor ver, no relatório do Moodle,
// QUAL questão o aluno errou — não só a nota final. É a diferença entre "tirou
// 60" e "errou as duas de prazo legal".
//
// MÓDULO SEM QUIZ CONTINUA COMO ERA
//
// Marca "completed" na abertura, porque ali não há o que avaliar: a única
// evidência disponível é ter aberto. Só o módulo COM quiz passa a exigir a
// resposta antes de declarar qualquer coisa.
// ═══════════════════════════════════════════════════════════════════════════

export interface QuizQuestion {
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string | null;
}

/** Percentual mínimo para "passed". 70 é o costume em treinamento corporativo. */
export const NOTA_MINIMA = 70;

function escaparHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serializa dados para dentro de uma tag `<script>`.
 *
 * `JSON.stringify` sozinho não basta: uma pergunta que contenha a sequência
 * `</script>` fecharia a tag no meio do dado e o resto do gabarito viraria
 * HTML. Escapar `<` resolve isso na origem, e o JSON continua válido porque
 * `<` é um escape legítimo dentro de string JSON.
 */
function paraScript(valor: unknown): string {
  return JSON.stringify(valor)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Só entram questões íntegras: enunciado, 2+ alternativas e gabarito válido. */
export function quizUtilizavel(quizzes: QuizQuestion[] | null | undefined): QuizQuestion[] {
  return (quizzes ?? []).filter((q) =>
    typeof q?.question === "string" && q.question.trim().length > 0 &&
    Array.isArray(q?.options) && q.options.length >= 2 &&
    Number.isInteger(q?.correct_answer) &&
    q.correct_answer >= 0 && q.correct_answer < q.options.length
  );
}

/**
 * O HTML do quiz interativo. Devolve "" quando não há questão utilizável, e
 * nesse caso o chamador mantém o comportamento antigo de marcar "completed".
 */
export function quizInterativoHtml(quizzes: QuizQuestion[] | null | undefined): string {
  const qs = quizUtilizavel(quizzes);
  if (!qs.length) return "";

  const gabarito = qs.map((q) => ({
    r: q.correct_answer,
    e: q.explanation ?? "",
    n: q.options.length,
  }));

  const perguntas = qs.map((q, i) => {
    const alternativas = q.options.map((opt, j) => `
        <label class="eg-opt" for="q${i}o${j}">
          <input type="radio" id="q${i}o${j}" name="q${i}" value="${j}">
          <span>${String.fromCharCode(65 + j)}) ${escaparHtml(opt)}</span>
        </label>`).join("");
    return `
      <li class="eg-q" id="eg-q-${i}">
        <p class="eg-enunciado">${escaparHtml(q.question)}</p>
        <div class="eg-opts">${alternativas}</div>
        <p class="eg-fb" id="eg-fb-${i}" hidden></p>
      </li>`;
  }).join("");

  return `
<hr>
<section class="eg-quiz">
  <h2>Quiz</h2>
  <p class="eg-instrucao">Escolha uma alternativa em cada questão. Nota mínima para aprovação: ${NOTA_MINIMA}%.</p>
  <ol class="eg-lista">${perguntas}</ol>
  <button type="button" id="eg-corrigir">Verificar respostas</button>
  <p id="eg-resultado" class="eg-resultado" hidden></p>
</section>

<style>
  .eg-quiz { margin-top: 28px; }
  .eg-instrucao { color: #555; font-size: 0.92em; }
  .eg-lista { padding-left: 20px; }
  .eg-q { margin: 18px 0 22px; }
  .eg-enunciado { font-weight: 600; margin: 0 0 8px; }
  .eg-opt { display: block; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
  .eg-opt:hover { background: #f2f4f7; }
  .eg-opt input { margin-right: 8px; }
  .eg-ok > span { color: #0a7d3f; font-weight: 600; }
  .eg-erro > span { color: #b3261e; }
  .eg-fb { margin: 8px 0 0; font-size: 0.92em; color: #444; }
  #eg-corrigir { padding: 9px 18px; border: 0; border-radius: 6px;
                 background: #1E3A5F; color: #fff; font-size: 0.95em; cursor: pointer; }
  #eg-corrigir:disabled { opacity: .55; cursor: default; }
  .eg-resultado { margin-top: 14px; font-weight: 600; }
</style>

<script>
(function () {
  var GABARITO = ${paraScript(gabarito)};
  var MINIMA = ${NOTA_MINIMA};

  // ── SCORM 1.2 ──
  // O wrapper vive aqui dentro para o quiz ser autossuficiente: se o pacote for
  // aberto fora de um LMS (o autor conferindo no navegador), tudo funciona e só
  // o envio da nota é omitido.
  var API = (function achar(win) {
    try {
      var n = 0;
      while (win && !win.API && n++ < 12) { if (win === win.parent) break; win = win.parent; }
      return win ? win.API : null;
    } catch (e) { return null; }
  })(window);

  function set(k, v) { try { if (API) API.LMSSetValue(k, String(v)); } catch (e) {} }

  var iniciado = false;
  function iniciar() {
    if (iniciado || !API) return;
    try { API.LMSInitialize(""); iniciado = true; } catch (e) {}
  }

  document.getElementById("eg-corrigir").addEventListener("click", function () {
    var acertos = 0;
    for (var i = 0; i < GABARITO.length; i++) {
      var marcada = document.querySelector('input[name="q' + i + '"]:checked');
      var resposta = marcada ? parseInt(marcada.value, 10) : -1;
      var certa = GABARITO[i].r;
      var acertou = resposta === certa;
      if (acertou) acertos++;

      var item = document.getElementById("eg-q-" + i);
      var opts = item.querySelectorAll(".eg-opt");
      for (var j = 0; j < opts.length; j++) {
        opts[j].classList.remove("eg-ok", "eg-erro");
        if (j === certa) opts[j].classList.add("eg-ok");
        else if (j === resposta) opts[j].classList.add("eg-erro");
        var inp = opts[j].querySelector("input");
        if (inp) inp.disabled = true;
      }

      var fb = document.getElementById("eg-fb-" + i);
      var texto = acertou ? "Correto." : (resposta < 0 ? "Sem resposta." : "Incorreto.");
      if (GABARITO[i].e) texto += " " + GABARITO[i].e;
      fb.textContent = texto;
      fb.hidden = false;

      // Questão a questão, para o instrutor ver ONDE o aluno errou — e não só
      // a nota final.
      iniciar();
      set("cmi.interactions." + i + ".id", "q" + (i + 1));
      set("cmi.interactions." + i + ".type", "choice");
      set("cmi.interactions." + i + ".student_response", resposta < 0 ? "" : String.fromCharCode(97 + resposta));
      set("cmi.interactions." + i + ".correct_responses.0.pattern", String.fromCharCode(97 + certa));
      set("cmi.interactions." + i + ".result", acertou ? "correct" : "wrong");
    }

    var nota = Math.round((acertos / GABARITO.length) * 100);
    var aprovado = nota >= MINIMA;

    var res = document.getElementById("eg-resultado");
    res.textContent = "Você acertou " + acertos + " de " + GABARITO.length +
      " (" + nota + "%). " + (aprovado ? "Aprovado." : "Abaixo da nota mínima.");
    res.style.color = aprovado ? "#0a7d3f" : "#b3261e";
    res.hidden = false;

    this.disabled = true;

    iniciar();
    set("cmi.core.score.min", 0);
    set("cmi.core.score.max", 100);
    set("cmi.core.score.raw", nota);
    set("cmi.core.lesson_status", aprovado ? "passed" : "failed");
    try { if (API) API.LMSCommit(""); } catch (e) {}
  });

  // O LMS encerra a sessão quando a janela fecha; sem isso alguns registram
  // a tentativa como abandonada mesmo depois de o aluno ter respondido.
  window.addEventListener("unload", function () {
    try { if (API && iniciado) API.LMSFinish(""); } catch (e) {}
  });
})();
</script>`;
}

/**
 * O script do módulo SEM quiz: marca "completed" na abertura.
 *
 * É o comportamento antigo, mantido de propósito — num módulo sem avaliação a
 * única evidência que existe é ter aberto. O que muda é que ele deixa de valer
 * para os módulos COM quiz, onde declarar "concluído" na abertura anulava a
 * avaliação antes de ela acontecer.
 */
export function scriptSemQuiz(): string {
  return `
  <script>
    var API = null;
    function findAPI(win) {
      try {
        var n = 0;
        while (win && !win.API && n++ < 12) { if (win === win.parent) break; win = win.parent; }
        return win ? win.API : null;
      } catch(e) { return null; }
    }
    API = findAPI(window);
    if (API) {
      API.LMSInitialize("");
      API.LMSSetValue("cmi.core.lesson_status", "completed");
      API.LMSCommit("");
      window.addEventListener("unload", function () { try { API.LMSFinish(""); } catch (e) {} });
    }
  </script>`;
}
