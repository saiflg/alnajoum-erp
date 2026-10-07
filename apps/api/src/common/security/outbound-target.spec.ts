import { BadRequestException } from '@nestjs/common';
import {
  assertSafeHost,
  assertSafeHttpUrl,
  isPrivateAddress,
} from './outbound-target';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:10.0.0.1',
    '[::1]',
  ])('%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '172.15.255.255',
    '1.1.1.1',
    '2606:4700:4700::1111',
    'example.com',
  ])('%s is not private', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('assertSafeHttpUrl', () => {
  it('accepts a public https URL in production', () => {
    expect(() =>
      assertSafeHttpUrl('https://api.openai.com/v1', 'baseUrl', 'production'),
    ).not.toThrow();
  });

  it.each([
    'https://169.254.169.254/latest/meta-data',
    'https://localhost:5432',
    'https://10.0.0.5/v1',
    'https://db.internal/v1',
    'https://[::1]/v1',
    'http://api.openai.com/v1',
    'https://user:pass@api.openai.com/v1',
    'not a url',
    'file:///etc/passwd',
  ])('rejects %s in production', (url) => {
    expect(() => assertSafeHttpUrl(url, 'baseUrl', 'production')).toThrow(
      BadRequestException,
    );
  });

  it('allows a local model server over http in development, but never the metadata address', () => {
    expect(() =>
      assertSafeHttpUrl('http://localhost:11434/v1', 'baseUrl', 'development'),
    ).not.toThrow();
    expect(() =>
      assertSafeHttpUrl('http://169.254.169.254/', 'baseUrl', 'development'),
    ).toThrow(BadRequestException);
  });
});

describe('assertSafeHost', () => {
  it('rejects private SMTP hosts in production and odd characters anywhere', () => {
    expect(() =>
      assertSafeHost('smtp.gmail.com', 'host', 'production'),
    ).not.toThrow();
    expect(() => assertSafeHost('10.0.0.1', 'host', 'production')).toThrow(
      BadRequestException,
    );
    expect(() => assertSafeHost('localhost', 'host', 'production')).toThrow(
      BadRequestException,
    );
    expect(() => assertSafeHost('a.com/evil', 'host', 'development')).toThrow(
      BadRequestException,
    );
    expect(() =>
      assertSafeHost('localhost', 'host', 'development'),
    ).not.toThrow();
  });
});
