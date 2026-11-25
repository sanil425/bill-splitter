import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

const BUTTON = {
  primary: "bg-primary text-white hover:bg-primary-hover disabled:bg-line disabled:text-muted",
  secondary: "border border-stone-300 bg-white text-ink hover:bg-stone-50",
  dark: "bg-ink text-white hover:bg-stone-800",
};

const SIZE = { md: "h-13 rounded-btn text-base", sm: "h-11 rounded-ib text-[15px]" };

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON; size?: keyof typeof SIZE }) {
  return (
    <button
      type="button"
      className={cx("px-4 font-semibold disabled:cursor-not-allowed", SIZE[size], BUTTON[variant], className)}
      {...props}
    />
  );
}

/** Square 44px icon button. Always pass aria-label; add a rounded-* class if it has a border or fill. */
export function IconButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return (
    <button
      type="button"
      className={cx("flex size-11 flex-none items-center justify-center text-ink", className)}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-card border border-line bg-white", className)}>{children}</div>;
}

/** Toggle pill (aria-pressed) or plain pill button. */
export function Pill({ on, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cx(
        "relative inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium",
        // invisible hit area keeps the touch target at 44px
        "after:absolute after:-inset-y-1 after:inset-x-0",
        on ? "border-primary bg-primary-tint text-primary-hover" : "border-stone-300 bg-white text-ink",
        className,
      )}
      {...props}
    />
  );
}

const AVATAR_COLOURS = ["bg-av-1", "bg-av-2", "bg-av-3", "bg-av-4"];

export function Avatar({ name, index, size = "sm" }: { name: string; index: number; size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex flex-none items-center justify-center rounded-full font-semibold text-white",
        size === "sm" ? "size-7 text-xs" : "size-9 text-sm",
        AVATAR_COLOURS[index % AVATAR_COLOURS.length],
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold tracking-wider text-muted uppercase">{children}</div>;
}

export function TopBar({ title, subtitle, backHref, backLabel = "Back" }: { title: string; subtitle: string; backHref: string; backLabel?: string }) {
  return (
    <header className="flex items-center gap-3 px-5 pt-5 pb-2">
      <Link
        href={backHref}
        aria-label={backLabel}
        className="flex size-11 flex-none items-center justify-center rounded-ib border border-line bg-white text-ink"
      >
        <ChevronLeft />
      </Link>
      <div className="flex-1">
        <h1 className="font-heading text-xl font-bold">{title}</h1>
        <div className="text-[13px] text-muted">{subtitle}</div>
      </div>
    </header>
  );
}

export function BottomBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "sticky bottom-0 border-t border-line bg-white px-5 pt-3 pb-[max(1.75rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {children}
    </div>
  );
}

const svg = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const ChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2" {...svg}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
export const CameraIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth="1.8" {...svg}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="2" {...svg}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
);
export const PlusIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="2" {...svg}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const MicIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="2" {...svg}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0014 0M12 18v3" />
  </svg>
);
export const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="3" {...svg}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);
