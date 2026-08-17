'use client';

import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Airport, searchAirports } from '@/lib/airports';

interface AirportInputProps {
  id?: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  required?: boolean;
  /** Matches the visual style of the input it's replacing at each call
   * site (the homepage teaser and the portal search form use slightly
   * different sizing/borders) — defaults to the teaser's style. */
  inputClassName?: string;
  labelClassName?: string;
}

const DEFAULT_INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20';
const DEFAULT_LABEL_CLASS =
  'block text-left text-xs font-semibold uppercase tracking-wide text-slate-500';

/**
 * Typeahead airport picker: typing "M" surfaces every airport whose code
 * or city starts with M (Madinah, Maiduguri, Manchester, ...) in a
 * dropdown, while still accepting a raw 3-letter code typed directly (the
 * underlying value is just text — the dropdown is an assist, not a hard
 * constraint, so a route not in lib/airports.ts can still be searched).
 */
export function AirportInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
  inputClassName = DEFAULT_INPUT_CLASS,
  labelClassName = DEFAULT_LABEL_CLASS,
}: AirportInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  const [query, setQuery] = useState(value);
  const [lastSyncedValue, setLastSyncedValue] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the displayed text in sync when the value changes from outside
  // (e.g. a leg reset when switching trip type, or a URL-prefilled search)
  // — adjusted during render rather than in an effect, since that's the
  // documented, extra-render-free way to reset local state when a prop
  // changes (react.dev/learn/you-might-not-need-an-effect).
  if (value !== lastSyncedValue) {
    setLastSyncedValue(value);
    setQuery(value);
  }

  const results = useMemo(() => searchAirports(query), [query]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function selectAirport(airport: Airport) {
    onChange(airport.code);
    setQuery(airport.code);
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectAirport(results[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label htmlFor={inputId} className={labelClassName}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        required={required}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          const next = e.target.value.toUpperCase();
          setQuery(next);
          onChange(next);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        className={inputClassName}
      />
      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg sm:w-72"
        >
          {results.map((airport, i) => (
            <li key={airport.code} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectAirport(airport)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                  i === highlighted ? 'bg-amber-50' : 'hover:bg-slate-50'
                }`}
              >
                <span className="min-w-0">
                  <span className="font-medium text-slate-900">{airport.city}</span>
                  <span className="ml-1.5 text-slate-500">{airport.country}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-slate-400">{airport.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
