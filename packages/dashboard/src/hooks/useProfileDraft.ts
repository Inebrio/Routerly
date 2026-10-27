import { useEffect, useState } from 'react';

/**
 * Local (unsaved) choice between a shared profile and the router's own custom
 * settings. Nothing here reaches the service: the tab persists the draft only
 * when the user saves. `assignedId` is the stored assignment ('' = custom).
 */
export function useProfileDraft(assignedId: string) {
  const [draft, setDraft] = useState<string | null>(null);
  // A refreshed router means the stored assignment changed (a save): drop the draft.
  useEffect(() => setDraft(null), [assignedId]);
  const selected = draft ?? assignedId;
  return {
    selected,
    isCustom: selected === '',
    isPending: selected !== assignedId,
    selectProfile: (id: string) => setDraft(id),
    selectCustom: () => setDraft(''),
    discard: () => setDraft(null),
  };
}
