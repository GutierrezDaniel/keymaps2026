// DeleteConfirm tests: the Spanish removal confirmation.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { EntrySummary } from "../../api";
import { DeleteConfirm } from "./index";

const SUMMARY: EntrySummary = {
  id: "id-1",
  site: "GitHub",
  link: "https://github.com",
  email: "ana@example.com",
  username: "ana",
  category: "trabajo",
};

describe("DeleteConfirm — Spanish confirmation", () => {
  it("asks for confirmation in Spanish before removal", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteConfirm entry={SUMMARY} onConfirm={onConfirm} onCancel={onCancel} />);

    expect(screen.getByText("¿Eliminar la entrada «GitHub»?")).toBeTruthy();
    expect(screen.getByText("Esta acción no se puede deshacer.")).toBeTruthy();
  });

  it("removes the entry only after confirming, and cancelling preserves it", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteConfirm entry={SUMMARY} onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});