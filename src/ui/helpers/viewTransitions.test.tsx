// viewTransitions tests: the feature-detection helper and the same-document
// transition wrapper (design decision 5). The fallback path (no API) runs the
// commit directly; the supported path stubs `document.startViewTransition` so
// the phase marker is added before the commit and removed when the transition
// finishes, while modal morphs (phase=false) never touch the class list.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { supportsViewTransitions, withViewTransition } from "./viewTransitions";

type ViewTransitionStub = (callback: () => void | Promise<void>) => {
  finished: Promise<void>;
};

function stubStartViewTransition(impl: ViewTransitionStub): void {
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    writable: true,
    value: impl,
  });
}

afterEach(() => {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
});

describe("supportsViewTransitions", () => {
  it("reports false while the API is absent", () => {
    expect(supportsViewTransitions()).toBe(false);
  });

  it("reports true once startViewTransition exists on document", () => {
    stubStartViewTransition(vi.fn() as unknown as ViewTransitionStub);
    expect(supportsViewTransitions()).toBe(true);
  });
});

describe("withViewTransition", () => {
  it("runs the commit directly on the fallback path", () => {
    const commit = vi.fn();
    withViewTransition(commit, true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(
      document.documentElement.classList.contains("phase-transition"),
    ).toBe(false);
  });

  it("wraps the commit and adds then removes the phase marker", async () => {
    stubStartViewTransition((callback) => {
      // The marker must be on before the commit snapshot.
      expect(
        document.documentElement.classList.contains("phase-transition"),
      ).toBe(true);
      callback();
      return { finished: Promise.resolve() };
    });
    const commit = vi.fn();

    withViewTransition(commit, true);

    expect(commit).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    // The transition finished → the marker is cleaned up.
    expect(
      document.documentElement.classList.contains("phase-transition"),
    ).toBe(false);
  });

  it("skips the phase marker for modal morphs", async () => {
    stubStartViewTransition((callback) => {
      expect(
        document.documentElement.classList.contains("phase-transition"),
      ).toBe(false);
      callback();
      return { finished: Promise.resolve() };
    });
    const commit = vi.fn();

    withViewTransition(commit, false);

    expect(commit).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      document.documentElement.classList.contains("phase-transition"),
    ).toBe(false);
  });
});