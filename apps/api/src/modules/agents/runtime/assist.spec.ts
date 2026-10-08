import { classifyDocument, extractPassport, triageMessage } from './assist';
import { classifySupport } from './support-classifier';

describe('document assistant (proposals only)', () => {
  it('classifies from the file name first, then the text, and never claims certainty from nothing', () => {
    expect(classifyDocument('Passport_Ayo.pdf')).toMatchObject({
      proposedType: 'PASSPORT',
      confidence: 'HIGH',
    });
    expect(
      classifyDocument('scan0001.pdf', 'Yellow Card vaccination'),
    ).toMatchObject({
      proposedType: 'VACCINATION_CERTIFICATE',
      confidence: 'MEDIUM',
    });
    expect(classifyDocument('IMG_001.jpg')).toMatchObject({
      proposedType: 'PHOTO',
      confidence: 'LOW',
    });
    expect(classifyDocument('document.bin')).toMatchObject({
      proposedType: 'OTHER',
      confidence: 'LOW',
      requiresReview: true,
    });
  });

  // ICAO 9303 specimen passport, read as if it were scanned in 2010.
  const MRZ =
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
  const NOW = new Date('2010-01-01');
  it('reads a machine-readable zone and checks its check digits', () => {
    const r = extractPassport(MRZ, {}, NOW);
    expect(r.passportNumber).toBe('L898902C3');
    expect(r.expiryDate).toBe('2012-04-15');
    expect(r.dateOfBirth).toBe('1974-08-12');
    expect(r.surname).toBe('ERIKSSON');
    expect(r.issues).toEqual([]);
    expect(r.requiresReview).toBe(true);
  });
  it('flags a misread: a wrong check digit is reported, not trusted', () => {
    const bad = MRZ.replace('L898902C36', 'L898902C37');
    expect(extractPassport(bad, {}, NOW).issues.join(' ')).toMatch(
      /check digit/,
    );
  });
  it('reports an expired or soon-to-expire passport and missing fields', () => {
    expect(
      extractPassport(MRZ, {}, new Date('2013-01-01')).issues.join(' '),
    ).toMatch(/already expired/);
    expect(
      extractPassport(MRZ, {}, new Date('2011-12-01')).issues.join(' '),
    ).toMatch(/within six months/);
    expect(extractPassport('nothing useful here', {}, NOW).issues).toEqual(
      expect.arrayContaining([
        'No passport number could be read',
        'No expiry date could be read',
      ]),
    );
  });
  it('NEVER overwrites: a difference from the stored record is returned as a conflict for a person', () => {
    const r = extractPassport(
      MRZ,
      { passportNumber: 'A1234567', passportExpiryDate: '2030-01-01' },
      NOW,
    );
    expect(r.conflicts.map((c) => c.field)).toEqual([
      'passportNumber',
      'passportExpiryDate',
    ]);
    expect(r.conflicts[0]).toMatchObject({
      existing: 'A1234567',
      proposed: 'L898902C3',
    });
  });
  it('reads a plain labelled passport page too', () => {
    const r = extractPassport(
      'Passport No: A12345678\nDate of expiry: 2031-05-20',
      {},
      NOW,
    );
    expect(r).toMatchObject({
      passportNumber: 'A12345678',
      expiryDate: '2031-05-20',
    });
  });
});

describe('support triage and complaint escalation', () => {
  it('routes by topic', () => {
    expect(classifySupport('My visa application has no update').category).toBe(
      'VISA',
    );
    expect(classifySupport('I paid but the receipt is missing').category).toBe(
      'PAYMENT',
    );
    expect(classifySupport('The app crashes when I log in').category).toBe(
      'TECHNICAL',
    );
    expect(classifySupport('Please refund my ticket').category).toBe('REFUND');
  });
  it('a serious complaint is escalated for money, legal exposure, imminent travel and repetition - never dismissed', () => {
    const c = classifySupport(
      'This is a scam, I paid twice and still waiting, I will go to my lawyer. My flight is tomorrow.',
    );
    expect(c.complaint).toBe(true);
    expect(c.escalation.escalate).toBe(true);
    expect(c.escalation.reasons).toEqual(
      expect.arrayContaining([
        'legal or regulatory sensitivity',
        'financial impact',
        'travel is imminent',
        'repeated failure',
      ]),
    );
  });
  it('an ordinary question is not an escalation', () => {
    const c = classifySupport('What time does check-in open at the hotel?');
    expect(c.escalation.escalate).toBe(false);
    expect(c.complaint).toBe(false);
  });
});

describe('email and call triage', () => {
  it('summarises, finds booking references and requests, and drafts (never sends) a reply', () => {
    const t = triageMessage(
      'Refund',
      'Hello. Please cancel booking ANJ-ABC123 and refund me. Thanks.',
      { customerName: 'Ayo Bello', channel: 'EMAIL' },
    );
    expect(t.bookingReferences).toEqual(['ANJ-ABC123']);
    expect(t.requests).toEqual(
      expect.arrayContaining(['wants a refund', 'wants to cancel']),
    );
    expect(t.draftReply).toContain('Dear Ayo Bello');
    expect(t.requiresHumanApproval).toBe(true);
    expect(t.approvalReasons).toEqual(
      expect.arrayContaining([
        'it concerns a refund',
        'it concerns a cancellation',
      ]),
    );
    expect(t.suggestedTasks.length).toBeGreaterThan(0);
  });
  it('does not require approval for a harmless enquiry', () => {
    expect(
      triageMessage('Hours', 'What are your opening hours?', {
        channel: 'EMAIL',
      }).requiresHumanApproval,
    ).toBe(false);
  });
});
