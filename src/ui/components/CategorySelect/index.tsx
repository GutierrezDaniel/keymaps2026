// Spanish UI component — the entry sheet's category picker (vault-ui): a
// custom themed listbox that matches the vault filters. All user-visible copy
// is neutral professional Spanish. Presentational: it receives the current
// value, the repository categories and the change callback, and never talks
// to the backend directly — which keeps it testable headless.
import { useRef, useState } from "react";
import type { CategoryDto } from "../../api";
import { sortCategories } from "../../helpers/sortCategories";
import { useDismissable } from "../../helpers/useDismissable";

export interface CategorySelectProps {
  value: string;
  /** Repository categories; rendered alphabetically (ties by exact name). */
  categories: CategoryDto[];
  onChange: (category: string) => void;
}

/** The entry sheet's category picker. A native <select> opens its options
 *  with the OS theme (white in WebKit/GTK) no matter the CSS, so the modal
 *  uses the same themed listbox pattern as the vault filters. */
export function CategorySelect({ value, categories, onChange }: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useDismissable(open, rootRef, () => setOpen(false));

  const options = sortCategories(categories);

  return (
    <div className="category-select" ref={rootRef}>
      <button
        type="button"
        id="field-category"
        className="category-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span>{value}</span>
        <span className="category-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="filter-listbox category-listbox" role="listbox" aria-label="Categoría">
          {options.map((option) => (
            <button
              key={option.name}
              type="button"
              role="option"
              aria-selected={option.name === value}
              className={`filter-option${option.name === value ? " selected" : ""}`}
              onClick={() => {
                onChange(option.name);
                setOpen(false);
              }}
            >
              {option.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
