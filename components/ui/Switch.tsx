"use client";

import type { ReactNode } from "react";

/**
 * An on/off switch with its label. One <button role="switch"> so the
 * whole row is the target; the stepped track is `switch-chunk` (see
 * "The kit" in app/globals.css) and takes its colour from --accent.
 */
export default function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className = "",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex min-h-11 items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
    >
      <span className="switch-chunk" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-bold text-ink">{label}</span>
        {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
      </span>
    </button>
  );
}
