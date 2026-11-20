// "Show 'Admin' label in chats": the server sends showAdminLabel with every user / member payload (false for an admin the
// owner chose to hide). Only an admin (role 'boss') can show the label; an old server that omits the flag keeps the old
// behaviour (label shown). This only hides the label, never changes what the admin may do (role checks stay on `role`).
export const showsAdminLabel = (u: { role?: string | null; showAdminLabel?: boolean } | null | undefined): boolean =>
  !!u && u.role === 'boss' && u.showAdminLabel !== false;
