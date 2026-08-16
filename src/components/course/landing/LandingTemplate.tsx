import { useState, useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, Sparkles, PlayCircle, Check, Quote,
  ChevronDown, Image as ImageIcon,
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
 *
 * Pro blocks (video, faq, gallery, timer) are rendered between the testimonial
 * and the final CTA when present in `layout_blocks`.
 */

interface FaqItem {
  question: string;
  answer: string;
}

interface BlockContent {
  url?: string;          // video
  items?: FaqItem[];     // faq
  images?: string[];     // gallery
  targetDate?: string;   // timer
  label?: string;        // timer heading
}

interface LayoutBlock {
  type: "video" | "faq" | "gallery" | "timer";
  content: BlockContent;
}

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
  layout_blocks?: LayoutBlock[] | null;
}

interface LandingTemplateProps {
  landing: Landing;
  modules?: { title: string; order_index?: number }[];
  slug?: string;
  /** When true, CTAs link to the course; in the editor preview they're inert. */
  interactive?: boolean;
}

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── YouTube URL → embed URL ──────────────────────────────────────
function toYouTubeEmbed(url: string): string | null {
  const patterns = [
    /[?&]v=([^&]+)/,
    /youtu\.be\/([^?&#]+)/,
    /youtube\.com\/embed\/([^?&]+)/,
    /youtube\.com\/shorts\/([^?&]+)/,
  ];
  for (const p of patterns) {
    const m = (url || "").match(p);
    if (m) return `https://www.youtube.com/embed/${m[1]}?rel=0`;
  }
  return null;
}

// ── Countdown Timer ──────────────────────────────────────────────
function CountdownTimer({ targetDate, label }: { targetDate: string; label?: string }) {
  const calc = () => {
    const diff = new Date(targetDate).getTime() - Date.now();
    if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0 };
    return {
      d: Math.floor(diff / 86_400_000),
      h: Math.floor((diff % 86_400_000) / 3_600_000),
      m: Math.floor((diff % 3_600_000) / 60_000),
      s: Math.floor((diff % 60_000) / 1_000),
    };
  };
  const [t, setT] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
  }, [targetDate]);
  const pad = (n: number) => String(n).padStart(2, "0");
  const units = [
    { v: t.d, u: "dias" },
    { v: t.h, u: "horas" },
    { v: t.m, u: "min" },
    { v: t.s, u: "seg" },
  ];
  return (
    <div className="lp-timer-wrap">
      {label && <p className="lp-timer-label">{label}</p>}
      <div className="lp-timer-grid">
        {units.map(({ v, u }) => (
          <div key={u} className="lp-timer-cell">
            <span className="lp-serif lp-timer-num">{pad(v)}</span>
            <span className="lp-timer-unit">{u}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FAQ Accordion ────────────────────────────────────────────────
function FaqBlock({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="lp-faq">
      {items.map((item, i) => (
        <div key={i} className={`lp-faq-item${open === i ? " lp-faq-open" : ""}`}>
          <button
            className="lp-faq-q"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <span>{item.question}</span>
            <ChevronDown className="lp-faq-icon h-4 w-4" />
          </button>
          {open === i && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="lp-faq-a"
            >
              <p>{item.answer}</p>
            </motion.div>
          )}
        </div>
      ))}
    </div>
  );
}

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
  const blocks: LayoutBlock[] = Array.isArray(landing.layout_blocks)
    ? (landing.layout_blocks as LayoutBlock[])
    : [];

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

      {/* ── Pro Blocks ─────────────────────────────────────────── */}
      {blocks.map((block, idx) => {
        if (block.type === "video") {
          const embedUrl = toYouTubeEmbed(block.content.url || "");
          if (!embedUrl) return null;
          return (
            <section key={idx} className="lp-section lp-section-paper">
              <div className="lp-container">
                <motion.div {...reveal}>
                  <div className="lp-video-wrap">
                    <iframe
                      src={embedUrl}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="lp-video-frame"
                      title="Vídeo do curso"
                    />
                  </div>
                </motion.div>
              </div>
            </section>
          );
        }

        if (block.type === "faq") {
          const items = block.content.items || [];
          if (!items.length) return null;
          return (
            <section key={idx} className="lp-section lp-section-light">
              <div className="lp-container lp-faq-section">
                <motion.div className="lp-section-head" {...reveal}>
                  <span className="lp-kicker">Dúvidas</span>
                  <h2 className="lp-serif lp-h2">Perguntas frequentes</h2>
                </motion.div>
                <motion.div {...reveal}>
                  <FaqBlock items={items} />
                </motion.div>
              </div>
            </section>
          );
        }

        if (block.type === "gallery") {
          const images = (block.content.images || []).filter(Boolean);
          if (!images.length) return null;
          return (
            <section key={idx} className="lp-section lp-section-paper">
              <div className="lp-container">
                <motion.div className="lp-gallery" {...reveal}>
                  {images.map((src, i) => (
                    <motion.div key={i} className="lp-gallery-item" {...itemReveal(i)}>
                      <img src={src} alt={`Imagem ${i + 1}`} className="lp-gallery-img" />
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            </section>
          );
        }

        if (block.type === "timer") {
          if (!block.content.targetDate) return null;
          return (
            <section key={idx} className="lp-section lp-section-ink lp-timer-section">
              <div className="lp-hero-glow lp-glow-soft" aria-hidden />
              <div className="lp-container lp-timer-inner">
                <motion.div {...reveal}>
                  <CountdownTimer
                    targetDate={block.content.targetDate}
                    label={block.content.label}
                  />
                </motion.div>
              </div>
            </section>
          );
        }

        return null;
      })}

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

  /* ── Pro Blocks ── */

  /* Video */
  .lp-video-wrap{position:relative;width:100%;padding-bottom:56.25%;border-radius:16px;
    overflow:hidden;background:#000;box-shadow:0 32px 80px -32px rgba(20,19,24,.5);}
  .lp-video-frame{position:absolute;inset:0;width:100%;height:100%;border:none;}

  /* FAQ */
  .lp-faq-section{max-width:720px;margin-left:auto;margin-right:auto;}
  .lp-faq{border-top:1px solid var(--line);}
  .lp-faq-item{border-bottom:1px solid var(--line);}
  .lp-faq-q{display:flex;align-items:center;justify-content:space-between;gap:16px;
    width:100%;padding:20px 0;background:transparent;border:none;cursor:pointer;
    font-size:16px;font-weight:500;color:var(--ink);text-align:left;line-height:1.4;}
  .lp-faq-q:hover{color:var(--accent);}
  .lp-faq-icon{flex-shrink:0;color:var(--muted);transition:transform .25s cubic-bezier(.22,1,.36,1);}
  .lp-faq-open .lp-faq-icon{transform:rotate(180deg);color:var(--accent);}
  .lp-faq-a{overflow:hidden;}
  .lp-faq-a p{padding:0 0 20px;font-size:15px;line-height:1.7;color:var(--muted);margin:0;}

  /* Gallery */
  .lp-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;}
  .lp-gallery-item{border-radius:12px;overflow:hidden;aspect-ratio:4/3;
    background:var(--paper-2);}
  .lp-gallery-img{width:100%;height:100%;object-fit:cover;transition:transform .4s cubic-bezier(.22,1,.36,1);}
  .lp-gallery-item:hover .lp-gallery-img{transform:scale(1.04);}

  /* Timer */
  .lp-timer-section{text-align:center;}
  .lp-timer-inner{position:relative;z-index:1;}
  .lp-timer-wrap{display:inline-block;}
  .lp-timer-label{font-size:12px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;
    color:var(--accent);margin-bottom:28px;}
  .lp-timer-grid{display:flex;gap:clamp(16px,4vw,32px);justify-content:center;}
  .lp-timer-cell{display:flex;flex-direction:column;align-items:center;gap:8px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
    border-radius:16px;padding:20px 28px;min-width:80px;}
  .lp-timer-num{font-size:clamp(2rem,5vw,3.5rem);font-weight:600;line-height:1;color:#fff;
    letter-spacing:-.02em;}
  .lp-timer-unit{font-size:11px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;
    color:rgba(255,255,255,.45);}

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
    .lp-timer-grid{gap:12px;}
    .lp-timer-cell{padding:14px 18px;min-width:60px;}
    .lp-gallery{grid-template-columns:repeat(2,1fr);}
  }
  @media (prefers-reduced-motion:reduce){
    .lp-cta,.lp-benefit,.lp-syllabus-item,.lp-gallery-img{transition:none;}
  }

  /* ── Workshop edition ──────────────────────────────────────────
     A warmer, more tactile system for courses made by real people. */
  .lp-root{
    --ink:#17242a;
    --ink-2:#22343a;
    --paper:#f7f3eb;
    --paper-2:#ece7dc;
    --paper-3:#fffaf2;
    --line:rgba(23,36,42,.14);
    --muted:#637078;
    font-family:'DM Sans',system-ui,sans-serif;
    background:var(--paper);
  }
  .lp-root:before{content:"";position:fixed;inset:0;pointer-events:none;z-index:50;
    opacity:.025;background-image:${grain};background-size:180px 180px;mix-blend-mode:multiply;}
  .lp-container{max-width:1180px;padding:0 clamp(20px,4vw,56px);}
  .lp-serif{font-family:'Cormorant Garamond',Georgia,serif;}
  .lp-header{height:76px;background:rgba(23,36,42,.92);border:0;box-shadow:0 12px 30px rgba(23,36,42,.12);}
  .lp-header-inner{height:76px;}
  .lp-brand{gap:12px;}
  .lp-brand-mark{height:34px;width:34px;border-radius:50%;box-shadow:none;background:var(--accent);}
  .lp-brand-name{font-size:21px;letter-spacing:-.02em;}
  .lp-logo{max-height:34px;}
  .lp-header-actions{gap:22px;}
  .lp-link-ghost{font-size:13px;letter-spacing:.01em;color:rgba(255,255,255,.68);}
  .lp-cta{border-radius:5px;font-size:14px;letter-spacing:.01em;padding:15px 22px;}
  .lp-cta-solid{box-shadow:5px 5px 0 rgba(255,255,255,.14);}
  .lp-cta-solid:hover{transform:translate(-2px,-2px);box-shadow:8px 8px 0 rgba(255,255,255,.14);}
  .lp-cta-mini{padding:11px 16px;font-size:12px;box-shadow:none;}
  .lp-cta-ghost{border-radius:5px;}

  .lp-hero{min-height:min(760px,calc(100vh - 76px));display:flex;align-items:center;
    padding:clamp(76px,10vw,132px) 0 clamp(82px,11vw,140px);
    background:var(--ink);isolation:isolate;}
  .lp-hero:after{content:"";position:absolute;z-index:0;width:38vw;height:38vw;right:-12vw;top:12%;
    border:1px solid ${accent}55;border-radius:50%;box-shadow:0 0 0 46px ${accent}0d,0 0 0 92px ${accent}08;
    opacity:.8;}
  .lp-hero-glow{background:radial-gradient(36rem 30rem at 76% 28%,${accent}4d,transparent 65%),
    radial-gradient(35rem 24rem at 8% 100%,${accent}1c,transparent 65%);}
  .lp-hero-grid{opacity:.22;background-size:72px 72px;}
  .lp-grain{opacity:.08;}
  .lp-hero-inner{max-width:1180px;}
  .lp-eyebrow{font-size:11px;letter-spacing:.27em;margin-bottom:30px;color:rgba(255,255,255,.62);}
  .lp-eyebrow-dot{height:8px;width:8px;box-shadow:none;}
  .lp-hero-title{font-size:clamp(3.5rem,8.7vw,8.2rem);line-height:.88;letter-spacing:-.045em;
    max-width:10ch;margin-bottom:34px;font-weight:500;}
  .lp-hero-accent{font-weight:400;color:var(--accent);background:none;}
  .lp-hero-sub{max-width:48ch;font-size:clamp(1rem,1.5vw,1.18rem);line-height:1.65;
    color:rgba(255,255,255,.66);margin-bottom:34px;}
  .lp-hero-cta{gap:12px;}
  .lp-hero-meta{max-width:640px;gap:0;justify-content:space-between;margin-top:56px;padding-top:18px;
    border-top:1px solid rgba(255,255,255,.18);font-size:11px;letter-spacing:.12em;text-transform:uppercase;}
  .lp-hero-meta span{display:flex;flex-direction:column;gap:6px;color:rgba(255,255,255,.48);}
  .lp-hero-meta strong{font-family:'Cormorant Garamond',Georgia,serif;font-size:27px;line-height:1;
    letter-spacing:0;color:#fff;font-weight:600;}

  .lp-section{padding:clamp(76px,10vw,134px) 0;}
  .lp-section-light{background:var(--paper);}
  .lp-section-paper{background:var(--paper-2);}
  .lp-section-head{margin-bottom:48px;max-width:650px;}
  .lp-kicker{font-size:10px;letter-spacing:.25em;margin-bottom:17px;}
  .lp-h2{font-size:clamp(2.6rem,5vw,4.5rem);line-height:.94;letter-spacing:-.035em;font-weight:500;}
  .lp-benefits{grid-template-columns:repeat(3,1fr);gap:0;border-top:1px solid var(--line);}
  .lp-benefit{min-height:142px;border:0;border-bottom:1px solid var(--line);border-radius:0;
    background:transparent;padding:25px 28px 25px 0;box-shadow:none;font-size:15px;line-height:1.55;}
  .lp-benefit:nth-child(3n+2),.lp-benefit:nth-child(3n+3){padding-left:28px;border-left:1px solid var(--line);}
  .lp-benefit:hover{transform:none;background:${accent}0b;border-color:var(--line);box-shadow:none;padding-top:21px;padding-bottom:29px;}
  .lp-benefit-check{height:28px;width:28px;border-radius:50%;background:${accent}20;}

  .lp-split{grid-template-columns:minmax(0,.86fr) minmax(0,1.14fr);gap:clamp(60px,10vw,150px);}
  .lp-about{position:relative;padding-top:4px;}
  .lp-about:before{content:"";position:absolute;left:-22px;top:0;height:58px;width:3px;background:var(--accent);}
  .lp-about-text{font-size:clamp(1.65rem,3vw,2.6rem);line-height:1.16;letter-spacing:-.025em;font-weight:500;}
  .lp-syllabus-item{gap:24px;padding:19px 0;border-top:1px solid var(--line);}
  .lp-syllabus-item:last-child{border-bottom:1px solid var(--line);}
  .lp-syllabus-item:hover{padding-left:10px;background:${accent}08;}
  .lp-syllabus-num{font-size:1.9rem;min-width:2.4ch;font-weight:500;}
  .lp-syllabus-title{font-size:15px;letter-spacing:.01em;}

  .lp-section-ink{background:var(--ink);color:#fff;}
  .lp-quote-wrap{max-width:900px;padding-left:clamp(30px,8vw,110px);padding-right:clamp(30px,8vw,110px);}
  .lp-quote-mark{height:34px;width:34px;margin-bottom:25px;}
  .lp-quote{font-size:clamp(2.1rem,4.6vw,4.4rem);line-height:1.02;letter-spacing:-.03em;font-weight:400;}
  .lp-quote-name{font-size:13px;letter-spacing:.06em;text-transform:uppercase;}
  .lp-quote-note{font-size:10px;text-transform:uppercase;letter-spacing:.14em;}

  .lp-video-wrap{border-radius:4px;box-shadow:18px 18px 0 ${accent}2b;}
  .lp-faq-section{max-width:820px;}
  .lp-faq{border-top:2px solid var(--ink);}
  .lp-faq-item{border-bottom:1px solid var(--line);}
  .lp-faq-q{padding:23px 0;font-size:16px;font-weight:600;}
  .lp-faq-a p{padding-bottom:24px;max-width:65ch;}
  .lp-gallery{grid-template-columns:repeat(12,1fr);gap:14px;}
  .lp-gallery-item{grid-column:span 4;border-radius:3px;aspect-ratio:1.15;box-shadow:0 14px 30px rgba(23,36,42,.08);}
  .lp-gallery-item:nth-child(2){grid-column:span 5;aspect-ratio:1.45;}
  .lp-gallery-item:nth-child(3){grid-column:span 3;aspect-ratio:1;}
  .lp-gallery-img{filter:saturate(.84);transition:transform .5s cubic-bezier(.22,1,.36,1),filter .5s;}
  .lp-gallery-item:hover .lp-gallery-img{transform:scale(1.06);filter:saturate(1);}
  .lp-timer-section{background:var(--ink);}
  .lp-timer-label{font-size:10px;letter-spacing:.25em;}
  .lp-timer-grid{gap:8px;}
  .lp-timer-cell{border-radius:3px;background:rgba(255,255,255,.05);padding:23px 28px;min-width:105px;}
  .lp-timer-num{font-size:clamp(2.4rem,5vw,4.6rem);font-weight:400;}

  .lp-final{padding-top:clamp(76px,10vw,130px);}
  .lp-final-card{border-radius:3px;padding:clamp(58px,9vw,110px) 24px;box-shadow:16px 16px 0 ${accent}32;}
  .lp-final-glow{background:radial-gradient(34rem 20rem at 50% 0,${accent}4c,transparent 66%);}
  .lp-final-title{font-size:clamp(3rem,6vw,5.4rem);line-height:.9;font-weight:500;letter-spacing:-.04em;}
  .lp-final-sub{font-size:15px;color:rgba(255,255,255,.67);}
  .lp-footer{background:var(--ink);border-top:1px solid rgba(255,255,255,.13);padding:30px 0;}
  .lp-footer-title{font-size:20px;font-weight:500;}

  @media (max-width:840px){
    .lp-benefits{grid-template-columns:repeat(2,1fr);}
    .lp-benefit:nth-child(3n+2),.lp-benefit:nth-child(3n+3){padding-left:0;border-left:0;}
    .lp-benefit:nth-child(2n){padding-left:22px;border-left:1px solid var(--line);}
    .lp-gallery-item,.lp-gallery-item:nth-child(2),.lp-gallery-item:nth-child(3){grid-column:span 6;}
  }
  @media (max-width:720px){
    .lp-header,.lp-header-inner{height:64px;}
    .lp-header-actions{gap:0;}
    .lp-header-actions .lp-link-ghost{display:none;}
    .lp-hero{min-height:calc(100vh - 64px);}
    .lp-hero-title{font-size:clamp(3.4rem,17vw,6rem);max-width:9ch;}
    .lp-hero-meta{gap:18px;justify-content:flex-start;}
    .lp-hero-meta span{font-size:9px;}
    .lp-hero-meta strong{font-size:22px;}
    .lp-benefits,.lp-split{grid-template-columns:1fr;}
    .lp-benefit,.lp-benefit:nth-child(2n){padding-left:0;border-left:0;}
    .lp-benefit:nth-child(n){padding-right:0;}
    .lp-split{gap:70px;}
    .lp-about:before{left:-12px;}
    .lp-gallery{grid-template-columns:repeat(2,1fr);}
    .lp-gallery-item,.lp-gallery-item:nth-child(2),.lp-gallery-item:nth-child(3){grid-column:span 1;}
    .lp-gallery-item:nth-child(2){grid-column:span 2;}
    .lp-timer-grid{gap:5px;}
    .lp-timer-cell{padding:16px 10px;min-width:0;flex:1;}
    .lp-timer-unit{font-size:9px;letter-spacing:.08em;}
    .lp-final-actions .lp-cta{width:100%;justify-content:center;}
  }
  `;
}
