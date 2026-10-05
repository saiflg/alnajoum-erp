import { CabinClass, FlightLegCriteria, TripType } from './types';

export const MIN_MULTI_CITY_LEGS = 2;
export const MAX_LEGS = 6;

export interface FlightSearchState {
  tripType: TripType;
  legs: FlightLegCriteria[];
  returnDate: string;
  adults: number;
  children: number;
  infants: number;
  cabinClass: CabinClass;
}

export function emptyLeg(): FlightLegCriteria {
  return { origin: '', destination: '', departureDate: '' };
}

export function defaultSearchState(): FlightSearchState {
  return {
    tripType: 'ONE_WAY',
    legs: [emptyLeg()],
    returnDate: '',
    adults: 1,
    children: 0,
    infants: 0,
    cabinClass: 'ECONOMY',
  };
}

const TRIP_TYPES: TripType[] = ['ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'];
const CABINS: CabinClass[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];

/**
 * Query-string form of a search, used to carry it from the homepage hero
 * (and through register/login) into the portal search page. Legs travel as
 * `LOS.ABV.2026-11-01~ABV.LHR.2026-11-10` so a multi-city trip survives the
 * round trip. The legacy `origin`/`destination`/`date` triple is still read
 * (see decodeSearchParams) so older links keep working.
 */
export const SEARCH_PARAM_KEYS = ['trip', 'legs', 'ret', 'ad', 'ch', 'in', 'cabin'] as const;

export function encodeSearchParams(state: FlightSearchState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('trip', state.tripType);
  params.set(
    'legs',
    state.legs
      .map((l) => [l.origin.toUpperCase(), l.destination.toUpperCase(), l.departureDate].join('.'))
      .join('~'),
  );
  if (state.tripType === 'ROUND_TRIP' && state.returnDate) params.set('ret', state.returnDate);
  params.set('ad', String(state.adults));
  if (state.children) params.set('ch', String(state.children));
  if (state.infants) params.set('in', String(state.infants));
  params.set('cabin', state.cabinClass);
  return params;
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function decodeSearchParams(params: URLSearchParams): FlightSearchState {
  const state = defaultSearchState();

  const trip = params.get('trip') as TripType | null;
  if (trip && TRIP_TYPES.includes(trip)) state.tripType = trip;

  const legsParam = params.get('legs');
  if (legsParam) {
    const legs = legsParam
      .split('~')
      .slice(0, MAX_LEGS)
      .map((chunk) => {
        const [origin = '', destination = '', departureDate = ''] = chunk.split('.');
        return { origin, destination, departureDate };
      });
    if (legs.length) state.legs = legs;
  } else {
    const origin = params.get('origin');
    const destination = params.get('destination');
    const date = params.get('date');
    if (origin || destination || date) {
      state.legs = [{ origin: origin ?? '', destination: destination ?? '', departureDate: date ?? '' }];
    }
  }

  if (state.tripType === 'MULTI_CITY' && state.legs.length < MIN_MULTI_CITY_LEGS) {
    state.legs = [...state.legs, emptyLeg()];
  }
  if (state.tripType !== 'MULTI_CITY') state.legs = [state.legs[0]];

  state.returnDate = params.get('ret') ?? '';
  state.adults = clampInt(params.get('ad'), 1, 9, 1);
  state.children = clampInt(params.get('ch'), 0, 9, 0);
  state.infants = clampInt(params.get('in'), 0, 9, 0);
  const cabin = params.get('cabin') as CabinClass | null;
  if (cabin && CABINS.includes(cabin)) state.cabinClass = cabin;
  return state;
}

/** The legs actually sent to the API — a round trip is outbound + its mirror. */
export function buildApiLegs(state: FlightSearchState): FlightLegCriteria[] {
  const legs =
    state.tripType === 'ROUND_TRIP'
      ? [
          state.legs[0],
          {
            origin: state.legs[0].destination,
            destination: state.legs[0].origin,
            departureDate: state.returnDate,
          },
        ]
      : state.legs;
  return legs.map((leg) => ({
    ...leg,
    origin: leg.origin.toUpperCase(),
    destination: leg.destination.toUpperCase(),
  }));
}

export function buildSearchBody(state: FlightSearchState) {
  return {
    tripType: state.tripType,
    legs: buildApiLegs(state),
    adults: state.adults,
    children: state.children || undefined,
    infants: state.infants || undefined,
    cabinClass: state.cabinClass,
  };
}

export function validateSearch(state: FlightSearchState): string | null {
  const legs = state.tripType === 'ROUND_TRIP' ? [state.legs[0]] : state.legs;
  for (const [i, leg] of legs.entries()) {
    const label = state.tripType === 'MULTI_CITY' ? `Flight ${i + 1}` : 'Flight';
    if (!leg.origin || !leg.destination || !leg.departureDate) {
      return `${label}: choose where from, where to and a date.`;
    }
    if (leg.origin.toUpperCase() === leg.destination.toUpperCase()) {
      return `${label}: origin and destination can't be the same.`;
    }
  }
  if (state.tripType === 'ROUND_TRIP') {
    if (!state.returnDate) return 'Choose a return date.';
    if (state.returnDate < state.legs[0].departureDate) {
      return 'The return date must be on or after the departure date.';
    }
  }
  if (state.tripType === 'MULTI_CITY') {
    for (let i = 1; i < state.legs.length; i++) {
      if (state.legs[i].departureDate < state.legs[i - 1].departureDate) {
        return `Flight ${i + 1} can't depart before flight ${i}.`;
      }
    }
  }
  if (state.infants > state.adults) return 'There can be at most one infant per adult.';
  return null;
}

export function passengerSummary(state: FlightSearchState): string {
  const total = state.adults + state.children + state.infants;
  return `${total} traveller${total === 1 ? '' : 's'}`;
}
