// Shared dismissal lifecycle (design decision 6): while `open`, an outside
// mousedown (target outside `rootRef`) or an Escape keydown dismisses the
// overlay; listeners attach only while open and are removed on close and on
// unmount. Extracted from the three duplicated effects that previously lived
// in CategorySelect, FilterListbox and BackupActionsMenu (Phase 3
// consolidation) so the behavior is defined once and directly testable.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** Register outside-click and Escape dismissal for an overlay while it is
 *  open. The root element ref delimits "inside": a mousedown whose target is
 *  outside it closes the overlay, matching the original per-component effects.
 *  The latest `onDismiss` is always called (kept in a ref so the listeners
 *  attach exactly once per open/close transition, never per re-render). */
export function useDismissable(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onDismissRef.current();
      }
    }
    function onDocKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismissRef.current();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [open, rootRef]);
}
