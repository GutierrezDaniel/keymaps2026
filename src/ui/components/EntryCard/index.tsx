// Spanish UI component — world "Cuaderno de Códigos": the entry card shows
// only the site name with a category color chip; selecting a card opens the
// centered details modal (flip-in) with icon actions. All user-visible copy
// is neutral professional Spanish. The component is presentational: it
// receives data and callbacks, and never talks to the backend directly —
// which keeps it testable headless. Its category color comes from the shared
// CategoriesContext (the repository map), not from App prop drilling.
import type { CSSProperties } from "react";
import type { EntrySummary } from "../../api";
import { useCategories } from "../../contexts/CategoriesContext";

export interface EntryCardProps {
  entry: EntrySummary;
  /** True while the card is animating out before deletion. */
  leaving?: boolean;
  /** True while this card is the origin of a card→modal morph (it shares the
   *  modal's view-transition name only while the morph is in flight). */
  morphOrigin?: boolean;
  /** Called when the card is activated (opens the details modal). */
  onOpen: () => void;
}

/** A card whose front shows only the site name; the category is carried by a
 *  colored top chip (`--category-color` drives the ink color, with a CSS
 *  fallback for unknown categories). Clicking opens the details modal. */
export function EntryCard({
  entry,
  leaving = false,
  morphOrigin = false,
  onOpen,
}: EntryCardProps) {
  const { categoryColor } = useCategories();
  const color = categoryColor(entry.category);
  return (
    <article
      className={`entry-card${leaving ? " leaving" : ""}${morphOrigin ? " morph-origin" : ""}`}
      style={color ? ({ "--category-color": color } as CSSProperties) : undefined}
      data-testid="entry-card"
      data-category={entry.category}
    >
      <button
        type="button"
        className="card-open"
        aria-label={`Ver detalles de ${entry.site}`}
        onClick={() => onOpen()}
      >
        <span className="card-site">{entry.site}</span>
      </button>
    </article>
  );
}
