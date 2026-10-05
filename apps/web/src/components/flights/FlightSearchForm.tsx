'use client';

import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { AirportInput } from '@/components/AirportInput';
import {
  emptyLeg,
  FlightSearchState,
  MAX_LEGS,
  MIN_MULTI_CITY_LEGS,
  passengerSummary,
  validateSearch,
} from '@/lib/flight-search';
import { CabinClass, FlightLegCriteria, TripType } from '@/lib/types';

const TRIP_TYPES: Array<{ value: TripType; label: string }> = [
  { value: 'ONE_WAY', label: 'One way' },
  { value: 'ROUND_TRIP', label: 'Round trip' },
  { value: 'MULTI_CITY', label: 'Multi-city' },
];

const CABINS: Array<{ value: CabinClass; label: string }> = [
  { value: 'ECONOMY', label: 'Economy' },
  { value: 'PREMIUM_ECONOMY', label: 'Premium economy' },
  { value: 'BUSINESS', label: 'Business' },
  { value: 'FIRST', label: 'First' },
];

const EASE = [0.22, 1, 0.36, 1] as const;

const FIELD_INPUT =
  'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm uppercase text-slate-900 shadow-sm transition focus:border-amber-500 focus:outline-none focus:ring-4 focus:ring-amber-500/15';
const FIELD_LABEL = 'block text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500';
const DATE_INPUT =
  'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-amber-500 focus:outline-none focus:ring-4 focus:ring-amber-500/15';

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-lg leading-none text-slate-700 transition hover:border-amber-500 hover:text-amber-600 disabled:opacity-30 disabled:hover:border-slate-300 disabled:hover:text-slate-700"
        >
          −
        </button>
        <span className="w-4 text-center text-sm font-semibold tabular-nums text-slate-900">{value}</span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-lg leading-none text-slate-700 transition hover:border-amber-500 hover:text-amber-600 disabled:opacity-30 disabled:hover:border-slate-300 disabled:hover:text-slate-700"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function FlightSearchForm({
  idPrefix,
  value,
  onChange,
  onSubmit,
  busy = false,
  submitLabel = 'Search flights',
  className = '',
}: {
  idPrefix: string;
  value: FlightSearchState;
  onChange: (next: FlightSearchState) => void;
  onSubmit: (state: FlightSearchState) => void;
  busy?: boolean;
  submitLabel?: string;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [paxOpen, setPaxOpen] = useState(false);
  const paxRef = useRef<HTMLDivElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!paxOpen) return;
    function onDown(e: MouseEvent) {
      if (paxRef.current && !paxRef.current.contains(e.target as Node)) setPaxOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [paxOpen]);

  function patch(p: Partial<FlightSearchState>) {
    onChange({ ...value, ...p });
  }

  function setTripType(next: TripType) {
    setError(null);
    if (next === 'MULTI_CITY') {
      const legs = value.legs.length >= MIN_MULTI_CITY_LEGS ? [...value.legs] : [...value.legs, emptyLeg()];
      // A new multi-city leg starts where the previous one ended — the
      // overwhelmingly common itinerary shape.
      if (legs.length === 2 && !legs[1].origin) legs[1] = { ...legs[1], origin: legs[0].destination };
      patch({ tripType: next, legs });
    } else {
      patch({ tripType: next, legs: [value.legs[0] ?? emptyLeg()] });
    }
  }

  function updateLeg(index: number, p: Partial<FlightLegCriteria>) {
    patch({ legs: value.legs.map((leg, i) => (i === index ? { ...leg, ...p } : leg)) });
  }

  function addLeg() {
    if (value.legs.length >= MAX_LEGS) return;
    const last = value.legs[value.legs.length - 1];
    patch({ legs: [...value.legs, { ...emptyLeg(), origin: last?.destination ?? '' }] });
  }

  function removeLeg(index: number) {
    patch({ legs: value.legs.filter((_, i) => i !== index) });
  }

  function swap() {
    const leg = value.legs[0];
    updateLeg(0, { origin: leg.destination, destination: leg.origin });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validateSearch(value);
    setError(problem);
    if (!problem) onSubmit(value);
  }

  const multi = value.tripType === 'MULTI_CITY';
  const cabinLabel = CABINS.find((c) => c.value === value.cabinClass)?.label ?? 'Economy';

  return (
    <form onSubmit={handleSubmit} className={className} noValidate>
      {/* Trip type — a shared-layout pill slides between the options. */}
      <LayoutGroup id={`${idPrefix}-trip`}>
        <div role="tablist" aria-label="Trip type" className="inline-flex rounded-full bg-slate-100 p-1">
          {TRIP_TYPES.map((t) => {
            const active = value.tripType === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTripType(t.value)}
                className={`relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  active ? 'text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={`${idPrefix}-trip-pill`}
                    className="absolute inset-0 rounded-full bg-slate-900 shadow"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative">{t.label}</span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      <div className="mt-4 space-y-3">
        <AnimatePresence initial={false}>
          {value.legs.map((leg, index) => (
            <motion.div
              key={index}
              layout
              initial={{ opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -8 }}
              transition={{ duration: 0.32, ease: EASE }}
              className="relative"
            >
              <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_auto_1fr_1fr_1fr]">
                <div className="col-span-1">
                  <AirportInput
                    id={`${idPrefix}-leg-${index}-origin`}
                    label={multi ? `Flight ${index + 1} · From` : 'From'}
                    placeholder="LOS"
                    value={leg.origin}
                    onChange={(code) => updateLeg(index, { origin: code })}
                    inputClassName={FIELD_INPUT}
                    labelClassName={FIELD_LABEL}
                  />
                </div>

                <div className="hidden sm:block">
                  {!multi && index === 0 ? (
                    <motion.button
                      type="button"
                      onClick={swap}
                      aria-label="Swap origin and destination"
                      whileTap={{ rotate: 180, scale: 0.9 }}
                      transition={{ duration: 0.25 }}
                      className="mb-0.5 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-amber-500 hover:text-amber-600"
                    >
                      ⇄
                    </motion.button>
                  ) : (
                    <span className="mb-2.5 block w-10 text-center text-slate-300">→</span>
                  )}
                </div>

                <div className="col-span-1">
                  <AirportInput
                    id={`${idPrefix}-leg-${index}-destination`}
                    label="To"
                    placeholder="ABV"
                    value={leg.destination}
                    onChange={(code) => updateLeg(index, { destination: code })}
                    inputClassName={FIELD_INPUT}
                    labelClassName={FIELD_LABEL}
                  />
                </div>

                <div>
                  <label htmlFor={`${idPrefix}-leg-${index}-date`} className={FIELD_LABEL}>
                    Depart
                  </label>
                  <input
                    id={`${idPrefix}-leg-${index}-date`}
                    type="date"
                    min={index === 0 ? today : value.legs[index - 1]?.departureDate || today}
                    value={leg.departureDate}
                    onChange={(e) => updateLeg(index, { departureDate: e.target.value })}
                    className={DATE_INPUT}
                  />
                </div>

                <div className="col-span-2 sm:col-span-1">
                  {value.tripType === 'ROUND_TRIP' && index === 0 && (
                    <>
                      <label htmlFor={`${idPrefix}-return`} className={FIELD_LABEL}>
                        Return
                      </label>
                      <input
                        id={`${idPrefix}-return`}
                        type="date"
                        min={leg.departureDate || today}
                        value={value.returnDate}
                        onChange={(e) => patch({ returnDate: e.target.value })}
                        className={DATE_INPUT}
                      />
                    </>
                  )}
                  {multi && value.legs.length > MIN_MULTI_CITY_LEGS && (
                    <button
                      type="button"
                      onClick={() => removeLeg(index)}
                      aria-label={`Remove flight ${index + 1}`}
                      className="mb-0.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {multi && value.legs.length < MAX_LEGS && (
            <motion.button
              key="add-leg"
              type="button"
              onClick={addLeg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-amber-500 hover:bg-amber-50 hover:text-amber-700"
            >
              + Add another flight
              <span className="ml-2 text-xs text-slate-400">
                {value.legs.length}/{MAX_LEGS}
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div ref={paxRef} className="relative">
          <span className={FIELD_LABEL}>Travellers &amp; cabin</span>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={paxOpen}
            onClick={() => setPaxOpen((o) => !o)}
            className="mt-1 flex min-w-56 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition hover:border-amber-500 focus:outline-none focus:ring-4 focus:ring-amber-500/15"
          >
            <span>
              {passengerSummary(value)} · {cabinLabel}
            </span>
            <motion.span animate={{ rotate: paxOpen ? 180 : 0 }} className="text-slate-400">
              ▾
            </motion.span>
          </button>

          <AnimatePresence>
            {paxOpen && (
              <motion.div
                role="dialog"
                aria-label="Travellers and cabin"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="absolute left-0 z-30 mt-2 w-72 origin-top-left rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-2xl shadow-slate-900/15"
              >
                <Stepper label="Adults" hint="12+ years" value={value.adults} min={1} max={9} onChange={(n) => patch({ adults: n })} />
                <Stepper label="Children" hint="2–11 years" value={value.children} min={0} max={9} onChange={(n) => patch({ children: n })} />
                <Stepper label="Infants" hint="Under 2, on lap" value={value.infants} min={0} max={9} onChange={(n) => patch({ infants: n })} />
                <div className="mt-2 border-t border-slate-100 pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    {CABINS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => patch({ cabinClass: c.value })}
                        className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                          value.cabinClass === c.value
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPaxOpen(false)}
                  className="mt-3 w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-900 transition hover:bg-amber-400"
                >
                  Done
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.button
          type="submit"
          disabled={busy}
          whileHover={{ scale: busy ? 1 : 1.03 }}
          whileTap={{ scale: busy ? 1 : 0.97 }}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:bg-slate-800 disabled:opacity-60"
        >
          {busy && (
            <motion.span
              aria-hidden
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
              className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
            />
          )}
          {busy ? 'Searching…' : submitLabel}
        </motion.button>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-left text-sm text-red-700"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  );
}
