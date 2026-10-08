import { contentDisposition, detectMime } from './file-signature';

describe('detectMime', () => {
  it('recognises JPEG, PNG and PDF by their signatures', () => {
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('image/jpeg');
    expect(
      detectMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])),
    ).toBe('image/png');
    expect(detectMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it.each([
    ['an HTML page', '<!doctype html><script>alert(1)</script>'],
    ['an SVG', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    ['a shell script', '#!/bin/sh\nrm -rf /'],
    ['a Windows executable', 'MZ\u0090\u0000\u0003'],
    ['a ZIP', 'PK\u0003\u0004'],
    ['an empty file', ''],
    ['a truncated PNG header', '\u0089PNG'],
  ])('rejects %s', (_name, content) => {
    expect(detectMime(Buffer.from(content, 'latin1'))).toBeNull();
  });
});

describe('contentDisposition', () => {
  it('keeps a plain name readable', () => {
    expect(contentDisposition('inline', 'passport.pdf')).toBe(
      `inline; filename="passport.pdf"; filename*=UTF-8''passport.pdf`,
    );
  });

  it('survives an Arabic name without a non-ASCII byte in the header (which used to crash the response)', () => {
    const header = contentDisposition('inline', 'جواز السفر.pdf');
    expect(header).toMatch(/^[\x20-\x7e]*$/);
    expect(header).toContain(`filename*=UTF-8''%D8%AC`);
  });

  it('cannot be used to inject header content', () => {
    const header = contentDisposition('attachment', 'a"; filename="evil.exe\r\nX-Injected: 1');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/filename="[^"]*"/g)).toHaveLength(1);
    expect(header).not.toContain('X-Injected: 1;');
  });

  it('falls back to a name when given nothing usable', () => {
    expect(contentDisposition('inline', '\u0001\u0002')).toContain('filename="file"');
  });
});
