export interface Airport {
  code: string;
  city: string;
  country: string;
  name: string;
}

// Shown by default (empty query) and used as a fallback while the full
// world dataset below is still loading — the routes most relevant to a
// Nigeria-based Hajj/Umrah agency, so the very first thing a customer sees
// is useful rather than an arbitrary alphabetical slice of 6,000 airports.
export const POPULAR_AIRPORTS: Airport[] = [
  // --- Nigeria ---
  { code: 'LOS', city: 'Lagos', country: 'Nigeria', name: 'Murtala Muhammed International' },
  { code: 'ABV', city: 'Abuja', country: 'Nigeria', name: 'Nnamdi Azikiwe International' },
  { code: 'KAN', city: 'Kano', country: 'Nigeria', name: 'Mallam Aminu Kano International' },
  { code: 'PHC', city: 'Port Harcourt', country: 'Nigeria', name: 'Port Harcourt International' },
  { code: 'ENU', city: 'Enugu', country: 'Nigeria', name: 'Akanu Ibiam International' },
  { code: 'KAD', city: 'Kaduna', country: 'Nigeria', name: 'Kaduna Airport' },
  { code: 'ILR', city: 'Ilorin', country: 'Nigeria', name: 'Ilorin International' },
  { code: 'BNI', city: 'Benin City', country: 'Nigeria', name: 'Benin Airport' },
  { code: 'CBQ', city: 'Calabar', country: 'Nigeria', name: 'Margaret Ekpo International' },
  { code: 'QOW', city: 'Owerri', country: 'Nigeria', name: 'Sam Mbakwe International' },

  // --- Saudi Arabia (Hajj & Umrah) ---
  { code: 'JED', city: 'Jeddah', country: 'Saudi Arabia', name: 'King Abdulaziz International' },
  { code: 'MED', city: 'Madinah', country: 'Saudi Arabia', name: 'Prince Mohammad Bin Abdulaziz International' },
  { code: 'RUH', city: 'Riyadh', country: 'Saudi Arabia', name: 'King Khalid International' },

  // --- Gulf hubs ---
  { code: 'DXB', city: 'Dubai', country: 'UAE', name: 'Dubai International' },
  { code: 'DOH', city: 'Doha', country: 'Qatar', name: 'Hamad International' },

  // --- Other frequently-searched connections ---
  { code: 'IST', city: 'Istanbul', country: 'Turkey', name: 'Istanbul Airport' },
  { code: 'CAI', city: 'Cairo', country: 'Egypt', name: 'Cairo International' },
  { code: 'LHR', city: 'London', country: 'United Kingdom', name: 'Heathrow' },
  { code: 'JFK', city: 'New York', country: 'United States', name: 'John F. Kennedy International' },
  { code: 'JNB', city: 'Johannesburg', country: 'South Africa', name: 'O.R. Tambo International' },
  { code: 'ACC', city: 'Accra', country: 'Ghana', name: 'Kotoka International' },
];

/**
 * The full ~6,000-airport IATA dataset (every airport with a real 3-letter
 * IATA code), built once from OpenFlights' open airport database — see
 * scripts/build-airports.md (referenced from the README) for how
 * apps/web/public/data/airports.json was generated. Fetched lazily on
 * first use, not bundled into the JS — a ~500KB dataset has no business
 * being in the initial page bundle for a page that might never open the
 * dropdown, and browsers cache a static /public JSON file for free.
 *
 * Cached at module scope: the first AirportInput on a page triggers the
 * fetch; every other instance (origin/destination, or up to 6 legs on the
 * multi-city form) shares the same in-flight promise, then the same
 * resolved array, so it's fetched once per page load, not once per field.
 */
let worldAirports: Airport[] | null = null;
let worldAirportsPromise: Promise<Airport[]> | null = null;

export function loadWorldAirports(): Promise<Airport[]> {
  if (worldAirports) {
    return Promise.resolve(worldAirports);
  }
  if (!worldAirportsPromise) {
    worldAirportsPromise = fetch('/data/airports.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load airport data (${res.status})`);
        return res.json() as Promise<Airport[]>;
      })
      .then((data) => {
        worldAirports = data;
        return data;
      })
      .catch((err: unknown) => {
        // Allow a later call to retry rather than caching a permanent failure.
        worldAirportsPromise = null;
        throw err;
      });
  }
  return worldAirportsPromise;
}

function rank(airports: Airport[], query: string, limit: number): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return airports.slice(0, limit);
  }

  const prefixMatches: Airport[] = [];
  const countryMatches: Airport[] = [];
  const substringMatches: Airport[] = [];

  for (const airport of airports) {
    const code = airport.code.toLowerCase();
    const city = airport.city.toLowerCase();
    const country = airport.country.toLowerCase();
    if (code.startsWith(q) || city.startsWith(q)) {
      prefixMatches.push(airport);
    } else if (country.startsWith(q)) {
      countryMatches.push(airport);
    } else if (`${airport.name} ${airport.country}`.toLowerCase().includes(q)) {
      substringMatches.push(airport);
    }
  }

  return [...prefixMatches, ...countryMatches, ...substringMatches].slice(0, limit);
}

/**
 * Matches on IATA code, city, country, or airport name — code/city
 * prefix matches rank first (typing "M" surfaces Madinah/Maiduguri/
 * Manchester before anything else), country-name prefix matches rank
 * second (typing "Nigeria" or "Saudi" surfaces every airport in that
 * country), then substring matches on the full name/country last. Capped
 * at 10 results — a broad query like "Nigeria" will still truncate;
 * narrow the query (city or code) to see the rest.
 *
 * Synchronous, searching the full world dataset once it's loaded
 * (`loadWorldAirports()` — call once on mount) and the curated popular
 * list before that, so the dropdown is never empty while the ~500KB
 * dataset is still in flight.
 */
export function searchAirports(query: string, limit = 10): Airport[] {
  return rank(worldAirports ?? POPULAR_AIRPORTS, query, limit);
}

export function findAirport(code: string): Airport | undefined {
  const upper = code.toUpperCase();
  return (worldAirports ?? POPULAR_AIRPORTS).find((a) => a.code === upper);
}
