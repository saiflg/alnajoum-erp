import { positionFor } from './staff-card-position';

describe('positionFor', () => {
  it('prefers the job title that was typed in', () => {
    expect(positionFor('CEO', ['STAFF'])).toBe('CEO');
    expect(positionFor('  Senior Travel Consultant ', ['BRANCH_MANAGER'])).toBe(
      'Senior Travel Consultant',
    );
  });

  it('falls back to the role in plain words when there is no job title', () => {
    expect(positionFor(null, ['BRANCH_MANAGER'])).toBe('Branch Manager');
    expect(positionFor('', ['COMPANY_ADMIN'])).toBe('Company Administrator');
    expect(positionFor('   ', ['FINANCE_OFFICER'])).toBe('Finance Officer');
    expect(positionFor(undefined, ['STAFF'])).toBe('Staff');
  });

  it('makes a readable label for a custom role', () => {
    expect(positionFor(null, ['VISA_DESK_AGENT'])).toBe('Visa Desk Agent');
  });

  it('prints nothing rather than inventing a position', () => {
    expect(positionFor(null, [])).toBeNull();
    expect(positionFor(null, ['CUSTOMER'])).toBeNull();
  });
});
