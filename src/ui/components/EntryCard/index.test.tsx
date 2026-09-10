// EntryCard tests: summary card with the category color chip (vault-ui). The
// chip color comes from the shared CategoriesContext (repository map).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { EntrySummary, CategoryDto } from "../../api";
import { CategoriesProvider } from "../../contexts/CategoriesContext";
import { EntryCard } from "./index";

const SUMMARY: EntrySummary = {
  id: "id-1",
  site: "GitHub",
  link: "https://github.com",
  email: "ana@example.com",
  username: "ana",
  category: "trabajo",
};

/** Repository map fixture: the card's category resolves to this color. */
const CATEGORIES: CategoryDto[] = [{ name: "trabajo", color: "#c05640" }];

function renderCard(
  overrides: Partial<Parameters<typeof EntryCard>[0]> = {},
  categories: CategoryDto[] = CATEGORIES,
) {
  return render(
    <CategoriesProvider categories={categories} usage={{}}>
      <EntryCard entry={SUMMARY} onOpen={() => undefined} {...overrides} />
    </CategoriesProvider>,
  );
}

describe("EntryCard — summary card and category color chip", () => {
  it("shows only the site name and carries the category as a color chip", () => {
    renderCard();
    const card = screen.getByTestId("entry-card");
    expect(within(card).getByText("GitHub")).toBeTruthy();
    expect(card.getAttribute("data-category")).toBe("trabajo");
    expect(screen.getByRole("button", { name: "Ver detalles de GitHub" })).toBeTruthy();
  });

  it("hides plaintext secrets on the summary card", () => {
    renderCard();
    expect(screen.queryByText("s3cr3t")).toBeNull();
    expect(screen.queryByText("ana@example.com")).toBeNull();
  });

  it("calls onOpen when the card is activated", () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Ver detalles de GitHub" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("marks the card as the morph origin when requested", () => {
    renderCard({ morphOrigin: true });
    const card = screen.getByTestId("entry-card");
    expect(card.classList.contains("morph-origin")).toBe(true);
  });

  it("paints the chip with the repository color via the CSS custom property", () => {
    renderCard();
    const card = screen.getByTestId("entry-card");
    expect(card.style.getPropertyValue("--category-color")).toBe("#c05640");
  });

  it("leaves the CSS variable unset for an unknown category so the fallback applies", () => {
    renderCard({}, []);
    const card = screen.getByTestId("entry-card");
    expect(card.style.getPropertyValue("--category-color")).toBe("");
  });
});