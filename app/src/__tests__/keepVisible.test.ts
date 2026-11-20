// Acceptance test 2026-11-20: the check-in card's reply box sat under the keyboard while typing. The card measures the
// box and the chat list scrolls by revealDelta.
import { revealDelta } from '../keepVisible';

test('no scroll when the box is already above the bottom of the visible list', () => {
  expect(revealDelta(500, 1000)).toBe(0);
  expect(revealDelta(992, 1000)).toBe(0); // exactly the margin
});

test('scrolls by how far the box bottom is below the visible list (plus the margin)', () => {
  expect(revealDelta(1337, 1000)).toBe(345);
  expect(revealDelta(1000, 1000, 0)).toBe(0);
  expect(revealDelta(1000.2, 1000, 0)).toBe(1); // whole pixels, never short
});
