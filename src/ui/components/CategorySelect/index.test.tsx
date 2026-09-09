// CategorySelect tests: the themed entry-sheet category picker — alphabetical
// options, selection reporting and the shared useDismissable overlay
// dismissal (outside mousedown). The picker is also exercised through the
// EntryModal suite; this focused file covers the folder's own contract.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CategoryDto } from "../../api";
import { CategorySelect } from "./index";

const CATEGORIES: CategoryDto[] = [
  { name: "trabajo", color: "#2f5d8c" },
  { name: "Alfa", color: "#c05640" },
  { name: "alfa", color: "#b76e2b" },
];

function renderSelect(
  overrides: Partial<Parameters<typeof CategorySelect>[0]> = {},
) {
  const props = { value: "", categories: CATEGORIES, onChange: vi.fn(), ...overrides };
  render(<CategorySelect {...props} />);
  return props;
}

describe("CategorySelect", () => {
  it("shows the current value and opens the alphabetical options", () => {
    renderSelect({ value: "trabajo" });
    expect(screen.getByRole("button").textContent).toBe("trabajo");

    fireEvent.click(screen.getByRole("button"));
    const listbox = screen.getByRole("listbox", { name: "Categoría" });
    const names = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (option) => option.textContent,
    );
    expect(names).toEqual(["Alfa", "alfa", "trabajo"]);
  });

  it("reports the selected option and closes the listbox", () => {
    const { onChange } = renderSelect();
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: "trabajo" }));
    expect(onChange).toHaveBeenCalledWith("trabajo");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("dismisses the open listbox on an outside mousedown", () => {
    renderSelect();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox", { name: "Categoría" })).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});