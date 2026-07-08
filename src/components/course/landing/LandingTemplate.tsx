import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, Sparkles, PlayCircle, Check, Quote,
} from "lucide-react";

/**
 * Shared landing-page template rendered by BOTH the public route
 * (src/pages/CourseLanding.tsx) and the editor preview
 * (src/components/course/landing/LandingPreview.tsx) so the two never drift.
 *
 * Editorial / premium aesthetic built to look refined with ANY per-course
 * accent colour: an ink hero lit by an accent glow + film grain, a display
 * serif (Cormorant Garamond) paired with DM Sans, a syllabus-style numbered
 * curriculum, and scroll-revealed sections.
 */

interface Landing {
  headline?: string;
  subtitle?: string;
  summary?: string;
  benefits?: unknown;
  cta_text?: string;
  testimonial_text?: string;
  testimonial_name?: string;
  logo_url?: string;
  show_branding?: boolean;
  custom_colors?: { primary?: string } | null;
  courses?: { title?: string; description?: string; language?: string } | null;
}

interface LandingTemplateProps {
  landing: Landing;
  modules?: { title: string; order_index?: number }[];
  slug?: string;
  /** When true, CTAs link to the course; in the editor preview they're inert. */
  interactive?: boolean;
}

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function LandingTemplate({
  landing,
  modules = [],
  slug,
  interactive = false,
}: LandingTemplateProps) {
  const benefits: string[] = Array.isArray(landing.benefits)
    ? (landing.benefits as string[])
    : [];
  const accent = landing.custom_colors?.primary || "#7c3aed";
  const courseTitle = landing.courses?.title || "Curso";
  const language = landing.courses?.language;
  const cta = landing.cta_text || "Quero me inscrever";
  const headline = landing.headline || courseTitle;

  // Split the headline so the last ~third can be set in accented italic serif.
  const words = headline.trim().split(/\s+/);
  const splitAt = words.length > 4 ? Math.ceil(words.length * 0.62) : words.length;
  const headLead = words.slice(0, splitAt).join(" ");
  const headTail = words.slice(splitAt).join(" ");

  // Scroll-reveal on the public page; animate-on-mount in the editor preview
  // (whileInView can fail to fire inside the editor's scaled/scrolled panel,
  // which would leave sections stuck at opacity 0).
  const reveal = interactive
    ? {
        initial: { opacity: 0, y: 24 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-80px" },
        transition: { duration: 0.7, ease: EASE },
      }
    : {
        initial: { opacity: 0, y: 24 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.7, ease: EASE },
      };
  const itemReveal = (i: number) =>
    interactive
      ? {
          initial: { opacity: 0, y: 20 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-60px" },
          transition: { duration: 0.5, ease: EASE, delay: i * 0.06 },
        }
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, ease: EASE, delay: i * 0.06 },
        };

  const grain =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

  const PrimaryCTA = ({ label, icon }: { label: string; icon?: ReactNode }) => {
    const inner = (
      <span className="lp-cta lp-cta-solid group">
        {icon}
        {label}
        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    );
    return interactive && slug ? <Link to={`/learn/${slug}`}>{inner}</Link> : inner;
  };

  return (
    <div className="lp-root">
      <style>{css(accent, grain)}</style>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <div className="lp-brand">
            {landing.logo_url ? (
              <img src={landing.logo_url} alt="Logo" className="lp-logo" />
            ) : (
              <>
                <span className="lp-brand-mark">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <span className="lp-serif lp-brand-name">EduGen AI</span>
              </>
            )}
          </div>
          <div className="lp-header-actions">
            {interactive && slug ? (
              <Link to={`/learn/${slug}`} className="lp-link-ghost">
                <PlayCircle className="h-4 w-4" />
                Acessar curso
              </Link>
            ) : (
              <span className="lp-link-ghost">
                <PlayCircle className="h-4 w-4" />
                Acessar curso
              </span>
            )}
            <span className="lp-cta lp-cta-mini">{cta}</span>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-glow" aria-hidden />
        <div className="lp-grain" aria-hidden />
        <div className="lp-hero-grid" aria-hidden />

        <div className="lp-container lp-hero-inner">
          <motion.p
            className="lp-eyebrow"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <span className="lp-eyebrow-dot" />
            Curso online{language ? ` · ${language}` : ""}
          </motion.p>

          <motion.h1
            className="lp-serif lp-hero-title"
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.85, ease: EASE, delay: 0.05 }}
          >
            {headLead}
            {headTail && (
              <>
                {" "}
                <em className="lp-hero-accent">{headTail}</em>
              </>
            )}
          </motion.h1>

          {landing.subtitle && (
            <motion.p
              className="lp-hero-sub"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
            >
              {landing.subtitle}
            </motion.p>
          )}

          <motion.div
            className="lp-hero-cta"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.28 }}
          >
            <PrimaryCTA label="Começar agora" icon={<PlayCircle className="h-4 w-4" />} />
            <span className="lp-cta lp-cta-ghost">
              {cta}
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </motion.div>

          <motion.div
            className="lp-hero-meta"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.5 }}
          >
            {modules.length > 0 && (
              <span>
                <strong>{modules.length}</strong> módulos
              </span>
            )}
            {benefits.length > 0 && (
              <span>
                <strong>{benefits.length}</strong> resultados garantidos
              </span>
            )}
            <span>Acesso imediato</span>
          </motion.div>
        </div>
      </section>

      {/* ── Benefits ───────────────────────────────────────────── */}
      {benefits.length > 0 && (
        <section className="lp-section lp-section-light">
          <div className="lp-container">
            <motion.div className="lp-section-head" {...reveal}>
              <span className="lp-kicker">Resultados</span>
              <h2 className="lp-serif lp-h2">O que você vai conquistar</h2>
            </motion.div>
            <div className="lp-benefits">
              {benefits.map((b, i) => (
                <motion.div key={i} className="lp-benefit" {...itemReveal(i)}>
                  <span className="lp-benefit-check">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <span>{b}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── About + Curriculum ─────────────────────────────────── */}
      <section className="lp-section lp-section-paper">
        <div className="lp-container lp-split">
          {landing.summary && (
            <motion.div className="lp-about" {...reveal}>
              <span className="lp-kicker">Sobre o curso</span>
              <p className="lp-serif lp-about-text">{landing.summary}</p>
            </motion.div>
          )}

          {modules.length > 0 && (
            <motion.div className="lp-curriculum" {...reveal}>
              <span className="lp-kicker">Conteúdo programático</span>
              <ol className="lp-syllabus">
                {modules.map((m, i) => (
                  <li key={i} className="lp-syllabus-item">
                    <span className="lp-serif lp-syllabus-num">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="lp-syllabus-title">{m.title}</span>
                  </li>
                ))}
              </ol>
            </motion.div>
          )}
        </div>
      </section>

      {/* ── Testimonial ────────────────────────────────────────── */}
      {landing.testimonial_text && (
        <section className="lp-section lp-section-ink">
          <div className="lp-hero-glow lp-glow-soft" aria-hidden />
          <div className="lp-container lp-quote-wrap">
            <motion.div {...reveal}>
              <Quote className="lp-quote-mark" />
              <blockquote className="lp-serif lp-quote">
                {landing.testimonial_text}
              </blockquote>
              <p className="lp-quote-name">— {landing.testimonial_name}</p>
              <p className="lp-quote-note">Depoimento ilustrativo</p>
            </motion.div>
          </div>
        </section>
      )}

      {/* ── Final CTA ──────────────────────────────────────────── */}
      <section className="lp-section lp-section-paper lp-final">
        <div className="lp-container">
          <motion.div className="lp-final-card" {...reveal}>
            <div className="lp-final-glow" aria-hidden />
            <span className="lp-kicker lp-kicker-on-accent">Vagas abertas</span>
            <h2 className="lp-serif lp-final-title">Pronto para começar?</h2>
            <p className="lp-final-sub">
              Inscreva-se agora e tenha acesso imediato a todo o conteúdo do curso.
            </p>
            <div className="lp-final-actions">
              <PrimaryCTA label="Começar agora" icon={<PlayCircle className="h-4 w-4" />} />
              <span className="lp-cta lp-cta-ghost lp-cta-ghost-light">
                {cta}
                <ArrowRight className="h-4 w-4" />
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <span className="lp-serif lp-footer-title">{courseTitle}</span>
          <span className="lp-footer-meta">
            {landing.show_branding !== false && (
              <>
                Criado com <strong>EduGen AI</strong> ·{" "}
              </>
            )}
            © {new Date().getFullYear()}
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ── Scoped styles ───────────────────────────────────────────────
 * Everything derives from the per-course accent so any colour looks
 * intentional. 8-digit hex (accent + alpha) drives glows and tints.       */
function css(accent: string, grain: string): string {
  return `
  .lp-root{
    --accent:${accent};
    --ink:#141318;
    --paper:#f6f4ef;
    --paper-2:#efece4;
    --line:rgba(20,19,24,.10);
    --muted:#6c6a72;
    font-family:'DM Sans',system-ui,sans-serif;
    color:var(--ink);
    background:var(--paper);
    -webkit-font-smoothing:antialiased;
    text-rendering:optimizeLegibility;
  }
  .lp-root *{box-sizing:border-box;}
  .lp-serif{font-family:'Cormorant Garamond',Georgia,serif;}
  .lp-container{width:100%;max-width:1080px;margin:0 auto;padding:0 24px;}

  /* Header */
  .lp-header{position:sticky;top:0;z-index:40;background:rgba(20,19,24,.72);
    backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.08);}
  .lp-header-inner{display:flex;align-items:center;justify-content:space-between;height:60px;}
  .lp-brand{display:flex;align-items:center;gap:10px;color:#fff;}
  .lp-logo{height:30px;width:auto;}
  .lp-brand-mark{display:grid;place-items:center;height:28px;width:28px;border-radius:9px;
    background:var(--accent);color:#fff;box-shadow:0 6px 20px -6px var(--accent);}
  .lp-brand-name{font-size:20px;font-weight:700;letter-spacing:.01em;}
  .lp-header-actions{display:flex;align-items:center;gap:12px;}
  .lp-link-ghost{display:inline-flex;align-items:center;gap:7px;color:rgba(255,255,255,.82);
    font-size:13.5px;font-weight:500;cursor:pointer;transition:color .2s;}
  .lp-link-ghost:hover{color:#fff;}

  /* Buttons */
  .lp-cta{display:inline-flex;align-items:center;gap:9px;font-weight:600;font-size:15px;
    line-height:1;border-radius:999px;padding:14px 24px;cursor:pointer;white-space:nowrap;
    transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s,background .2s,color .2s;}
  .lp-cta-solid{background:var(--accent);color:#fff;box-shadow:0 12px 30px -10px var(--accent);}
  .lp-cta-solid:hover{transform:translateY(-2px);box-shadow:0 18px 40px -12px var(--accent);}
  .lp-cta-mini{padding:9px 16px;font-size:13.5px;background:var(--accent);color:#fff;}
  .lp-cta-mini:hover{transform:translateY(-1px);}
  .lp-cta-ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.22);}
  .lp-cta-ghost:hover{border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.04);}
  .lp-cta-ghost-light{color:var(--ink);border-color:var(--line);}
  .lp-cta-ghost-light:hover{border-color:var(--accent);color:var(--accent);}

  /* Hero */
  .lp-hero{position:relative;overflow:hidden;background:var(--ink);color:#fff;
    padding:clamp(72px,12vw,132px) 0 clamp(76px,12vw,120px);}
  .lp-hero-glow{position:absolute;inset:0;pointer-events:none;
    background:
      radial-gradient(48rem 32rem at 82% -12%, ${accent}44, transparent 60%),
      radial-gradient(42rem 30rem at 2% 108%, ${accent}22, transparent 62%);}
  .lp-glow-soft{background:radial-gradient(40rem 26rem at 78% -20%, ${accent}33, transparent 60%);}
  .lp-hero-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;
    background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),
      linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);
    background-size:64px 64px;
    -webkit-mask-image:radial-gradient(70% 60% at 50% 30%,#000,transparent 80%);
    mask-image:radial-gradient(70% 60% at 50% 30%,#000,transparent 80%);}
  .lp-grain{position:absolute;inset:0;pointer-events:none;opacity:.06;mix-blend-mode:overlay;
    background-image:${grain};background-size:140px 140px;}
  .lp-hero-inner{position:relative;z-index:1;max-width:920px;}
  .lp-eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:12px;font-weight:600;
    letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.7);margin-bottom:26px;}
  .lp-eyebrow-dot{height:6px;width:6px;border-radius:999px;background:var(--accent);
    box-shadow:0 0 14px 2px var(--accent);}
  .lp-hero-title{font-weight:600;font-size:clamp(2.9rem,7vw,5.4rem);line-height:1.02;
    letter-spacing:-.015em;margin:0 0 24px;max-width:16ch;}
  .lp-hero-accent{font-style:italic;font-weight:500;
    color:transparent;background:linear-gradient(100deg,var(--accent),#fff 160%);
    -webkit-background-clip:text;background-clip:text;}
  .lp-hero-sub{font-size:clamp(1.05rem,1.6vw,1.28rem);line-height:1.6;color:rgba(255,255,255,.74);
    max-width:56ch;margin:0 0 38px;}
  .lp-hero-cta{display:flex;flex-wrap:wrap;gap:14px;}
  .lp-hero-meta{display:flex;flex-wrap:wrap;gap:26px;margin-top:44px;padding-top:26px;
    border-top:1px solid rgba(255,255,255,.12);font-size:13.5px;color:rgba(255,255,255,.6);}
  .lp-hero-meta strong{color:#fff;font-weight:700;font-size:15px;}

  /* Sections */
  .lp-section{position:relative;padding:clamp(64px,9vw,104px) 0;}
  .lp-section-light{background:var(--paper);}
  .lp-section-paper{background:var(--paper-2);}
  .lp-section-ink{background:var(--ink);color:#fff;overflow:hidden;}
  .lp-section-head{margin-bottom:44px;}
  .lp-kicker{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.2em;
    text-transform:uppercase;color:var(--accent);margin-bottom:14px;}
  .lp-h2{font-weight:600;font-size:clamp(2rem,4vw,3rem);line-height:1.05;letter-spacing:-.01em;margin:0;}

  /* Benefits */
  .lp-benefits{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;}
  .lp-benefit{display:flex;gap:14px;align-items:flex-start;background:#fff;
    border:1px solid var(--line);border-radius:16px;padding:20px 22px;font-size:15.5px;
    line-height:1.5;box-shadow:0 1px 0 rgba(20,19,24,.02);
    transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s,border-color .3s;}
  .lp-benefit:hover{transform:translateY(-3px);border-color:${accent}55;
    box-shadow:0 20px 40px -24px ${accent}aa;}
  .lp-benefit-check{flex-shrink:0;display:grid;place-items:center;height:26px;width:26px;
    border-radius:999px;background:${accent}18;color:var(--accent);margin-top:1px;}

  /* About + curriculum */
  .lp-split{display:grid;grid-template-columns:1fr 1fr;gap:clamp(40px,6vw,80px);align-items:start;}
  .lp-about-text{font-size:clamp(1.35rem,2.2vw,1.9rem);line-height:1.4;font-weight:500;
    letter-spacing:-.005em;margin:0;color:#26242b;}
  .lp-syllabus{list-style:none;margin:0;padding:0;}
  .lp-syllabus-item{display:flex;align-items:center;gap:18px;padding:16px 4px;
    border-top:1px solid var(--line);transition:padding-left .3s cubic-bezier(.22,1,.36,1);}
  .lp-syllabus-item:last-child{border-bottom:1px solid var(--line);}
  .lp-syllabus-item:hover{padding-left:12px;}
  .lp-syllabus-num{font-size:1.5rem;font-weight:600;font-style:italic;color:var(--accent);
    min-width:2.2ch;}
  .lp-syllabus-title{font-size:15.5px;font-weight:500;line-height:1.4;}

  /* Testimonial */
  .lp-quote-wrap{position:relative;z-index:1;max-width:760px;text-align:center;}
  .lp-quote-mark{height:40px;width:40px;color:var(--accent);opacity:.55;margin:0 auto 18px;}
  .lp-quote{font-size:clamp(1.6rem,3.2vw,2.5rem);line-height:1.3;font-weight:500;
    font-style:italic;letter-spacing:-.01em;margin:0 0 24px;}
  .lp-quote-name{font-size:14px;font-weight:600;color:rgba(255,255,255,.85);margin:0;}
  .lp-quote-note{font-size:11.5px;color:rgba(255,255,255,.4);margin:6px 0 0;
    letter-spacing:.04em;}

  /* Final CTA */
  .lp-final{padding-bottom:clamp(72px,10vw,120px);}
  .lp-final-card{position:relative;overflow:hidden;background:var(--ink);color:#fff;
    border-radius:28px;padding:clamp(44px,7vw,76px);text-align:center;
    box-shadow:0 40px 80px -40px rgba(20,19,24,.6);}
  .lp-final-glow{position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(36rem 20rem at 50% -30%, ${accent}55, transparent 60%);}
  .lp-final-card>*{position:relative;z-index:1;}
  .lp-kicker-on-accent{color:var(--accent);}
  .lp-final-title{font-weight:600;font-size:clamp(2.2rem,4.5vw,3.4rem);line-height:1.04;
    letter-spacing:-.01em;margin:0 0 14px;}
  .lp-final-sub{font-size:16px;line-height:1.6;color:rgba(255,255,255,.72);
    max-width:44ch;margin:0 auto 30px;}
  .lp-final-actions{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;}

  /* Footer */
  .lp-footer{background:var(--ink);color:rgba(255,255,255,.6);
    border-top:1px solid rgba(255,255,255,.08);padding:26px 0;}
  .lp-footer-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;
    flex-wrap:wrap;}
  .lp-footer-title{font-size:18px;font-weight:600;color:#fff;}
  .lp-footer-meta{font-size:12.5px;}
  .lp-footer-meta strong{color:rgba(255,255,255,.85);font-weight:600;}

  @media (max-width:720px){
    .lp-benefits{grid-template-columns:1fr;}
    .lp-split{grid-template-columns:1fr;}
    .lp-header-actions .lp-link-ghost{display:none;}
  }
  @media (prefers-reduced-motion:reduce){
    .lp-cta,.lp-benefit,.lp-syllabus-item{transition:none;}
  }
  `;
}
