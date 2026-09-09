// ImportConfirmModal tests: the Spanish vault replacement confirmation.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ImportConfirmModal } from "./index";

describe("ImportConfirmModal — Spanish replacement confirmation", () => {
  it("explains the replacement and offers Cancel/Confirm in Spanish", () => {
    render(<ImportConfirmModal onConfirm={() => undefined} onCancel={() => undefined} />);
    const dialog = screen.getByRole("alertdialog", { name: "Confirmar importación" });
    expect(within(dialog).getByText(/Se reemplazará la bóveda actual/)).toBeTruthy();
    expect(within(dialog).getByText("Esta acción no se puede deshacer.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Importar" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("calls onConfirm from the Importar action and onCancel from Cancelar", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ImportConfirmModal onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Importar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});