import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { formatPounds } from "../format";
import { usePrefersReducedMotion } from "../hooks";
import { errorFor, type PropertyChoice, type WindowsState } from "../state";
import type { Config, ConservatoryChoice, FieldError, LanternSize, WindowsFrequency } from "../types";
import { FieldMessage, MoneyInput, Section, Segmented, Stepper, Switch, TextInput } from "./controls";

export const WINDOWS_FIELDS = [
  "property.bedrooms",
  "property.description",
  "property.price",
  "property.kind",
  "frequency",
  "conservatory",
  "large_conservatory_price",
  "internal",
  "conservatory_roof.external_panels",
  "conservatory_roof.internal_panels",
  "velux.external",
  "velux.internal",
  ...(["small", "medium", "large"] as const).flatMap((s) => [`lanterns.${s}.external`, `lanterns.${s}.internal`]),
  "lanterns.larger_price",
  "override.total",
  "override.reason",
];

export const PROPERTY_OPTIONS: { value: PropertyChoice; label: ReactNode; sub: string; aria: string }[] = [
  { value: "1", label: "1", sub: "bed", aria: "1 bed" },
  { value: "2", label: "2", sub: "bed", aria: "2 bed" },
  { value: "3", label: "3", sub: "bed", aria: "3 bed" },
  { value: "4", label: "4", sub: "bed", aria: "4 bed" },
  { value: "5", label: "5", sub: "bed", aria: "5 bed" },
  { value: "other", label: "Other", sub: "property", aria: "Other property" },
];

const LANTERN_SIZES: LanternSize[] = ["small", "medium", "large"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Height + fade reveal for conditional fields. */
export function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className="reveal"
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <div className="reveal__inner">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function WindowsForm({
  config,
  state,
  set,
  errors,
}: {
  config: Config;
  state: WindowsState;
  set: (patch: Partial<WindowsState>) => void;
  errors: FieldError[];
}) {
  const w = config.windows;
  const isOther = state.property === "other";
  const err = (...f: string[]) => errorFor(errors, ...f);
  const roofCount =
    state.roof.external +
    state.roof.internal +
    state.velux.external +
    state.velux.internal +
    LANTERN_SIZES.reduce((n, s) => n + state.lanterns[s].external + state.lanterns[s].internal, 0) +
    (state.largerLantern ? 1 : 0);

  const freqOptions: { value: WindowsFrequency; label: ReactNode; sub: string; aria: string }[] = [
    ...w.frequencies.map((f) => ({ value: f as WindowsFrequency, label: f, sub: "weeks", aria: `Every ${f} weeks` })),
    { value: "one_off", label: "One-off", sub: "single visit", aria: "One-off" },
  ];

  const setLantern = (size: LanternSize, side: "external" | "internal", n: number) =>
    set({ lanterns: { ...state.lanterns, [size]: { ...state.lanterns[size], [side]: n } } });

  return (
    <div className="form">
      <Section title="Property">
        <Segmented
          label="Property size"
          labelHidden
          size="lg"
          options={PROPERTY_OPTIONS}
          value={state.property}
          onChange={(v) => set({ property: v })}
        />
        {err("property.bedrooms", "property.kind") && (
          <FieldMessage tone="error">{err("property.bedrooms", "property.kind")}</FieldMessage>
        )}
        <Reveal show={isOther}>
          <div className="field-row">
            <TextInput
              label="Describe the property"
              placeholder="e.g. 6 bed detached with annexe"
              value={state.otherDescription}
              onChange={(v) => set({ otherDescription: v })}
              error={err("property.description")}
            />
            <MoneyInput
              label="Your window price"
              value={state.otherPrice}
              onChange={(v) => set({ otherPrice: v })}
              error={err("property.price")}
              hint="Outside windows, per visit"
            />
          </div>
        </Reveal>
      </Section>

      <Section title="How often">
        <Segmented
          label="Frequency"
          labelHidden
          size="lg"
          options={freqOptions}
          value={state.frequency}
          onChange={(v) => set({ frequency: v })}
        />
        {err("frequency") && <FieldMessage tone="error">{err("frequency")}</FieldMessage>}
      </Section>

      <Section title="Conservatory or extension">
        {isOther ? (
          <p className="muted-note">Include any conservatory or extension in your price for another property.</p>
        ) : (
          <>
            <Segmented<ConservatoryChoice>
              label="Conservatory or extension"
              labelHidden
              options={[
                { value: "none", label: "None" },
                { value: "standard", label: "Standard" },
                { value: "large", label: "Larger than average" },
              ]}
              value={state.conservatory}
              onChange={(v) => set({ conservatory: v })}
            />
            {err("conservatory") && <FieldMessage tone="error">{err("conservatory")}</FieldMessage>}
            <Reveal show={state.conservatory === "large"}>
              <div className="field-row field-row--start">
                <MoneyInput
                  label="Conservatory charge"
                  value={state.largeConservatoryPrice}
                  onChange={(v) => set({ largeConservatoryPrice: v })}
                  error={err("large_conservatory_price")}
                  hint={state.frequency === "one_off" ? "Added to the one-off price" : "Replaces the standard add-on"}
                />
                <FieldMessage tone="warning">{config.warnings.large_conservatory}</FieldMessage>
              </div>
            </Reveal>
          </>
        )}
      </Section>

      <Section title="Inside windows">
        <Switch
          label="Clean the inside windows too"
          description={`Charged at ${w.internal_multiplier}× the outside window price, ${
            state.frequency === "one_off" ? "once" : "on every visit"
          }.`}
          checked={state.internal}
          onChange={(v) => set({ internal: v })}
        />
        {err("internal") && <FieldMessage tone="error">{err("internal")}</FieldMessage>}
      </Section>

      <Section
        title="Roof glass"
        aside={
          roofCount > 0 ? (
            <span className="count-pill">
              {roofCount} {roofCount === 1 ? "item" : "items"}
            </span>
          ) : (
            <span className="section__hint">
              {state.frequency === "one_off" ? "Charged once" : "Charged every visit"}
            </span>
          )
        }
      >
        <div className="roof">
          <fieldset className="roof__group">
            <legend className="roof__legend">Conservatory roof</legend>
            <div className="roof__pair">
              <Stepper
                label="Outside panels"
                ariaLabel="Conservatory roof outside panels"
                hint={`${formatPounds(w.conservatory_roof.external_per_panel)} each, ${formatPounds(
                  w.conservatory_roof.external_minimum,
                )} min`}
                value={state.roof.external}
                onChange={(n) => set({ roof: { ...state.roof, external: n } })}
                error={err("conservatory_roof.external_panels")}
              />
              <Stepper
                label="Inside panels"
                ariaLabel="Conservatory roof inside panels"
                hint={`${formatPounds(w.conservatory_roof.internal_per_panel)} each`}
                value={state.roof.internal}
                onChange={(n) => set({ roof: { ...state.roof, internal: n } })}
                error={err("conservatory_roof.internal_panels")}
              />
            </div>
          </fieldset>

          <fieldset className="roof__group">
            <legend className="roof__legend">Velux windows</legend>
            <div className="roof__pair">
              <Stepper
                label="Outside"
                ariaLabel="Velux windows outside"
                hint={`${formatPounds(w.velux.external_each)} each`}
                value={state.velux.external}
                onChange={(n) => set({ velux: { ...state.velux, external: n } })}
                error={err("velux.external")}
              />
              <Stepper
                label="Inside"
                ariaLabel="Velux windows inside"
                hint={`${formatPounds(w.velux.internal_each)} each`}
                value={state.velux.internal}
                onChange={(n) => set({ velux: { ...state.velux, internal: n } })}
                error={err("velux.internal")}
              />
            </div>
          </fieldset>

          <fieldset className="roof__group roof__group--lanterns">
            <legend className="roof__legend">Roof lanterns</legend>
            <div className="lantern-grid">
              <span className="lantern-grid__head" aria-hidden="true" />
              <span className="lantern-grid__head" aria-hidden="true">
                Outside
              </span>
              <span className="lantern-grid__head" aria-hidden="true">
                Inside
              </span>
              {LANTERN_SIZES.map((size) => (
                <div className="lantern-grid__row" key={size}>
                  <span className="lantern-grid__size" aria-hidden="true">
                    {cap(size)}
                  </span>
                  <Stepper
                    label={`${cap(size)} lanterns outside`}
                    hint={`${formatPounds(w.lanterns[size].external)} each`}
                    value={state.lanterns[size].external}
                    onChange={(n) => setLantern(size, "external", n)}
                    error={err(`lanterns.${size}.external`)}
                  />
                  <Stepper
                    label={`${cap(size)} lanterns inside`}
                    hint={`${formatPounds(w.lanterns[size].internal)} each`}
                    value={state.lanterns[size].internal}
                    onChange={(n) => setLantern(size, "internal", n)}
                    error={err(`lanterns.${size}.internal`)}
                  />
                </div>
              ))}
            </div>
            <div className="roof__larger">
              <Switch
                label="Larger structure"
                description="A lantern or glass structure too big for the sizes above."
                checked={state.largerLantern}
                onChange={(v) => set({ largerLantern: v })}
              />
              <Reveal show={state.largerLantern}>
                <div className="field-row field-row--start">
                  <MoneyInput
                    label="Price for the structure"
                    value={state.largerLanternPrice}
                    onChange={(v) => set({ largerLanternPrice: v })}
                    error={err("lanterns.larger_price")}
                  />
                  <FieldMessage tone="warning">{config.warnings.larger_lantern}</FieldMessage>
                </div>
              </Reveal>
            </div>
          </fieldset>
        </div>
      </Section>
    </div>
  );
}
