import {
  directionFor,
  extractVariables,
  pickLanguage,
  renderTemplate,
  TemplateError,
  validateTemplate,
} from './template';

const ctx = {
  customer: { name: 'Amina Yusuf' },
  booking: {
    reference: 'ANJ-001',
    totalAmount: 750000,
    paid: true,
    departure: new Date('2026-11-10T08:00:00Z'),
  },
};

describe('renderTemplate', () => {
  it('substitutes variables', () => {
    expect(
      renderTemplate(
        'Hello {{customer.name}}, booking {{ booking.reference }} is confirmed.',
        ctx,
      ),
    ).toBe('Hello Amina Yusuf, booking ANJ-001 is confirmed.');
  });
  it('prints numbers, booleans and dates plainly', () => {
    expect(
      renderTemplate(
        '{{booking.totalAmount}}/{{booking.paid}}/{{booking.departure}}',
        ctx,
      ),
    ).toBe('750000/true/2026-11-10T08:00:00.000Z');
  });
  it('an unknown variable is an error naming it — never a blank in a customer message', () => {
    expect.assertions(2);
    try {
      renderTemplate('Hi {{customer.name}} {{flight.number}}', ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateError);
      expect((e as TemplateError).missing).toEqual(['flight.number']);
    }
  });
  it('blank mode is available for previews only', () => {
    expect(
      renderTemplate('Gate {{flight.gate}}.', ctx, { onMissing: 'blank' }),
    ).toBe('Gate .');
  });
  it('refuses to print an object or list', () => {
    expect(() => renderTemplate('{{customer}}', ctx)).toThrow(
      /cannot be printed/,
    );
  });
  it('escapes substituted values in HTML, leaving the author markup alone', () => {
    const out = renderTemplate(
      '<p>Hello {{name}}</p>',
      { name: '<script>alert(1)</script>' },
      { format: 'html' },
    );
    expect(out).toBe('<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
  it('does not re-evaluate substituted text (a value containing {{ }} stays literal)', () => {
    expect(
      renderTemplate('{{a}}', { a: '{{secret.key}}', secret: { key: 'LEAK' } }),
    ).toBe('{{secret.key}}');
  });
  it('caps the output length', () => {
    expect(() => renderTemplate('{{x}}', { x: 'a'.repeat(20000) })).toThrow(
      /longer than/,
    );
  });
});

describe('template injection attempts are rejected, not escaped', () => {
  const attacks = [
    '{{constructor.constructor("return process")()}}',
    '{{__proto__.polluted}}',
    '{{customer.name | upper}}',
    '{{#each items}}x{{/each}}',
    '{{ 7*7 }}',
    "{{customer['name']}}",
    '{{customer.name}',
    '{{ {{customer.name}} }}',
    '{{}}',
    '${customer.name}{{',
  ];
  it.each(attacks)('%s', (t) => {
    expect(
      validateTemplate(t).length + (safeRender(t) ? 0 : 1),
    ).toBeGreaterThan(0);
  });
  it('even a rendered attack leaks nothing', () => {
    expect(() =>
      renderTemplate('{{constructor.name}}', { constructor: 'x' }),
    ).toThrow(TemplateError);
    expect(() => renderTemplate('{{customer.constructor.name}}', ctx)).toThrow(
      TemplateError,
    );
  });
});
function safeRender(t: string): boolean {
  try {
    renderTemplate(t, ctx);
    return true;
  } catch {
    return false;
  }
}

describe('validateTemplate / extractVariables', () => {
  it('lists variables once, in order', () => {
    expect(extractVariables('{{a.b}} {{c}} {{a.b}}')).toEqual(['a.b', 'c']);
  });
  it('checks variables against what the trigger provides', () => {
    const allowed = new Set(['customer.name']);
    expect(validateTemplate('Hi {{customer.name}}', allowed)).toEqual([]);
    expect(
      validateTemplate('Hi {{customer.passport}}', allowed)[0].message,
    ).toContain('not available');
  });
  it('rejects empty and over-long templates', () => {
    expect(validateTemplate('   ')[0].message).toContain('empty');
    expect(validateTemplate('x'.repeat(6000))[0].message).toContain(
      'longer than',
    );
  });
});

describe('languages', () => {
  it('picks the preferred language when a template exists, else English', () => {
    expect(pickLanguage('ha', ['en', 'ha', 'ar'])).toBe('ha');
    expect(pickLanguage('ar', ['en', 'ha'])).toBe('en');
    expect(pickLanguage('fr', ['en', 'ar'])).toBe('en');
    expect(pickLanguage(undefined, ['en'])).toBe('en');
    expect(pickLanguage('ar', ['ar'])).toBe('ar');
  });
  it('Arabic is right-to-left', () => {
    expect(directionFor('ar')).toBe('rtl');
    expect(directionFor('en')).toBe('ltr');
    expect(directionFor('ha')).toBe('ltr');
  });
  it('renders Arabic and Hausa text unchanged', () => {
    expect(renderTemplate('مرحباً {{customer.name}}', ctx)).toBe(
      'مرحباً Amina Yusuf',
    );
    expect(
      renderTemplate('Sannu {{customer.name}}, ajiyar ku ta tabbata.', ctx),
    ).toBe('Sannu Amina Yusuf, ajiyar ku ta tabbata.');
  });
});
