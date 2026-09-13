import { csvRowsToRecords, parseCsv, toCsv } from './csv.util';

describe('toCsv', () => {
  it('quotes a field containing a comma, quote, or newline', () => {
    const csv = toCsv(['Name', 'Note'], [['Musa, Bello', 'Said "hi"\nagain']]);
    expect(csv).toBe('Name,Note\n"Musa, Bello","Said ""hi""\nagain"');
  });

  it('leaves a plain field unquoted', () => {
    const csv = toCsv(['Name'], [['Amina']]);
    expect(csv).toBe('Name\nAmina');
  });
});

describe('parseCsv', () => {
  it('parses a simple comma-separated file', () => {
    const rows = parseCsv('a,b,c\n1,2,3');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles a quoted field with an embedded comma', () => {
    const rows = parseCsv('Name,City\n"Bello, Musa",Kaduna');
    expect(rows).toEqual([
      ['Name', 'City'],
      ['Bello, Musa', 'Kaduna'],
    ]);
  });

  it('handles an escaped double-quote inside a quoted field', () => {
    const rows = parseCsv('Note\n"She said ""hi"""');
    expect(rows).toEqual([['Note'], ['She said "hi"']]);
  });

  it('handles a quoted field with an embedded newline', () => {
    const rows = parseCsv('Note\n"line one\nline two"\nafter');
    expect(rows).toEqual([['Note'], ['line one\nline two'], ['after']]);
  });

  it('normalizes CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops blank lines', () => {
    const rows = parseCsv('a,b\n\n1,2\n\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('csvRowsToRecords', () => {
  it('keys each row by a lowercased, trimmed header', () => {
    const records = csvRowsToRecords([
      [' Email ', 'First Name', 'Last Name'],
      ['amina@example.com', 'Amina', 'Yusuf'],
    ]);
    expect(records).toEqual([
      {
        email: 'amina@example.com',
        'first name': 'Amina',
        'last name': 'Yusuf',
      },
    ]);
  });

  it('returns an empty array for a header-only (or empty) file', () => {
    expect(csvRowsToRecords([['Email']])).toEqual([]);
    expect(csvRowsToRecords([])).toEqual([]);
  });

  it('fills a missing trailing column with an empty string', () => {
    const records = csvRowsToRecords([
      ['Email', 'Phone'],
      ['amina@example.com'],
    ]);
    expect(records).toEqual([{ email: 'amina@example.com', phone: '' }]);
  });
});
