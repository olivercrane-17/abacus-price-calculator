/** The Abacus Window Cleaning Ltd wordmark, set in type. `light` is for use on royal blue. */
export function Logo({ variant = "dark", size = "md" }: { variant?: "dark" | "light"; size?: "sm" | "md" }) {
  return (
    <span className={`logo logo--${variant} logo--${size}`} role="img" aria-label="Abacus Window Cleaning Ltd">
      <span className="logo__word" aria-hidden="true">
        Abacus
      </span>
      <span className="logo__sub" aria-hidden="true">
        Window Cleaning Ltd
      </span>
    </span>
  );
}
