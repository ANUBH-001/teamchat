import { shouldSend } from '../sendGuard';

test('ignores empty text', () => { expect(shouldSend(null, '  ', 1000)).toBe(false); });
test('ignores the same text within 300 ms', () => { expect(shouldSend({ text: 'hi', at: 1000 }, 'hi', 1200)).toBe(false); });
test('allows the same text later, or different text right away', () => {
  expect(shouldSend({ text: 'hi', at: 1000 }, 'hi', 1400)).toBe(true);
  expect(shouldSend({ text: 'hi', at: 1000 }, 'yo', 1100)).toBe(true);
});
