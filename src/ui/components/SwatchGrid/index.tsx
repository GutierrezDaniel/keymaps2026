// Spanish UI component — the category color picker shared by the new-category
// form and the row editor (category-administration). All user-visible copy is
// neutral professional Spanish. Presentational: it receives the selected
// color and the select callback, and never talks to the backend directly —
// which keeps it testable headless.
import { CATEGORY_PALETTE } from "../../api";

/** The 24-swatch color picker shared by the new-category form and the row
 *  editor. Each swatch is a radio in a radiogroup so the selected color is
 *  announced and testable. */
export function SwatchGrid({ value, onSelect }: { value: string; onSelect: (color: string) => void }) {
  return (
    <div className="swatch-grid" role="radiogroup" aria-label="Color de categoría">
      {CATEGORY_PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={`Color ${color}`}
          className={`swatch${color === value ? " selected" : ""}`}
          style={{ background: color }}
          onClick={() => onSelect(color)}
        />
      ))}
    </div>
  );
}
