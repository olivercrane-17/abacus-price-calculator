import { useId, useRef, type KeyboardEvent } from "react";
import { formatPounds } from "../format";
import { errorFor, type GuttersState } from "../state";
import type { Config, FieldError, GutterService } from "../types";
import { FieldMessage, MoneyInput, Section, Segmented, Switch, TextInput } from "./controls";
import { PROPERTY_OPTIONS, Reveal } from "./WindowsForm";

export const GUTTERS_FIELDS = [
  "property.bedrooms",
  "property.description",
  "property.kind",
  "service",
  "conservatory",
  "heavily_soiled",
  "manual_price",
  "override.total",
  "override.reason",
];

export const guttersFields = (n: number) => [
  ...GUTTERS_FIELDS,
  ...Array.from({ length: n }, (_, i) => [
    `extras.${i}`,
    `extras.${i}.name`,
    `extras.${i}.selected`,
    `extras.${i}.price`,
  ]).flat(),
];

const SERVICE_ORDER: GutterService[] = ["clearance", "outer", "package3"];
const SERVICE_SHORT: Record<GutterService, { name: string; detail: string }> = {
  clearance: { name: "Gutter Clearance", detail: "Clear out the gutters" },
  outer: { name: "Outer Gutter & Fascia", detail: "Clean the outside of gutters and fascias" },
  package3: { name: "Both: Package 3", detail: "Clearance plus outer clean, at the bundle price" },
};

function ServiceCards({
  config,
  state,
  onChange,
}: {
  config: Config;
  state: GuttersState;
  onChange: (s: GutterService) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const g = config.gutters;
  const sizePrices = state.property === "other" ? null : g.bedrooms[state.property];
  const idx = Math.max(0, SERVICE_ORDER.indexOf(state.service));

  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % 3;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i + 2) % 3;
    if (n < 0) return;
    e.preventDefault();
    onChange(SERVICE_ORDER[n]);
    refs.current[n]?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelId} className="service-cards">
      <span id={labelId} className="sr-only">
        Service
      </span>
      {SERVICE_ORDER.map((key, i) => {
        const checked = state.service === key;
        const sheet = sizePrices ? sizePrices[key][state.conservatory ? "with_cons" : "no_cons"] : null;
        return (
          <button
            key={key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === idx ? 0 : -1}
            className={`service-card ${key === "package3" ? "service-card--bundle" : ""}`}
            onClick={() => onChange(key)}
            onKeyDown={(e) => onKey(e, i)}
            title={g.services[key]}
          >
            <span className="service-card__radio" aria-hidden="true" />
            <span className="service-card__name">{SERVICE_SHORT[key].name}</span>
            <span className="service-card__detail">{SERVICE_SHORT[key].detail}</span>
            <span className="service-card__price">
              {sheet !== null ? (
                <>
                  {formatPounds(sheet)}
                  {state.heavilySoiled && (
                    <span className="service-card__x">× {g.heavily_soiled_multiplier} heavily soiled</span>
                  )}
                </>
              ) : (
                <span className="service-card__staff">Your price</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function GuttersForm({
  config,
  state,
  set,
  errors,
}: {
  config: Config;
  state: GuttersState;
  set: (patch: Partial<GuttersState>) => void;
  errors: FieldError[];
}) {
  const g = config.gutters;
  const isOther = state.property === "other";
  const staffPriced = isOther || g.bedrooms[state.property] == null;
  const err = (...f: string[]) => errorFor(errors, ...f);
  const propertyWarning = isOther
    ? config.warnings.other_property
    : state.property === "1"
      ? config.warnings.gutters_1_bed
      : null;

  const setExtra = (i: number, patch: Partial<GuttersState["extras"][number]>) =>
    set({ extras: state.extras.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

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
              placeholder="e.g. Bungalow with long rear extension"
              value={state.otherDescription}
              onChange={(v) => set({ otherDescription: v })}
              error={err("property.description")}
            />
          </div>
        </Reveal>
        <Reveal show={staffPriced}>
          <div className="field-row field-row--start">
            <MoneyInput
              label="Your price for this job"
              value={state.manualPrice}
              onChange={(v) => set({ manualPrice: v })}
              error={err("manual_price")}
              hint="There's no set price, so enter the full price"
            />
            {propertyWarning && <FieldMessage tone="warning">{propertyWarning}</FieldMessage>}
          </div>
        </Reveal>
      </Section>

      <Section title="Service">
        <ServiceCards config={config} state={state} onChange={(s) => set({ service: s })} />
        {err("service") && <FieldMessage tone="error">{err("service")}</FieldMessage>}
      </Section>

      <Section title="Conservatory or extension">
        <Segmented
          label="Conservatory or extension"
          labelHidden
          options={[
            { value: "no", label: "No" },
            { value: "yes", label: "Yes" },
          ]}
          value={state.conservatory ? "yes" : "no"}
          onChange={(v) => set({ conservatory: v === "yes" })}
        />
        {err("conservatory") && <FieldMessage tone="error">{err("conservatory")}</FieldMessage>}
      </Section>

      <Section title="Condition">
        <Switch
          label="Heavily soiled"
          description={
            staffPriced
              ? "Not available when you enter the price yourself: include it in your price."
              : `Charges ${g.heavily_soiled_multiplier}× the price list for the chosen service.`
          }
          checked={staffPriced ? false : state.heavilySoiled}
          disabled={staffPriced}
          onChange={(v) => set({ heavilySoiled: v })}
        />
        {err("heavily_soiled") && <FieldMessage tone="error">{err("heavily_soiled")}</FieldMessage>}
      </Section>

      <Section
        title="Ask the customer about"
        aside={<span className="section__hint">Add a price, or leave it as TBC</span>}
      >
        <ul className="ask-list">
          {state.extras.map((x, i) => {
            const e = err(`extras.${i}.price`, `extras.${i}.name`, `extras.${i}.selected`, `extras.${i}`);
            return (
              <li key={x.name} className={`ask ${x.selected ? "is-selected" : ""}`}>
                <label className="ask__check">
                  <input
                    type="checkbox"
                    checked={x.selected}
                    onChange={(ev) => setExtra(i, { selected: ev.target.checked })}
                  />
                  <span className="ask__box" aria-hidden="true">
                    <svg viewBox="0 0 16 16">
                      <path d="M3 8.5l3.2 3L13 4.5" />
                    </svg>
                  </span>
                  <span className="ask__name">{x.name}</span>
                </label>
                <MoneyInput
                  label={`${x.name} price`}
                  labelHidden
                  compact
                  placeholder="TBC"
                  value={x.price}
                  onChange={(v) => setExtra(i, { price: v, selected: v !== "" ? true : x.selected })}
                  error={e}
                />
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
