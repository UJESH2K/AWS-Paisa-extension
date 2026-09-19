import type { ReactNode } from "react";

export function Card({
  title,
  aside,
  children,
  className = "",
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      {(title || aside) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{title}</h2>
          )}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn";
}) {
  const tones = {
    neutral: "border-line text-muted",
    accent: "border-accent/40 bg-accent-soft text-accent",
    warn: "border-markup/40 bg-markup/10 text-markup",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const styles =
    variant === "primary"
      ? "bg-accent text-bg hover:bg-[#8ab8ff] disabled:bg-raised disabled:text-faint"
      : "border border-line text-fg hover:bg-raised disabled:text-faint";
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
