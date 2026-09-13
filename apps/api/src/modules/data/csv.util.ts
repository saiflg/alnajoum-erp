/** Same hand-rolled CSV shape as ManifestService.renderCsv — no external
 * CSV library dependency for a format this simple. */
function escapeCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvField).join(','))
    .join('\n');
}

/** The counterpart for import — a minimal, dependency-free CSV line
 * parser. Handles quoted fields (with embedded commas/newlines/escaped
 * quotes) since a real spreadsheet export can contain any of those, but
 * deliberately doesn't chase every RFC 4180 edge case (e.g. it assumes
 * \n line endings after normalizing \r\n) — the goal is "opens a CSV a
 * real spreadsheet app saved," not a general-purpose CSV engine.
 */
export function parseCsv(content: string): string[][] {
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  // Final field/row, if the file doesn't end with a trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Turns parsed CSV rows (first row = header) into objects keyed by a
 * case-insensitive, trimmed header name — so "Email", "email", " Email "
 * all land on the same key. */
export function csvRowsToRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = (row[i] ?? '').trim();
    });
    return record;
  });
}
