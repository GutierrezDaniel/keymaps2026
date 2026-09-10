// CategoriesContext — the single shared state boundary of the vault UI
// (design decision 2). App owns the category repository state (`categories`,
// `usage`) and feeds it to this provider once, around the unlocked vault
// composition; the four wide-fan-out consumers (EntryCard via its color map,
// EntryModal's category picker, SearchFilters, CategoryAdminModal) read the
// memoized value instead of drilling the same props through App. No other
// context exists: everything else stays prop-driven.
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { CategoryDto } from "../../api";

export interface CategoriesContextValue {
  categories: CategoryDto[];
  /** Number of entries referencing each category name, from the full
   *  unfiltered entry snapshot. */
  usage: Record<string, number>;
  /** Color for an entry's category chip from the repository map; undefined
   *  for unknown categories, so the card renders the CSS fallback. */
  categoryColor: (name: string) => string | undefined;
}

const CategoriesContext = createContext<CategoriesContextValue | null>(null);

/** Feed the repository categories and their usage counts to every category
 *  consumer below. The value is memoized on `[categories, usage]`, with the
 *  color lookup derived from the current category array. */
export function CategoriesProvider({
  categories,
  usage,
  children,
}: {
  categories: CategoryDto[];
  usage: Record<string, number>;
  children: ReactNode;
}) {
  const value = useMemo<CategoriesContextValue>(
    () => ({
      categories,
      usage,
      categoryColor: (name) => categories.find((category) => category.name === name)?.color,
    }),
    [categories, usage],
  );
  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>;
}

/** Consume the shared category data. Guards against use outside the provider:
 *  every consumer must render below a mounted `CategoriesProvider`. */
export function useCategories(): CategoriesContextValue {
  const value = useContext(CategoriesContext);
  if (value === null) {
    throw new Error("useCategories must be used within a CategoriesProvider");
  }
  return value;
}
