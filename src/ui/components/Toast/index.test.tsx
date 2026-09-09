// Toast tests: transient backup feedback with exact Spanish messages, the
// aria-live roles, the auto-dismiss timer and the manual close button.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Toast, TOAST_DURATION_MS } from "./index";

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast — transient backup feedback", () => {
  it("renders success feedback as a polite status with a dismiss button", () => {
    render(
      <Toast
        kind="success"
        message="Respaldo exportado correctamente."
        onDismiss={() => undefined}
      />,
    );
    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Respaldo exportado correctamente.");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("button", { name: "Cerrar notificación" })).toBeTruthy();
  });

  it("renders error feedback as an assertive alert", () => {
    render(<Toast kind="error" message="No se pudo importar la bóveda." onDismiss={() => undefined} />);
    const toast = screen.getByRole("alert");
    expect(toast.textContent).toContain("No se pudo importar la bóveda.");
    expect(toast.getAttribute("aria-live")).toBe("assertive");
  });

  it("auto-dismisses after the toast duration", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast kind="success" message="Listo." onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses manually from the close button", () => {
    const onDismiss = vi.fn();
    render(<Toast kind="error" message="Ocurrió un error." onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});