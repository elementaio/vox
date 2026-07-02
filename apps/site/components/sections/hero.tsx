import type { Dictionary } from "@/lib/i18n";
import { LINKS } from "@/lib/links";
import { AppWindow } from "@/components/mockups/app-window";
import { IconArrowRight, IconCheck } from "@/components/icons";

export function Hero({ dict }: { dict: Dictionary }) {
  const h = dict.hero;
  return (
    <section className="hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <span className="hero-badge">
            <span className="dot" />
            {h.badge}
          </span>

          <h1>{h.title}</h1>
          <p className="lead">{h.subtitle}</p>

          <div className="hero-cta">
            <a className="btn btn-primary btn-lg" href={LINKS.releases} target="_blank" rel="noreferrer">
              {h.ctaPrimary}
              <IconArrowRight className="arrow" width={18} height={18} />
            </a>
            <a className="btn btn-ghost btn-lg" href="#developers">
              {h.ctaSecondary}
            </a>
          </div>

          <p className="hero-micro">
            <IconCheck />
            {h.microcopy}
          </p>

          <div className="hero-trust">
            {h.trust.map((t) => (
              <span className="chip" key={t}>
                <span className="dot" />
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="hero-media">
          <AppWindow dict={dict} />
        </div>
      </div>
    </section>
  );
}
