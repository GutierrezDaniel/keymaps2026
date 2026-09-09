// Spanish UI component — the unified entry sheet (vault-ui): one modal for
// viewing details, creating and editing an existing entry. Shows the six
// fields as a form; copy controls appear only for an existing entry (link,
// password, email, username — never the category), and delete only for an
// existing entry. All user-visible copy is neutral professional Spanish.
// Presentational: it receives the entry, the optional morphing flag and
// callbacks, and never talks to the backend directly — which keeps it
// testable headless. Its repository categories come from the shared
// CategoriesContext (the picker options), not from App prop drilling.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, Trash2, X } from "lucide-react";
import type { EntrySummary, EntryInput, CopyField } from "../../api";
import { useCategories } from "../../contexts/CategoriesContext";
import { CategorySelect } from "../CategorySelect";
import { CopyButton } from "../CopyButton";

export interface EntryModalProps {
  open: boolean;
  /** Entry being viewed/edited, or null for a new entry. */
  initial: EntrySummary | null;
  /** Decrypted password for an existing entry (prefill); empty for new. */
  initialPassword?: string;
  /** True while a card→modal view transition is morphing this sheet in; the
   *  CSS flip-in is suppressed so the two animations do not fight. */
  morphing?: boolean;
  onSave: (input: EntryInput) => void;
  onCancel: () => void;
  /** Copy a secret field — wired only for an existing entry. */
  onCopy?: (field: CopyField) => void;
  /** Delete the entry — wired only for an existing entry. */
  onDelete?: () => void;
}

interface FieldErrors {
  site?: string;
  password?: string;
}

/** The unified entry sheet: create, view and edit share one modal. */
export function EntryModal({
  open,
  initial,
  initialPassword = "",
  morphing = false,
  onSave,
  onCancel,
  onCopy,
  onDelete,
}: EntryModalProps) {
  const { categories } = useCategories();
  const [site, setSite] = useState(initial?.site ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [password, setPassword] = useState(initialPassword);
  const [email, setEmail] = useState(initial?.email ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [category, setCategory] = useState(initial?.category ?? categories[0]?.name ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [revealPassword, setRevealPassword] = useState(false);
  const isExisting = initial !== null;

  // Re-sync field state every time the modal opens. A fresh entry starts
  // empty, an edit starts from the entry's values; without this the component
  // keeps stale inputs between openings because it is not remounted (its key
  // is stable per entry id / "new").
  useEffect(() => {
    if (!open) return;
    setSite(initial?.site ?? "");
    setLink(initial?.link ?? "");
    setPassword(initialPassword);
    setEmail(initial?.email ?? "");
    setUsername(initial?.username ?? "");
    setCategory(initial?.category ?? categories[0]?.name ?? "");
    setErrors({});
    setRevealPassword(false);
  }, [open]);

  if (!open) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    if (site.trim() === "") nextErrors.site = "El sitio es obligatorio.";
    if (password === "") nextErrors.password = "La contraseña es obligatoria.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    onSave({
      site: site.trim(),
      link: link.trim(),
      password,
      email: email.trim(),
      username: username.trim(),
      category,
    });
  }

  return (
    <div className="modal-overlay" role="presentation">
      <form
        className={`modal details-modal${morphing ? " morphing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Formulario de entrada"
        onSubmit={handleSubmit}
      >
        <div className="details-head">
          <h2>{initial ? "Editar entrada" : "Nueva entrada"}</h2>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <div className="field-control">
          <label htmlFor="field-site">Sitio *</label>
          <div className="field-row-inline">
            <input
              id="field-site"
              value={site}
              onChange={(event) => setSite(event.target.value)}
              aria-invalid={Boolean(errors.site)}
            />
          </div>
          {errors.site && (
            <p className="field-error" role="alert">
              {errors.site}
            </p>
          )}
        </div>

        <div className="field-control">
          <label htmlFor="field-category">Categoría</label>
          <div className="field-row-inline">
            <CategorySelect value={category} categories={categories} onChange={setCategory} />
          </div>
        </div>

        <div className="field-control">
          <label htmlFor="field-password">Contraseña *</label>
          <div className="field-row-inline">
            <input
              id="field-password"
              type={revealPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.password)}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={revealPassword ? "Ocultar" : "Mostrar"}
              onClick={() => setRevealPassword((previous) => !previous)}
            >
              {revealPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            {isExisting && onCopy && (
              <CopyButton label="Copiar contraseña" onCopy={() => onCopy("password")} />
            )}
          </div>
          {errors.password && (
            <p className="field-error" role="alert">
              {errors.password}
            </p>
          )}
        </div>

        <div className="field-control">
          <label htmlFor="field-email">Correo</label>
          <div className="field-row-inline">
            <input
              id="field-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {isExisting && onCopy && (
              <CopyButton label="Copiar correo" onCopy={() => onCopy("email")} />
            )}
          </div>
        </div>

        <div className="field-control">
          <label htmlFor="field-username">Usuario</label>
          <div className="field-row-inline">
            <input
              id="field-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            {isExisting && onCopy && (
              <CopyButton label="Copiar usuario" onCopy={() => onCopy("username")} />
            )}
          </div>
        </div>

        <div className="field-control">
          <label htmlFor="field-link">Enlace</label>
          <div className="field-row-inline">
            <input
              id="field-link"
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
            {isExisting && onCopy && (
              <CopyButton label="Copiar enlace" onCopy={() => onCopy("link")} />
            )}
          </div>
        </div>

        <div className="modal-actions">
          {isExisting && onDelete && (
            <button
              type="button"
              className="icon-button danger"
              aria-label="Eliminar"
              onClick={onDelete}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button type="submit" className="action-button primary">
            Guardar
          </button>
          <button type="button" className="action-button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
