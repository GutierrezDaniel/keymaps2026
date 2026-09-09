// CopyButton tests: the secret-field copy control flashes "Copiado" for
// 1.5 s after the copy callback and restores the original label. The timer is
// cleared and replaced on repeated clicks so a stale reset never fires.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CopyButton } from "./index";

afterEach(() => {
  vi.useRealTimers();
});

describe("CopyButton", () => {
  it("runs the copy callback and flashes Copiado", () => {
    const onCopy = vi.fn();
    render(<CopyButton label="Copiar contraseña" onCopy={onCopy} />);
    expect(screen.getByRole("button", { name: "Copiar contraseña" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copiar contraseña" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Copiado" })).toBeTruthy();
  });

  it("restores the original label after 1.5 s", () => {
    vi.useFakeTimers();
    render(<CopyButton label="Copiar correo" onCopy={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar correo" }));
    expect(screen.getByRole("button", { name: "Copiado" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("button", { name: "Copiar correo" })).toBeTruthy();
  });

  it("clears the previous timer on a repeated click within the window", () => {
    vi.useFakeTimers();
    const onCopy = vi.fn();
    render(<CopyButton label="Copiar enlace" onCopy={onCopy} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Second click while still copied: the pending reset is replaced.
    fireEvent.click(screen.getByRole("button", { name: "Copiado" }));
    expect(onCopy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Copiado" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // The replaced timer was the 1.5 s one from the second click: not reset yet.
    expect(screen.getByRole("button", { name: "Copiado" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("button", { name: "Copiar enlace" })).toBeTruthy();
  });
});