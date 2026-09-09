// BackupActionsMenu tests: the header dropdown with the Spanish backup
// actions, outside-click and Escape dismissal.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackupActionsMenu } from "./index";

describe("BackupActionsMenu — header dropdown", () => {
  it("opens the menu from the download trigger with both backup actions", () => {
    render(<BackupActionsMenu onExport={() => undefined} onImport={() => undefined} />);
    const trigger = screen.getByRole("button", { name: "Acciones de respaldo" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menuitem", { name: "Exportar respaldo" })).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Exportar respaldo" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Importar respaldo" })).toBeTruthy();
  });

  it("calls onExport/onImport and closes after selecting an item", () => {
    const onExport = vi.fn();
    const onImport = vi.fn();
    render(<BackupActionsMenu onExport={onExport} onImport={onImport} />);
    fireEvent.click(screen.getByRole("button", { name: "Acciones de respaldo" }));

    fireEvent.click(screen.getByRole("menuitem", { name: "Exportar respaldo" }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Acciones de respaldo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Importar respaldo" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on outside click", () => {
    render(<BackupActionsMenu onExport={() => undefined} onImport={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Acciones de respaldo" }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape", () => {
    render(<BackupActionsMenu onExport={() => undefined} onImport={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Acciones de respaldo" }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
  });
});