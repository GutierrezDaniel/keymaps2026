// sortCategories tests: deterministic alphabetical ordering with the exact
// tie-break contract — case-normalized name as the primary key, exact name as
// the secondary key (vault-entries "Category selectors are ordered"). The
// input array must never be mutated.
import { describe, it, expect } from "vitest";
import { sortCategories } from "./sortCategories";
import type { CategoryDto } from "../api";

function category(name: string, color = "#7a5220"): CategoryDto {
  return { name, color };
}

describe("sortCategories", () => {
  it("orders by case-normalized name", () => {
    const names = sortCategories([
      category("trabajo"),
      category("Entretenimiento"),
      category("estudio"),
    ]).map((c) => c.name);
    expect(names).toEqual(["Entretenimiento", "estudio", "trabajo"]);
  });

  it("ties equal case-normalized names by exact name", () => {
    const names = sortCategories([
      category("alfa"),
      category("Alfa"),
      category("trabajo"),
    ]).map((c) => c.name);
    expect(names).toEqual(["Alfa", "alfa", "trabajo"]);
  });

  it("breaks exact-case ties by codepoint (the -1 arm)", () => {
    const names = sortCategories([
      category("beta"),
      category("Beta"),
    ]).map((c) => c.name);
    expect(names).toEqual(["Beta", "beta"]);
  });

  it("keeps identical names stable (the 0 arm)", () => {
    const a = category("igual", "#2f5d8c");
    const b = category("igual", "#ad3a2d");
    expect(sortCategories([a, b])).toEqual([a, b]);
  });

  it("does not mutate the input array", () => {
    const input = [category("zeta"), category("alfa")];
    sortCategories(input);
    expect(input.map((c) => c.name)).toEqual(["zeta", "alfa"]);
  });
});