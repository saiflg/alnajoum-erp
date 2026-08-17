export interface Airport {
  code: string;
  city: string;
  country: string;
  name: string;
}

// Nigerian domestic airports (the agency's home market) plus the
// international routes most relevant to a Nigeria-based travel agency:
// Hajj/Umrah (Jeddah, Madinah, Riyadh), Gulf hub connections, and the
// most common Nigeria-diaspora destinations. Not exhaustive — MockFlightProviderService
// only ever returns routes between whatever origin/destination codes are
// searched, so this list only needs to cover what customers actually type,
// not be a full IATA database.
export const AIRPORTS: Airport[] = [
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
  { code: 'SKO', city: 'Sokoto', country: 'Nigeria', name: 'Sadiq Abubakar III International' },
  { code: 'MIU', city: 'Maiduguri', country: 'Nigeria', name: 'Maiduguri International' },
  { code: 'YOL', city: 'Yola', country: 'Nigeria', name: 'Yola Airport' },
  { code: 'JOS', city: 'Jos', country: 'Nigeria', name: 'Yakubu Gowon Airport' },
  { code: 'AKR', city: 'Akure', country: 'Nigeria', name: 'Akure Airport' },
  { code: 'GMO', city: 'Gombe', country: 'Nigeria', name: 'Gombe Lawanti International' },
  { code: 'QUO', city: 'Uyo', country: 'Nigeria', name: 'Akwa Ibom International' },
  { code: 'ABB', city: 'Asaba', country: 'Nigeria', name: 'Asaba International' },

  // --- Saudi Arabia (Hajj & Umrah) ---
  { code: 'JED', city: 'Jeddah', country: 'Saudi Arabia', name: 'King Abdulaziz International' },
  { code: 'MED', city: 'Madinah', country: 'Saudi Arabia', name: 'Prince Mohammad Bin Abdulaziz International' },
  { code: 'RUH', city: 'Riyadh', country: 'Saudi Arabia', name: 'King Khalid International' },
  { code: 'DMM', city: 'Dammam', country: 'Saudi Arabia', name: 'King Fahd International' },

  // --- Gulf hubs ---
  { code: 'DXB', city: 'Dubai', country: 'UAE', name: 'Dubai International' },
  { code: 'AUH', city: 'Abu Dhabi', country: 'UAE', name: 'Zayed International' },
  { code: 'SHJ', city: 'Sharjah', country: 'UAE', name: 'Sharjah International' },
  { code: 'DOH', city: 'Doha', country: 'Qatar', name: 'Hamad International' },

  // --- Other major connections ---
  { code: 'IST', city: 'Istanbul', country: 'Turkey', name: 'Istanbul Airport' },
  { code: 'CAI', city: 'Cairo', country: 'Egypt', name: 'Cairo International' },
  { code: 'LHR', city: 'London', country: 'United Kingdom', name: 'Heathrow' },
  { code: 'LGW', city: 'London', country: 'United Kingdom', name: 'Gatwick' },
  { code: 'MAN', city: 'Manchester', country: 'United Kingdom', name: 'Manchester Airport' },
  { code: 'CDG', city: 'Paris', country: 'France', name: 'Charles de Gaulle' },
  { code: 'FRA', city: 'Frankfurt', country: 'Germany', name: 'Frankfurt Airport' },
  { code: 'JFK', city: 'New York', country: 'United States', name: 'John F. Kennedy International' },
  { code: 'IAD', city: 'Washington', country: 'United States', name: 'Dulles International' },
  { code: 'ATL', city: 'Atlanta', country: 'United States', name: 'Hartsfield-Jackson' },
  { code: 'YYZ', city: 'Toronto', country: 'Canada', name: 'Toronto Pearson International' },
  { code: 'JNB', city: 'Johannesburg', country: 'South Africa', name: 'O.R. Tambo International' },
  { code: 'ACC', city: 'Accra', country: 'Ghana', name: 'Kotoka International' },
  { code: 'NBO', city: 'Nairobi', country: 'Kenya', name: 'Jomo Kenyatta International' },
  { code: 'ADD', city: 'Addis Ababa', country: 'Ethiopia', name: 'Bole International' },
  { code: 'CMN', city: 'Casablanca', country: 'Morocco', name: 'Mohammed V International' },

  // --- West/Central African neighbors ---
  { code: 'COO', city: 'Cotonou', country: 'Benin', name: 'Cadjehoun Airport' },
  { code: 'NIM', city: 'Niamey', country: 'Niger', name: 'Diori Hamani International' },
  { code: 'DLA', city: 'Douala', country: 'Cameroon', name: 'Douala International' },
  { code: 'NDJ', city: "N'Djamena", country: 'Chad', name: "N'Djamena International" },
  { code: 'DSS', city: 'Dakar', country: 'Senegal', name: 'Blaise Diagne International' },
  { code: 'ABJ', city: 'Abidjan', country: "Côte d'Ivoire", name: 'Félix-Houphouët-Boigny International' },
  { code: 'LFW', city: 'Lomé', country: 'Togo', name: 'Lomé–Tokoin International' },
  { code: 'BKO', city: 'Bamako', country: 'Mali', name: 'Modibo Keïta International' },

  // --- Middle East (beyond the Gulf hubs above) ---
  { code: 'AMM', city: 'Amman', country: 'Jordan', name: 'Queen Alia International' },
  { code: 'BEY', city: 'Beirut', country: 'Lebanon', name: 'Beirut–Rafic Hariri International' },
  { code: 'KRT', city: 'Khartoum', country: 'Sudan', name: 'Khartoum International' },

  // --- South & Southeast Asia ---
  { code: 'DEL', city: 'Delhi', country: 'India', name: 'Indira Gandhi International' },
  { code: 'BOM', city: 'Mumbai', country: 'India', name: 'Chhatrapati Shivaji Maharaj International' },
  { code: 'KHI', city: 'Karachi', country: 'Pakistan', name: 'Jinnah International' },
  { code: 'ISB', city: 'Islamabad', country: 'Pakistan', name: 'Islamabad International' },
  { code: 'DAC', city: 'Dhaka', country: 'Bangladesh', name: 'Hazrat Shahjalal International' },
  { code: 'KUL', city: 'Kuala Lumpur', country: 'Malaysia', name: 'Kuala Lumpur International' },
  { code: 'CGK', city: 'Jakarta', country: 'Indonesia', name: 'Soekarno–Hatta International' },

  // --- East Asia ---
  { code: 'PEK', city: 'Beijing', country: 'China', name: 'Beijing Capital International' },
  { code: 'CAN', city: 'Guangzhou', country: 'China', name: 'Baiyun International' },

  // --- More of Europe ---
  { code: 'AMS', city: 'Amsterdam', country: 'Netherlands', name: 'Schiphol' },
  { code: 'MAD', city: 'Madrid', country: 'Spain', name: 'Adolfo Suárez Madrid–Barajas' },
  { code: 'FCO', city: 'Rome', country: 'Italy', name: 'Leonardo da Vinci–Fiumicino' },
];

/**
 * Matches on IATA code, city, country, or airport name — code/city
 * prefix matches rank first (typing "M" surfaces Madinah/Maiduguri/
 * Manchester before anything else), country-name prefix matches rank
 * second (typing "Nigeria" or "Saudi" surfaces every airport in that
 * country, ahead of unrelated airports that merely mention the word
 * somewhere in their full name), then substring matches on the airport's
 * full name/country last. Capped at 10 results — a broad query like
 * "Nigeria" (18 domestic airports) will still truncate; narrow the query
 * (city or code) to see the rest.
 */
export function searchAirports(query: string, limit = 10): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return AIRPORTS.slice(0, limit);
  }

  const prefixMatches: Airport[] = [];
  const countryMatches: Airport[] = [];
  const substringMatches: Airport[] = [];

  for (const airport of AIRPORTS) {
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

export function findAirport(code: string): Airport | undefined {
  return AIRPORTS.find((a) => a.code === code.toUpperCase());
}
