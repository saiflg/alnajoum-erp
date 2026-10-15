import { BadRequestException } from '@nestjs/common';
import {
  allowedVariables,
  assertVariablesAllowed,
  buildEmail,
  extractVariables,
  htmlToText,
  renderText,
  sanitizeHtml,
} from './comm-render';

describe('template variables', () => {
  it('lists variables in order of first appearance, case-insensitively', () => {
    expect(
      extractVariables(
        'Hi {{first_name}}, {{ Offer }} for {{first_name}}',
        '{{link}}',
      ),
    ).toEqual(['first_name', 'offer', 'link']);
  });
  it('a marketing template cannot use booking or payment values', () => {
    expect(() =>
      assertVariablesAllowed(['first_name', 'offer'], 'MARKETING', 'EMAIL'),
    ).not.toThrow();
    expect(() =>
      assertVariablesAllowed(['booking_ref'], 'MARKETING', 'WHATSAPP'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertVariablesAllowed(['amount'], 'MARKETING', 'EMAIL'),
    ).toThrow(BadRequestException);
  });
  it('a service template may use them', () => {
    expect(() =>
      assertVariablesAllowed(
        ['booking_ref', 'amount', 'due_date'],
        'UTILITY',
        'WHATSAPP',
      ),
    ).not.toThrow();
    expect(allowedVariables('TRANSACTIONAL', 'EMAIL')).toContain(
      'unsubscribe_link',
    );
    expect(allowedVariables('UTILITY', 'WHATSAPP')).not.toContain(
      'unsubscribe_link',
    );
  });
  it('unknown values are refused', () => {
    expect(() =>
      assertVariablesAllowed(['passport_number'], 'UTILITY', 'EMAIL'),
    ).toThrow(BadRequestException);
  });
});

describe('rendering', () => {
  it('fills values and reports any that are missing instead of guessing', () => {
    const r = renderText('Hello {{first_name}}, {{offer}} to {{destination}}', {
      first_name: 'Amina',
      offer: '10% off',
    });
    expect(r.text).toBe('Hello Amina, 10% off to ');
    expect(r.missing).toEqual(['destination']);
  });
  it('escapes values placed into HTML', () => {
    expect(
      renderText(
        '<p>{{first_name}}</p>',
        { first_name: '<script>x</script>' },
        { html: true },
      ).text,
    ).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });
});

describe('HTML sanitiser', () => {
  it('removes scripts, frames, forms and event handlers', () => {
    const dirty =
      '<p onclick="steal()">Hi</p><script>alert(1)</script><iframe src="https://evil"></iframe><form action="x"><input name="p"></form><img src="https://ok.example/a.png" onerror="x()">';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(
      /script|iframe|form|input|onclick|onerror|alert/i,
    );
    expect(clean).toContain('<p>Hi</p>');
    expect(clean).toContain('<img src="https://ok.example/a.png" />');
  });
  it('keeps only web, mail and phone links', () => {
    const out = sanitizeHtml(
      '<a href="javascript:alert(1)">x</a><a href="  JaVaScRiPt:alert(1)">y</a><a href="data:text/html,x">z</a><a href="https://a.example/p?x=1&y=2">ok</a><a href="mailto:a@b.c">m</a>',
    );
    expect(out).not.toMatch(/javascript|data:/i);
    expect(out).toContain('href="https://a.example/p?x=1&y=2"');
    expect(out).toContain('href="mailto:a@b.c"');
  });
  it('drops style and class attributes and unknown tags but keeps their text', () => {
    expect(
      sanitizeHtml(
        '<custom-x><span style="position:fixed" class="a">Hello</span></custom-x><marquee>m</marquee>',
      ),
    ).toBe('<span>Hello</span>m');
  });
  it('only allows https images', () => {
    expect(
      sanitizeHtml(
        '<img src="http://plain.example/a.png"><img src="data:image/png;base64,AAA">',
      ),
    ).toBe('<img /><img />');
  });
  it('allows a link marker to be filled in later', () => {
    expect(sanitizeHtml('<a href="{{link}}">Open</a>')).toBe(
      '<a href="{{link}}">Open</a>',
    );
  });
  it('turns HTML into readable plain text with link targets', () => {
    expect(
      htmlToText(
        '<p>Hello <b>Amina</b></p><p><a href="https://a.example">Book</a></p>',
      ),
    ).toBe('Hello Amina\nBook (https://a.example)');
  });
});

describe('email assembly', () => {
  const base = {
    subject: 'Umrah for {{first_name}}',
    bodyHtml: '<p>Hello {{first_name}}</p><p>{{offer}}</p>',
    bodyText: 'Hello {{first_name}}',
    values: { first_name: 'Amina', offer: 'Departing 12 Jan' },
    unsubscribeUrl: 'https://x.test/unsubscribe/tok?channel=EMAIL',
    preferencesUrl: 'https://x.test/preferences/tok',
    senderName: 'Alnajoum Travel Agency',
  };
  it('always adds the sender, unsubscribe and preferences links to marketing mail', () => {
    const e = buildEmail({ ...base, marketing: true });
    expect(e.html).toContain(
      'href="https://x.test/unsubscribe/tok?channel=EMAIL"',
    );
    expect(e.html).toContain('Manage preferences');
    expect(e.text).toContain(
      'Unsubscribe: https://x.test/unsubscribe/tok?channel=EMAIL',
    );
    expect(e.subject).toBe('Umrah for Amina');
    expect(e.missing).toEqual([]);
  });
  it('cannot be built without the footer by editing the template', () => {
    const e = buildEmail({
      ...base,
      bodyHtml: '<p>no footer here</p>',
      marketing: true,
    });
    expect(e.html).toMatch(/Unsubscribe/);
  });
  it('service mail carries no unsubscribe offer for promotions but says what it is', () => {
    const e = buildEmail({ ...base, marketing: false });
    expect(e.html).toContain('service message');
    expect(e.html).not.toContain('Manage preferences');
  });
  it('reports a missing value', () => {
    expect(
      buildEmail({ ...base, values: { first_name: 'Amina' }, marketing: true })
        .missing,
    ).toEqual(['offer']);
  });
  it('plain-text templates are escaped into HTML', () => {
    const e = buildEmail({
      ...base,
      bodyHtml: null,
      bodyText: 'a < b {{first_name}}',
      marketing: true,
    });
    expect(e.html).toContain('a &lt; b Amina');
  });
  it('a subject cannot carry a header break', () => {
    expect(
      buildEmail({ ...base, subject: 'Hi\r\nBcc: x@y.z', marketing: true })
        .subject,
    ).toBe('Hi Bcc: x@y.z');
  });
});
