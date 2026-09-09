// Category ordering (vault-entries "Category selectors are ordered"): the
// modal, the entry-form picker and every selector show categories in
// deterministic alphabetical order — case-normalized primary key, exact name
// as the secondary key. Single shared source for the ordering that previously
// lived as a private copy in SearchFilters, CategorySelect and
// CategoryAdminModal (Phase 3 consolidation).
import type { CategoryDto } from "../api";

export function sortCategories(categories: CategoryDto[]): CategoryDto[] {
  return [...categories].sort((a, b) => {
    const lowerA = a.name.toLowerCase();
    const lowerB = b.name.toLowerCase();
    if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return 0;
  });
}
