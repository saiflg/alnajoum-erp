import {
  buildUriNdef,
  CHIP_CAPABILITIES,
  isPlausibleReference,
  newNfcReference,
  nfcUrl,
  normaliseUid,
  parseUriNdef,
  planEncoding,
  referenceFromPayload,
  uidHint,
  wrapType2Tlv,
} from './nfc.ndef';

describe('NFC references', () => {
  it('are 128 random bits and distinct', () => {
    const a = newNfcReference();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newNfcReference()).not.toBe(a);
    expect(isPlausibleReference(a)).toBe(true);
  });
  it('are read from a verification URL or a bare value, and nothing else', () => {
    const ref = newNfcReference();
    const url = nfcUrl('https://erp.example.org/', ref);
    expect(url).toBe(`https://erp.example.org/verify/nfc/${ref}`);
    expect(referenceFromPayload(url)).toBe(ref);
    expect(referenceFromPayload(`${url}?x=1`)).toBe(ref);
    expect(referenceFromPayload(ref)).toBe(ref);
    for (const bad of [
      '',
      'short',
      `${url}extra!`,
      'https://x/verify/card/' + ref,
      ref + 'x',
      '../../etc/passwd',
    ])
      expect(referenceFromPayload(bad)).toBeNull();
  });
});

describe('NDEF URI record', () => {
  it('matches the NFC Forum short-record layout byte for byte', () => {
    const ndef = buildUriNdef('https://a.b/c');
    // D1 = MB|ME|SR|TNF=1, 01 = type length, 0x0A = payload length (1 prefix byte + "a.b/c" = 6 -> check below)
    expect(ndef[0]).toBe(0xd1);
    expect(ndef[1]).toBe(0x01);
    expect(ndef[2]).toBe(ndef.length - 4);
    expect(ndef[3]).toBe(0x55); // "U"
    expect(ndef[4]).toBe(0x04); // https://
    expect(ndef.subarray(5).toString('utf8')).toBe('a.b/c');
  });
  it('round-trips through the parser', () => {
    const url = nfcUrl('https://erp.example.org', newNfcReference());
    expect(parseUriNdef(buildUriNdef(url))).toBe(url);
  });
  it('allows plain http only for an address on this computer (development)', () => {
    const ndef = buildUriNdef('http://localhost:3000/verify/nfc/x');
    expect(ndef[4]).toBe(0x03);
    expect(parseUriNdef(ndef)).toBe('http://localhost:3000/verify/nfc/x');
    expect(() => buildUriNdef('http://localhost.evil.example/x')).toThrow();
  });
  it('refuses to write anything but https, or a record that is too long', () => {
    expect(() => buildUriNdef('http://plain.example/x')).toThrow();
    expect(() => buildUriNdef('javascript:alert(1)')).toThrow();
    expect(() =>
      buildUriNdef('https://x.example/' + 'a'.repeat(300)),
    ).toThrow();
  });
  it('does not parse other record types or truncated data', () => {
    expect(
      parseUriNdef(Buffer.from([0xd1, 0x01, 0x05, 0x54, 0x02, 0x65, 0x6e])),
    ).toBeNull(); // text record
    expect(
      parseUriNdef(Buffer.from([0xd1, 0x01, 0x20, 0x55, 0x04, 0x61])),
    ).toBeNull(); // length lies
    expect(parseUriNdef(Buffer.alloc(0))).toBeNull();
  });
  it('is wrapped in the Type 2 TLV (03 len ... FE)', () => {
    const ndef = buildUriNdef('https://a.b/c');
    const tlv = wrapType2Tlv(ndef);
    expect(tlv[0]).toBe(0x03);
    expect(tlv[1]).toBe(ndef.length);
    expect(tlv[tlv.length - 1]).toBe(0xfe);
    expect(tlv.length).toBe(ndef.length + 3);
  });
});

describe('encoding plan and chip capabilities', () => {
  const url = nfcUrl('https://alnajoumtravelagency.com', newNfcReference());
  it('fits an NTAG213 (the smallest card)', () => {
    const p = planEncoding(url, 'NTAG213');
    expect(p.fits).toBe(true);
    expect(p.bytes).toBeLessThanOrEqual(144);
  });
  it('says "unknown" rather than guessing for a chip whose memory it does not know', () => {
    expect(planEncoding(url, 'MIFARE_DESFIRE_EV3').fits).toBeNull();
    expect(planEncoding(url, 'OTHER').fits).toBeNull();
  });
  it('never claims cryptographic authentication: every chip is used as an opaque reference', () => {
    for (const c of Object.values(CHIP_CAPABILITIES))
      expect(c.implemented).toBe('OPAQUE_REFERENCE');
  });
  it('warns plainly about plain tags and about MIFARE Classic', () => {
    expect(CHIP_CAPABILITIES.NTAG213.warning).toMatch(/copied/i);
    expect(CHIP_CAPABILITIES.MIFARE_CLASSIC_1K.warning).toMatch(
      /not recommended/i,
    );
    expect(CHIP_CAPABILITIES.NTAG213.cryptoCapable).toBe(false);
    expect(CHIP_CAPABILITIES.MIFARE_DESFIRE_EV2.warning).toMatch(
      /Not implemented/,
    );
  });
});

describe('chip serial numbers', () => {
  it('accept 4, 7 and 10 byte serials in common notations', () => {
    expect(normaliseUid('04:A2:2B:1C:5D:6E:80')).toBe('04A22B1C5D6E80');
    expect(normaliseUid('04 a2 2b 1c')).toBe('04A22B1C');
    expect(normaliseUid('04A22B1C5D6E80AABBCC')).toBe('04A22B1C5D6E80AABBCC');
  });
  it('reject anything else', () => {
    for (const bad of [
      '',
      'xyz',
      '04A2',
      '04A22B1C5D6E8',
      '04A22B1C5D6E80AABBCCDD',
    ])
      expect(normaliseUid(bad)).toBeNull();
  });
  it('show only the last byte', () =>
    expect(uidHint('04:A2:2B:1C')).toBe('…1C'));
});
