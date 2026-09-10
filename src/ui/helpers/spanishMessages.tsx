// Spanish user-facing error mapping (design decision 4): one module owns every
// typed command-error → Spanish message string, consolidating the copy that
// previously lived twice — `spanishMessage` in App.tsx (all kinds) and
// `categoryErrorMessage` in the category admin modal (category kinds + generic
// fallback). The six category-error kinds are exact-identical in both, so the
// modal mapping delegates those kinds to `spanishMessage` and keeps its own
// generic fallback for anything else. Exact Spanish copy preserved verbatim.
import type { CommandError } from "../api";

/** Map a typed command error to a Spanish user-facing message. */
export function spanishMessage(error: CommandError): string {
  switch (error.kind) {
    case "AuthenticationFailed":
      return "Contraseña incorrecta.";
    case "InvalidCategory":
      return "La categoría seleccionada no es válida.";
    case "BlankCategoryName":
      return "El nombre de la categoría no puede estar vacío.";
    case "InvalidCategoryColor":
      return "El color elegido no es válido.";
    case "DuplicateCategory":
      return "Ya existe una categoría con ese nombre.";
    case "CategoryInUse":
      return "La categoría está en uso y no se puede eliminar.";
    case "LastCategory":
      return "Debe quedar al menos una categoría.";
    case "CategoryNotFound":
      return "La categoría ya no existe.";
    case "NotFound":
      return "La entrada ya no existe.";
    case "InvalidField":
      return "Los datos enviados no son válidos.";
    case "Crypto":
    case "Store":
    case "Clipboard":
    case "Backup":
      return error.message ? `Ocurrió un error: ${error.message}` : "Ocurrió un error interno.";
    case "Import":
      // Generic, secret/path-free copy: the backend deliberately maps every
      // import storage failure to the payload-free `Import` variant (design
      // "generic Spanish error copy without secrets or paths").
      return "No se pudo importar la bóveda. Verifica que el archivo sea un respaldo válido e inténtalo de nuevo.";
    default:
      return "Ocurrió un error inesperado.";
  }
}

/** Map a category command error to a Spanish inline message. "Locked" is
 *  deliberately absent: the App handles lock transitions itself. Only the six
 *  category kinds surface their specific copy (identical to `spanishMessage`);
 *  any other kind keeps the generic unexpected-error fallback, exactly as the
 *  original modal mapping did. */
export function categoryErrorMessage(error: CommandError): string {
  switch (error.kind) {
    case "BlankCategoryName":
    case "InvalidCategoryColor":
    case "DuplicateCategory":
    case "CategoryInUse":
    case "LastCategory":
    case "CategoryNotFound":
      return spanishMessage(error);
    default:
      return "Ocurrió un error inesperado.";
  }
}
