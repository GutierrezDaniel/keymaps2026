// FilterListbox tests: the icon-triggered filter dropdown — the empty
// (clear) option, value options, selection reporting and the shared
// useDismissable overlay dismissal (Escape). The component is also exercised
// through the SearchFilters and App suites; this focused file covers the
// folder's own contract.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { FilterListbox } from "./index";

function renderListbox(
  overrides: Partial<Parameters<typeof FilterListbox>[0]> = {},
) {
  const props = {
    triggerLabel: "Filtrar por correo",
    emptyLabel: "Todos los correos",
    value: null,
    options: [
      { value: "ana@example.com", label: "ana@example.com" },
      { value: "bob@example.com", label: "bob@example.com" },
    ],
    onChange: vi.fn(),
    icon: <span aria-hidden="true" /> as ReactNode,
    ...overrides,
  };
  render(<FilterListbox {...props} />);
  return props;
}

describe("FilterListbox", () => {
  it("opens the listbox with the empty option first", () => {
    renderListbox();
    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    const listbox = screen.getByRole("listbox", { name: "Filtrar por correo" });
    expect(listbox.querySelector('[role="option"]')?.textContent).toBe(
      "Todos los correos",
    );
  });

  it("reports the selected value option and closes", () => {
    const { onChange } = renderListbox();
    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    fireEvent.click(screen.getByRole("option", { name: "ana@example.com" }));
    expect(onChange).toHaveBeenCalledWith("ana@example.com");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clears the filter with the empty option", () => {
    const { onChange } = renderListbox({ value: "ana@example.com" });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    fireEvent.click(screen.getByRole("option", { name: "Todos los correos" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("dismisses the open listbox on Escape", () => {
    renderListbox();
    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    expect(screen.getByRole("listbox", { name: "Filtrar por correo" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});