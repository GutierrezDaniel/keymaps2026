// BackoffNotice tests: the Spanish backoff countdown and expire callback.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { BackoffNotice } from "./index";

afterEach(() => {
  vi.useRealTimers();
});

describe("BackoffNotice — countdown surfacing", () => {
  it("shows the Spanish backoff message with the remaining seconds", () => {
    vi.useFakeTimers();
    render(<BackoffNotice seconds={3} onExpire={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toContain("en 3 segundos");
  });

  it("counts down each second and calls onExpire at zero", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<BackoffNotice seconds={2} onExpire={onExpire} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("alert").textContent).toContain("en 1 segundos");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});