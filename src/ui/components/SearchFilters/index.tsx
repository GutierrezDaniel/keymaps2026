// Spanish UI component — vault-entries "Search and filters": site searchbox
// plus category and email dropdowns, all conjunctive. All user-visible copy
// is neutral professional Spanish. The component is presentational: it
// receives data and callbacks, and never talks to the backend directly —
// which keeps it testable headless. Its repository categories come from the
// shared CategoriesContext (the filter dropdown options), not from App prop
// drilling.
import { AtSign, ListFilter, Search } from "lucide-react";
import type { Filters } from "../../api";
import { useCategories } from "../../contexts/CategoriesContext";
import { sortCategories } from "../../helpers/sortCategories";
import { FilterListbox } from "../FilterListbox";

export interface SearchFiltersProps {
  filters: Filters;
  /** Complete distinct email set from the repository — never derived from the
   *  loaded entry list, which a filter can shrink to a subset. */
  emails: string[];
  onChange: (next: Filters) => void;
}

/** Site searchbox plus category and email dropdowns, all conjunctive. The
 *  email options come from the backend so the selector stays complete even
 *  while a filter shrinks the loaded entries. */
export function SearchFilters({ filters, emails, onChange }: SearchFiltersProps) {
  const { categories } = useCategories();
  return (
    <div className="filters">
      <div className="search-shell">
        <Search size={16} className="search-icon" aria-hidden="true" />
        <input
          type="search"
          className="filter-input searchbox"
          placeholder="Buscar por sitio…"
          aria-label="Buscar por sitio"
          value={filters.site ?? ""}
          onChange={(event) => onChange({ ...filters, site: event.target.value || null })}
        />
      </div>
      <FilterListbox
        triggerLabel="Filtrar por categoría"
        emptyLabel="Todas las categorías"
        value={filters.category ?? null}
        options={sortCategories(categories).map((category) => ({
          value: category.name,
          label: category.name,
        }))}
        onChange={(category) => onChange({ ...filters, category })}
        icon={<ListFilter size={17} />}
      />
      <FilterListbox
        triggerLabel="Filtrar por correo"
        emptyLabel="Todos los correos"
        value={filters.email ?? null}
        options={emails.map((email) => ({ value: email, label: email }))}
        onChange={(email) => onChange({ ...filters, email })}
        icon={<AtSign size={17} />}
      />
    </div>
  );
}
