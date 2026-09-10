// useDismissable tests: the shared overlay dismissal lifecycle (design
// decision 6) — outside mousedown and Escape dismiss while open, inside
// targets and non-Escape keys do not, the listeners attach only while open,
// detach on close and unmount, and the latest onDismiss is always called.
// Driven with renderHook + fireEvent per the design's testing strategy.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { useDismissable } from "./useDismissable";

function mount(open: boolean, onDismiss: () => void) {
  return renderHook(() => {
    const ref = useRef<HTMLDivElement>(null);
    useDismissable(open, ref, onDismiss);
    return ref;
  });
}

describe("useDismissable", () => {
  it("dismisses on an outside mousedown and ignores an inside one", () => {
    const onDismiss = vi.fn();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const inside = document.createElement("button");
    root.appendChild(inside);
    // useRef with a non-null initial value yields a mutable ref, so the hook
    // receives the attached root element.
    const { result } = renderHook(() => {
      const ref = useRef(root);
      useDismissable(true, ref, onDismiss);
      return ref;
    });
    expect(result.current.current).toBe(root);

    fireEvent.mouseDown(inside);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    document.body.removeChild(root);
  });

  it("does not dismiss when the root ref is not attached", () => {
    const onDismiss = vi.fn();
    mount(true, onDismiss);
    fireEvent.mouseDown(document.body);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses on Escape but not on other keys", () => {
    const onDismiss = vi.fn();
    mount(true, onDismiss);

    fireEvent.keyDown(document, { key: "Enter" });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("detaches the listeners when closed and re-attaches on reopen", () => {
    const onDismiss = vi.fn();
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => {
        const ref = useRef<HTMLDivElement>(null);
        useDismissable(open, ref, onDismiss);
        return ref;
      },
      { initialProps: { open: true } },
    );

    rerender({ open: false });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();

    rerender({ open: true });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("removes the listeners on unmount", () => {
    const onDismiss = vi.fn();
    const { unmount } = mount(true, onDismiss);

    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("calls the latest onDismiss across re-renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => {
        const ref = useRef<HTMLDivElement>(null);
        useDismissable(true, ref, cb);
        return ref;
      },
      { initialProps: { cb: first } },
    );

    rerender({ cb: second });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});