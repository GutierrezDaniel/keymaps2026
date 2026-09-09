// View Transitions API helpers (design decision 5): feature detection plus the
// same-document transition wrapper the App and its command hook use for the
// phase sheet fold/rise choreography and the card↔modal morphs. WebKitGTK
// versions used by Tauri on Linux may lack the API; every call degrades to the
// plain CSS fallback. Extracted from App.tsx (Phase 3) so the supported path is
// directly unit-testable with a stubbed `document.startViewTransition`.
/** View Transitions API, feature-detected. */
export function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && "startViewTransition" in document;
}

/** A minimal structural type for the View Transitions API surface we use. */
interface ViewTransition {
  finished: Promise<void>;
}

/** Wrap a state commit in a same-document view transition when the runtime
 *  supports it; otherwise run the commit directly. The `phase` marker adds the
 *  sheet fold/rise choreography (unlock/lock); modal morphs pass no marker.
 *  An async commit is awaited by the transition before the "after" snapshot,
 *  so phases that load data (unlock → vault) fold after the new page exists. */
export function withViewTransition(
  commit: () => void | Promise<void>,
  phase = false,
): void {
  if (!supportsViewTransitions()) {
    void commit();
    return;
  }
  const root = document.documentElement;
  if (phase) root.classList.add("phase-transition");
  const transition = (document as Document & {
    startViewTransition: (callback: () => void | Promise<void>) => ViewTransition;
  }).startViewTransition(commit);
  void transition.finished.finally(() => {
    if (phase) root.classList.remove("phase-transition");
  });
}
