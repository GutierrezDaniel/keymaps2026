// spanishMessages tests: the single source of exact Spanish user-facing
// error copy (design decision 4). `spanishMessage` maps every typed command
// error; `categoryErrorMessage` delegates the six category kinds to it and
// keeps the generic fallback for anything else — including "Locked", which
// the App handles itself and never shows inline.
import { describe, it, expect } from "vitest";
import { spanishMessage, categoryErrorMessage } from "./spanishMessages";
import type { CommandError } from "../api";

describe("spanishMessage", () => {
  it("maps the authentication kind", () => {
    expect(spanishMessage({ kind: "AuthenticationFailed" })).toBe(
      "Contraseña incorrecta.",
    );
  });

  it("maps the category kinds to their exact copy", () => {
    expect(spanishMessage({ kind: "InvalidCategory" })).toBe(
      "La categoría seleccionada no es válida.",
    );
    expect(spanishMessage({ kind: "BlankCategoryName" })).toBe(
      "El nombre de la categoría no puede estar vacío.",
    );
    expect(spanishMessage({ kind: "InvalidCategoryColor" })).toBe(
      "El color elegido no es válido.",
    );
    expect(spanishMessage({ kind: "DuplicateCategory" })).toBe(
      "Ya existe una categoría con ese nombre.",
    );
    expect(spanishMessage({ kind: "CategoryInUse" })).toBe(
      "La categoría está en uso y no se puede eliminar.",
    );
    expect(spanishMessage({ kind: "LastCategory" })).toBe(
      "Debe quedar al menos una categoría.",
    );
    expect(spanishMessage({ kind: "CategoryNotFound" })).toBe(
      "La categoría ya no existe.",
    );
  });

  it("maps the entry and field kinds", () => {
    expect(spanishMessage({ kind: "NotFound" })).toBe("La entrada ya no existe.");
    expect(spanishMessage({ kind: "InvalidField" })).toBe(
      "Los datos enviados no son válidos.",
    );
  });

  it("maps transport kinds with their message and with the generic fallback", () => {
    for (const kind of ["Crypto", "Store", "Clipboard", "Backup"] as const) {
      expect(spanishMessage({ kind, message: "detail" })).toBe(
        `Ocurrió un error: detail`,
      );
      expect(spanishMessage({ kind })).toBe("Ocurrió un error interno.");
    }
  });

  it("maps the Import kind to the secret-free generic copy", () => {
    expect(spanishMessage({ kind: "Import" })).toBe(
      "No se pudo importar la bóveda. Verifica que el archivo sea un respaldo válido e inténtalo de nuevo.",
    );
  });

  it("falls back to the unexpected-error copy for unknown kinds", () => {
    expect(spanishMessage({ kind: "Unknown", message: "x" })).toBe(
      "Ocurrió un error inesperado.",
    );
  });
});

describe("categoryErrorMessage", () => {
  it("delegates the six category kinds to spanishMessage", () => {
    for (const kind of [
      "BlankCategoryName",
      "InvalidCategoryColor",
      "DuplicateCategory",
      "CategoryInUse",
      "LastCategory",
      "CategoryNotFound",
    ] as const) {
      expect(categoryErrorMessage({ kind })).toBe(spanishMessage({ kind }));
    }
  });

  it("keeps the generic fallback for any other kind, including Locked", () => {
    const other: CommandError[] = [
      { kind: "Locked" },
      { kind: "AuthenticationFailed" },
      { kind: "NotFound" },
      { kind: "Unknown", message: "x" },
    ];
    for (const error of other) {
      expect(categoryErrorMessage(error)).toBe("Ocurrió un error inesperado.");
    }
  });
});