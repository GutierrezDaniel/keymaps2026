// Spanish UI component — vault-entries "Search and filters": an icon-triggered
// dropdown (listbox) for a single conjunctive filter (category or email). All
// user-visible copy is neutral professional Spanish. The component is
// presentational: it receives data and callbacks, and never talks to the
// backend directly — which keeps it testable headless. Its overlay dismissal
// (outside click, Escape, unmount cleanup) is the shared `useDismissable`.
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useDismissable } from "../../helpers/useDismissable";

export interface FilterOption {
  value: string;
  label: string;
}

/** Icon-triggered dropdown (listbox) for a single conjunctive filter. */
export function FilterListbox({
  triggerLabel,
  emptyLabel,
  value,
  options,
  onChange,
  icon,
}: {
  triggerLabel: string;
  emptyLabel: string;
  value: string | null;
  options: FilterOption[];
  onChange: (value: string | null) => void;
  icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useDismissable(open, rootRef, () => setOpen(false));

  const isActive = value !== null;

  return (
    <div className="filter-menu" ref={rootRef}>
      <button
        type="button"
        className={`icon-button filter-trigger${isActive ? " active" : ""}`}
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        {icon}
        {isActive && <span className="filter-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="filter-listbox" role="listbox" aria-label={triggerLabel}>
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            className={`filter-option${value === null ? " selected" : ""}`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            {emptyLabel}
          </button>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={`filter-option${value === option.value ? " selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
