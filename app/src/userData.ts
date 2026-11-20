// A-06: everything this phone keeps about the logged-in user, cleared on logout / kick so the next person who logs in on the
// same phone never sees (or sends) it: unsent text + voice messages (files too), stars, task cache, people store, check-in
// cache, signed media URLs and the expo-image caches. Device preferences (prefs.v1, voice language) are kept.
// bgUserId / bgRole are removed by background.endSession().
import { clearOutbox } from './outbox';
import { clearVoiceOutbox } from './voiceOutbox';
import { clearStars } from './starStore';
import { clearTaskCache } from './taskCache';
import { clearUsers } from './userStore';
import { clearCheckinToday } from './checkinStore';
import { clearMediaCache } from './media';

export async function clearUserData(): Promise<void> {
  clearTaskCache();
  clearUsers();
  clearCheckinToday();
  await Promise.all([
    clearOutbox().catch(() => {}),
    clearVoiceOutbox().catch(() => {}),
    clearStars().catch(() => {}),
    clearMediaCache().catch(() => {}),
  ]);
}
