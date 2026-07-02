import type { Dictionary } from "@/lib/i18n";
import { LINKS } from "@/lib/links";
import { IconArrowRight, IconGitHub } from "@/components/icons";

export function FinalCta({ dict }: { dict: Dictionary }) {
  const c = dict.cta;
  return (
    <section className="section">
      <div className="container">
        <div className="cta-band">
          <h2>{c.title}</h2>
          <p className="lead">{c.lead}</p>
          <div className="cta-actions">
            <a className="btn btn-primary btn-lg" href={LINKS.releases} target="_blank" rel="noreferrer">
              {c.primary}
              <IconArrowRight className="arrow" width={18} height={18} />
            </a>
            <a className="btn btn-ghost btn-lg" href={LINKS.github} target="_blank" rel="noreferrer">
              <IconGitHub width={18} height={18} />
              {c.secondary}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
