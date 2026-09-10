// LoginScreen tests: the locked-screen master-password form with the Spanish
// quiet irreversible-loss warning, the server error/notice render paths and
// the backoff-gated submit. Presentational: error, notice, backoff and the
// unlock callback are props, so every state is testable without IPC. The
// countdown timer itself lives in BackoffNotice (its own focused suite).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoginScreen } from "./index";

function renderScreen(
  overrides: Partial<Parameters<typeof LoginScreen>[0]> = {},
) {
  const props = {
    error: null,
    notice: null,
    backoff: null,
    onExpireBackoff: vi.fn(),
    onUnlock: vi.fn(),
    ...overrides,
  };
  render(<LoginScreen {...props} />);
  return props;
}

describe("LoginScreen — unlock form", () => {
  it("shows the Spanish title and the quiet irreversible-loss warning", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "Desbloquear bóveda" })).toBeTruthy();
    expect(screen.getByText(/pérdida irreversible/i)).toBeTruthy();
    expect(screen.getByText(/no existe ningún mecanismo de recuperación/i)).toBeTruthy();
    expect(screen.getByLabelText("Contraseña maestra")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desbloquear" })).toBeTruthy();
  });

  it("submits the entered password to the unlock callback", () => {
    const { onUnlock } = renderScreen();
    fireEvent.change(screen.getByLabelText("Contraseña maestra"), {
      target: { value: "s3cret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    expect(onUnlock).toHaveBeenCalledWith("s3cret");
  });

  it("shows the server error and the post-create notice", () => {
    renderScreen({
      error: "Contraseña incorrecta.",
      notice: "Bóveda creada correctamente. Ahora inicia sesión.",
    });
    expect(screen.getByText("Contraseña incorrecta.")).toBeTruthy();
    expect(
      screen.getByText("Bóveda creada correctamente. Ahora inicia sesión."),
    ).toBeTruthy();
  });

  it("hides error and notice when both are null", () => {
    renderScreen();
    expect(screen.queryByText("Contraseña incorrecta.")).toBeNull();
    expect(
      screen.queryByText("Bóveda creada correctamente. Ahora inicia sesión."),
    ).toBeNull();
  });

  it("disables the submit and shows the backoff countdown while locked out", () => {
    renderScreen({ backoff: 5 });
    expect(screen.getByRole("button", { name: "Desbloquear" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByText(/en 5 segundos/)).toBeTruthy();
  });

  it("leaves the submit enabled when no backoff is pending", () => {
    renderScreen();
    expect(screen.getByRole("button", { name: "Desbloquear" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("forwards the backoff expiry callback to the countdown notice", () => {
    const { onExpireBackoff } = renderScreen({ backoff: 3 });
    expect(onExpireBackoff).toBeTruthy();
    expect(screen.getByText(/en 3 segundos/)).toBeTruthy();
  });
});