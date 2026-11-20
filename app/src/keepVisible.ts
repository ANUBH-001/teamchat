// Keep a text box that lives INSIDE a chat message (the daily check-in card's reply box) above the keyboard.
// The chat list is inverted and only the composer is moved by the window resize, so a box in the middle of a card could
// end up under the keyboard while typing (known limit from the check-in device test, fixed in the acceptance test
// 2026-11-20). The card asks the chat screen to scroll the list just enough to show the box again.
import { createContext } from 'react';

// How far (px) the list must move so that an item whose bottom edge is at `itemBottom` ends `margin` above `viewBottom`
// (both window coordinates). 0 when it is already visible.
export const revealDelta = (itemBottom: number, viewBottom: number, margin = 8) =>
  Math.max(0, Math.ceil(itemBottom + margin - viewBottom));

// Provided by ChatScreen: call with the window y of the bottom edge of the thing that must stay visible.
export const ChatRevealContext = createContext<((itemBottom: number) => void) | null>(null);
