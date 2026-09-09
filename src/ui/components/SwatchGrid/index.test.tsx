// SwatchGrid tests: the 24-swatch category color picker shared by the
// new-category form and the row editor — the selected swatch is announced via
// aria-checked and the select callback reports the color upward.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CATEGORY_PALETTE } from "../../api";
import { SwatchGrid } from "./index";

describe("SwatchGrid", () => {
  it("renders the 24 backend palette swatches as radios", () => {
    render(<SwatchGrid value={CATEGORY_PALETTE[0]} onSelect={() => undefined} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(24);
    expect(screen.getByRole("radiogroup", { name: "Color de categoría" })).toBeTruthy();
  });

  it("marks the current value as checked", () => {
    render(<SwatchGrid value={CATEGORY_PALETTE[7]} onSelect={() => undefined} />);
    expect(
      screen.getByRole("radio", { name: `Color ${CATEGORY_PALETTE[7]}` }),
    ).toHaveProperty("ariaChecked", "true");
    expect(
      screen.getByRole("radio", { name: `Color ${CATEGORY_PALETTE[0]}` }),
    ).toHaveProperty("ariaChecked", "false");
  });

  it("reports the selected color", () => {
    const onSelect = vi.fn();
    render(<SwatchGrid value={CATEGORY_PALETTE[0]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("radio", { name: "Color #2f5d8c" }));
    expect(onSelect).toHaveBeenCalledWith("#2f5d8c");
  });
});