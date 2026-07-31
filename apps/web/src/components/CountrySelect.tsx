import { COUNTRIES } from '@/lib/countries';

interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function CountrySelect({
  value,
  onChange,
  disabled,
  placeholder = 'Select a country',
  className = '',
}: CountrySelectProps) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 focus:border-slate-500 focus:outline-none ${className}`}
    >
      <option value="">{placeholder}</option>
      {COUNTRIES.map((country) => (
        <option key={country} value={country}>
          {country}
        </option>
      ))}
    </select>
  );
}
