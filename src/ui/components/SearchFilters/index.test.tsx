// SearchFilters tests: site searchbox and the icon-triggered email/category
// dropdowns, including the deterministic Spanish option labels. The category
// options come from the shared CategoriesContext (repository map).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { CategoryDto, Filters } from "../../api";
import { CategoriesProvider } from "../../contexts/CategoriesContext";
import { SearchFilters } from "./index";

/** Repository-backed categories fixture (alphabetical, as the backend lists
 *  them): the four seeds with their migration colors. */
const CATEGORIES: CategoryDto[] = [
  { name: "entretenimiento", color: "#7a5220" },
  { name: "estudio", color: "#2f6b3f" },
  { name: "servicios", color: "#6a4a8f" },
  { name: "trabajo", color: "#2f5d8c" },
];

function renderFilters(
  props: { filters: Filters; emails: string[]; onChange: (next: Filters) => void },
  categories: CategoryDto[] = CATEGORIES,
) {
  return render(
    <CategoriesProvider categories={categories} usage={{}}>
      <SearchFilters {...props} />
    </CategoriesProvider>,
  );
}

describe("SearchFilters — site searchbox and icon-triggered dropdowns", () => {
  it("sends the typed site value as a filter from the searchbox", () => {
    const onChange = vi.fn();
    renderFilters({ filters: {}, emails: [], onChange });

    fireEvent.change(screen.getByLabelText("Buscar por sitio"), {
      target: { value: "GitHub" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ site: "GitHub" });
  });

  it("sends null instead of an empty string when the site filter is cleared", () => {
    const onChange = vi.fn();
    renderFilters({
      filters: { site: "GitHub", email: "ana@example.com" },
      emails: ["ana@example.com"],
      onChange,
    });

    fireEvent.change(screen.getByLabelText("Buscar por sitio"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ site: null, email: "ana@example.com" });
  });

  it("opens the email dropdown with every provided email and the all-emails option", () => {
    renderFilters({
      filters: {},
      emails: ["ana@example.com", "bob@example.com"],
      onChange: () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));

    const listbox = screen.getByRole("listbox", { name: "Filtrar por correo" });
    expect(within(listbox).getByRole("option", { name: "Todos los correos" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "ana@example.com" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "bob@example.com" })).toBeTruthy();
  });

  it("emits the selected email as a filter", () => {
    const onChange = vi.fn();
    renderFilters({ filters: {}, emails: ["ana@example.com"], onChange });

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    fireEvent.click(screen.getByRole("option", { name: "ana@example.com" }));

    expect(onChange).toHaveBeenLastCalledWith({ email: "ana@example.com" });
  });

  it("emits null for the email filter when Todos los correos is selected", () => {
    const onChange = vi.fn();
    renderFilters({
      filters: { site: "GitHub", email: "ana@example.com" },
      emails: ["ana@example.com"],
      onChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    fireEvent.click(screen.getByRole("option", { name: "Todos los correos" }));

    expect(onChange).toHaveBeenCalledWith({ site: "GitHub", email: null });
  });

  it("opens the category dropdown with the repository categories", () => {
    renderFilters({ filters: {}, emails: [], onChange: () => undefined });

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por categoría" }));

    const listbox = screen.getByRole("listbox", { name: "Filtrar por categoría" });
    expect(within(listbox).getByRole("option", { name: "Todas las categorías" })).toBeTruthy();
    for (const category of CATEGORIES) {
      expect(within(listbox).getByRole("option", { name: category.name })).toBeTruthy();
    }
  });

  it("lists the category options in deterministic alphabetical order", () => {
    renderFilters(
      { filters: {}, emails: [], onChange: () => undefined },
      [
        { name: "trabajo", color: "#2f5d8c" },
        { name: "Alfa", color: "#c05640" },
        { name: "alfa", color: "#b76e2b" },
      ],
    );

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por categoría" }));

    const listbox = screen.getByRole("listbox", { name: "Filtrar por categoría" });
    const labels = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent);
    // Case-normalized primary order (Alfa/alfa tie) then exact-name tie-break.
    expect(labels).toEqual(["Todas las categorías", "Alfa", "alfa", "trabajo"]);
  });
});