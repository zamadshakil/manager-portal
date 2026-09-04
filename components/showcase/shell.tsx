import Link from "next/link";
import { ArrowUpRight, Layers3 } from "lucide-react";
import "./showcase.css";

export function ShowcaseShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="showcase">
      <header className="sc-header">
        <Link className="sc-brand" href="/showcase">
          <Layers3 aria-hidden="true" size={27} /> Hierarchia
          <span>by ZamDev AI</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/showcase#workflows">Who it’s for</Link>
          <Link href="/showcase/calculator">Review calculator</Link>
          <Link href="/showcase/demo">Try the demo</Link>
          <Link className="sc-button small" href="/showcase/audit">
            Request a workflow audit{" "}
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      {children}
      <footer className="sc-footer">
        <div>
          <Link className="sc-brand" href="/showcase">
            <Layers3 size={24} aria-hidden="true" /> Hierarchia
          </Link>
          <p>Document operations, shaped around your team.</p>
        </div>
        <div>
          <a href="mailto:mail@zamdevai.com">mail@zamdevai.com</a>
          <Link href="/showcase/privacy">Privacy</Link>
          <a
            href="https://www.linkedin.com/in/zamad-gopang/"
            target="_blank"
            rel="noopener noreferrer"
          >
            LinkedIn ↗
          </a>
        </div>
        <p className="sc-fine">
          Preview · Sample data only · No payment required
        </p>
      </footer>
    </div>
  );
}
