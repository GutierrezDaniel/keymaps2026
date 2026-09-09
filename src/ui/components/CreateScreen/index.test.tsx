// CreateScreen tests: the vault-creation form with its Spanish irreversible-
// loss warning, the two local validation branches (empty password, mismatched
// confirmation) and the confirmed-password upward callback. Presentational:
// the backend error is a prop, so the server-error render path is testable
// without IPC.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateScreen } from "./index";

function renderScreen(
  overrides: Partial<Parameters<typeof CreateScreen>[0]> = {},
) {
  const props = { error: null, onCreated: vi.fn(), ...overrides };
  render(<CreateScreen {...props} />);
  return props;
}

describe("CreateScreen — vault creation form", () => {
  it("shows the Spanish creation title and the irreversible-loss warning", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "Crear bóveda" })).toBeTruthy();
    expect(screen.getByText(/pérdida irreversible/i)).toBeTruthy();
    expect(screen.getByText(/no existe ningún mecanismo de recuperación/i)).toBeTruthy();
    expect(screen.getByLabelText("Nueva contraseña maestra")).toBeTruthy();
    expect(screen.getByLabelText("Confirmar contraseña maestra")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear bóveda" })).toBeTruthy();
  });

  it("shows no field error while the form is untouched", () => {
    renderScreen();
    expect(screen.queryByText("La contraseña maestra es obligatoria.")).toBeNull();
    expect(screen.queryByText("Las contraseñas no coinciden.")).toBeNull();
  });

  it("rejects an empty master password with a Spanish message", () => {
    const { onCreated } = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Crear bóveda" }));
    expect(screen.getByText("La contraseña maestra es obligatoria.")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("rejects a mismatching confirmation with a Spanish message", () => {
    const { onCreated } = renderScreen();
    fireEvent.change(screen.getByLabelText("Nueva contraseña maestra"), {
      target: { value: "una" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña maestra"), {
      target: { value: "otra" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear bóveda" }));
    expect(screen.getByText("Las contraseñas no coinciden.")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("reports the confirmed master password upward on a valid submit", () => {
    const { onCreated } = renderScreen();
    fireEvent.change(screen.getByLabelText("Nueva contraseña maestra"), {
      target: { value: "maestra-fuerte" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña maestra"), {
      target: { value: "maestra-fuerte" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear bóveda" }));
    expect(onCreated).toHaveBeenCalledWith("maestra-fuerte");
  });

  it("shows the server-reported error when no local error is pending", () => {
    renderScreen({ error: "Ocurrió un error: vault full" });
    expect(screen.getByText("Ocurrió un error: vault full")).toBeTruthy();
  });

  it("prefers the local validation error over the server error", () => {
    renderScreen({ error: "Ocurrió un error: vault full" });
    fireEvent.click(screen.getByRole("button", { name: "Crear bóveda" }));
    expect(screen.getByText("La contraseña maestra es obligatoria.")).toBeTruthy();
    expect(screen.queryByText("Ocurrió un error: vault full")).toBeNull();
  });
});