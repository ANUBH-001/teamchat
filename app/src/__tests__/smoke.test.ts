// Harness smoke test: the jest-expo preset can load app modules.
import { newClientId } from '../outbox';

test('newClientId is unique and short enough for the 64-char client_id column', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newClientId()));
  expect(ids.size).toBe(1000);
  for (const id of ids) expect(id.length).toBeLessThanOrEqual(64);
});
