// Acceptance test 2026-11-20: Reports showed "Sign-off Missing" for a member who answered the evening check-in card.
jest.mock('../useVoiceInput', () => ({ toast: jest.fn() }));
import { hasReport } from '../screens/ReportsScreen';

test('a morning or evening check-in reply counts as a report; nothing at all is missing', () => {
  expect(hasReport({ signoff: null, morning: { status: 'missing' }, evening: { status: 'submitted' } })).toBe(true);
  expect(hasReport({ signoff: null, morning: { status: 'submitted' }, evening: { status: 'missing' } })).toBe(true);
  expect(hasReport({ signoff: { status: 'submitted' }, morning: { status: 'missing' }, evening: { status: 'missing' } })).toBe(true);
  expect(hasReport({ signoff: null, morning: { status: 'missing' }, evening: { status: 'missing' } })).toBe(false);
  expect(hasReport({})).toBe(false);
});
