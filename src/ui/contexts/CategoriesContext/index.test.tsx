// CategoriesContext tests: the provider feeds the memoized
// {categories, usage, categoryColor} value (design decision 2) and the
// consumer hook guards against use outside the provider. The value identity
// assertions pin the `useMemo(..., [categories, usage])` contract: consumers
// keep a stable reference across unrelated re-renders and get a fresh one
// when the categories array or the usage object identity changes.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { CategoryDto } from "../../api";
import { CategoriesProvider, useCategories } from "./index";

const CATEGORIES: CategoryDto[] = [
  { name: "entretenimiento", color: "#7a5220" },
  { name: "trabajo", color: "#2f5d8c" },
];

function wrap(children: ReactNode, categories: CategoryDto[], usage: Record<string, number>) {
  return (
    <CategoriesProvider categories={categories} usage={usage}>
      {children}
    </CategoriesProvider>
  );
}

/** Provider harness whose categories/usage state the tests drive through the
 *  exposed setters, so the same mounted hook observes memoization refreshes. */
let updateCats!: (cats: CategoryDto[]) => void;
let updateUsage!: (usage: Record<string, number>) => void;

function Harness({ children }: { children: ReactNode }) {
  const [cats, setCats] = useState<CategoryDto[]>(CATEGORIES);
  const [usage, setUsage] = useState<Record<string, number>>({});
  updateCats = setCats;
  updateUsage = setUsage;
  return (
    <CategoriesProvider categories={cats} usage={usage}>
      {children}
    </CategoriesProvider>
  );
}

describe("CategoriesProvider", () => {
  it("exposes categories, usage and the color lookup", () => {
    const { result } = renderHook(() => useCategories(), {
      wrapper: ({ children }) => wrap(children, CATEGORIES, { trabajo: 2 }),
    });
    expect(result.current.categories).toBe(CATEGORIES);
    expect(result.current.usage).toEqual({ trabajo: 2 });
    expect(result.current.categoryColor("trabajo")).toBe("#2f5d8c");
    expect(result.current.categoryColor("fantasma")).toBeUndefined();
  });

  it("memoizes the value on [categories, usage] and refreshes on change", () => {
    const { result, rerender } = renderHook(() => useCategories(), {
      wrapper: Harness,
    });
    const first = result.current;

    // Unrelated re-renders with unchanged deps → stable value reference.
    rerender();
    expect(result.current).toBe(first);

    // New categories array → fresh value with the updated lookup.
    act(() => updateCats([...CATEGORIES, { name: "lectura", color: "#8a4f7d" }]));
    expect(result.current).not.toBe(first);
    expect(result.current.categoryColor("lectura")).toBe("#8a4f7d");

    // New usage object → fresh value carrying the new counts.
    const second = result.current;
    act(() => updateUsage({ trabajo: 9 }));
    expect(result.current).not.toBe(second);
    expect(result.current.usage).toEqual({ trabajo: 9 });
  });

  it("renders its children", () => {
    render(wrap(<div data-testid="child" />, CATEGORIES, {}));
    expect(document.querySelector('[data-testid="child"]')).toBeTruthy();
  });
});

describe("useCategories — provider guard", () => {
  it("throws when used outside a CategoriesProvider", () => {
    function Probe() {
      useCategories();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(
      "useCategories must be used within a CategoriesProvider",
    );
  });
});