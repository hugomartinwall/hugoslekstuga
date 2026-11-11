"use client";

import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";

/**
 * Fields — a framed well around a native input.
 *
 * The frame lives on a wrapper (`field-chunk`), because the stepped
 * ring is a pseudo-element and inputs cannot have those; focus on the
 * input lights the wrapper's ring. Text is 16px so iPhones do not zoom
 * the page when the field is tapped.
 *
 * Every field takes a `label`. Pass `hideLabel` when a visible label
 * would be noise (the label is still read out).
 */
type Shared = {
  label: string;
  hideLabel?: boolean;
  hint?: ReactNode;
  /** Classes for the outer block (width, margins). */
  className?: string;
  /** Classes for the framed well itself. */
  wellClassName?: string;
  /** Content inside the well, after the input (a unit, a small key). */
  trailing?: ReactNode;
};

function FieldShell({
  id,
  label,
  hideLabel,
  hint,
  className = "",
  wellClassName = "",
  trailing,
  children,
}: Shared & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={hideLabel ? "sr-only" : "label-pixel mb-1.5 block"}
      >
        {label}
      </label>
      <div className={`field-chunk ${wellClassName}`.trim()}>
        {children}
        {trailing}
      </div>
      {hint ? <p className="mt-1.5 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function TextField({
  label,
  hideLabel,
  hint,
  className,
  wellClassName,
  trailing,
  id,
  inputClassName = "",
  ...input
}: Shared & { inputClassName?: string } & Omit<
    ComponentPropsWithoutRef<"input">,
    "className"
  >) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell
      id={fieldId}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      className={className}
      wellClassName={wellClassName}
      trailing={trailing}
    >
      <input
        id={fieldId}
        type="text"
        className={inputClassName || undefined}
        {...input}
      />
    </FieldShell>
  );
}

export function TextArea({
  label,
  hideLabel,
  hint,
  className,
  wellClassName = "",
  trailing,
  id,
  inputClassName = "",
  ...input
}: Shared & { inputClassName?: string } & Omit<
    ComponentPropsWithoutRef<"textarea">,
    "className"
  >) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell
      id={fieldId}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      className={className}
      wellClassName={`items-stretch ${wellClassName}`}
      trailing={trailing}
    >
      <textarea
        id={fieldId}
        className={`resize-y ${inputClassName}`.trim()}
        {...input}
      />
    </FieldShell>
  );
}
