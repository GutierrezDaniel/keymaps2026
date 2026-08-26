// Spanish UI components: entry cards with flip, masked passwords with
// reveal/hide, the entry form modal, delete confirmation, search/filters and
// the login backoff notice (vault-ui spec).
//
// All user-visible copy is neutral professional Spanish. Components are
// presentational: they receive data and callbacks, and never talk to the
// backend directly — which keeps them testable headless.
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CATEGORIES } from "./api";
import type { EntrySummary, EntryDetails, EntryInput, Filters, CopyField } from "./api";
import "./styles.css";

// ---------------------------------------------------------------------------
// Masked password with reveal/hide toggle (vault-ui "Password masking").
// ---------------------------------------------------------------------------

/** A password value that is masked by default with an explicit reveal/hide
 *  toggle. The bullet count never shows a short password's true length. */
export function MaskedPassword({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className="password-field">
      <span className="password-value" aria-label="Valor de la contraseña">
        {revealed ? value : "•".repeat(Math.max(value.length, 8))}
      </span>
      <button
        type="button"
        className="link-button"
        onClick={() => setRevealed((previous) => !previous)}
      >
        {revealed ? "Ocultar" : "Mostrar"}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Copy control with transient "Copiado" feedback.
// ---------------------------------------------------------------------------

function CopyButton({ label, onCopy }: { label: string; onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function handleClick() {
    onCopy();
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className="copy-button" onClick={handleClick}>
      {copied ? "Copiado" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Entry card with flip (vault-ui "Spanish entry cards").
// ---------------------------------------------------------------------------

export interface EntryCardProps {
  entry: EntrySummary;
  /** Decrypted details; null until the card has been flipped once. */
  details: EntryDetails | null;
  flipped: boolean;
  onToggleFlip: () => void;
  onCopy: (field: CopyField) => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** A card whose front shows the site summary and whose back shows all six
 *  fields with Spanish labels. Copy controls exist only for link, password,
 *  email and username — never for the category (vault-ui "Non-copyable
 *  category"). */
export function EntryCard({
  entry,
  details,
  flipped,
  onToggleFlip,
  onCopy,
  onEdit,
  onDelete,
}: EntryCardProps) {
  const password = details?.password ?? "";
  return (
    <article className={`entry-card${flipped ? " flipped" : ""}`} data-testid="entry-card">
      <div className="card-inner">
        <div className="card-face card-front">
          <h3 className="card-site">{entry.site}</h3>
          <span className="category-badge">{entry.category}</span>
          <p className="card-link">{entry.link}</p>
          <p className="card-email">{entry.email}</p>
          <button type="button" className="flip-button" onClick={onToggleFlip}>
            Ver detalles
          </button>
        </div>

        <div className="card-face card-back">
          <dl className="entry-fields">
            <div className="field-row">
              <dt>Sitio</dt>
              <dd>{entry.site}</dd>
            </div>
            <div className="field-row">
              <dt>Enlace</dt>
              <dd>
                {entry.link}
                <CopyButton label="Copiar enlace" onCopy={() => onCopy("link")} />
              </dd>
            </div>
            <div className="field-row">
              <dt>Contraseña</dt>
              <dd>
                <MaskedPassword value={password} />
                <CopyButton label="Copiar contraseña" onCopy={() => onCopy("password")} />
              </dd>
            </div>
            <div className="field-row">
              <dt>Correo</dt>
              <dd>
                {entry.email}
                <CopyButton label="Copiar correo" onCopy={() => onCopy("email")} />
              </dd>
            </div>
            <div className="field-row">
              <dt>Usuario</dt>
              <dd>
                {entry.username}
                <CopyButton label="Copiar usuario" onCopy={() => onCopy("username")} />
              </dd>
            </div>
            <div className="field-row">
              <dt>Categoría</dt>
              <dd>{entry.category}</dd>
            </div>
          </dl>
          <div className="card-actions">
            <button type="button" className="flip-button" onClick={onToggleFlip}>
              Ver resumen
            </button>
            <button type="button" className="action-button" onClick={onEdit}>
              Editar
            </button>
            <button type="button" className="action-button danger" onClick={onDelete}>
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Entry form modal (vault-ui "Form validation").
// ---------------------------------------------------------------------------

export interface EntryFormModalProps {
  open: boolean;
  /** Entry being edited, or null for a new entry. */
  initial: EntrySummary | null;
  initialPassword?: string;
  onSave: (input: EntryInput) => void;
  onCancel: () => void;
}

interface FieldErrors {
  site?: string;
  password?: string;
}

/** Modal with the six entry fields. Submitting with a missing required field
 *  keeps the modal open and shows a Spanish validation message. */
export function EntryFormModal({
  open,
  initial,
  initialPassword = "",
  onSave,
  onCancel,
}: EntryFormModalProps) {
  const [site, setSite] = useState(initial?.site ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [password, setPassword] = useState(initialPassword);
  const [email, setEmail] = useState(initial?.email ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [errors, setErrors] = useState<FieldErrors>({});

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
      <form className="modal" role="dialog" aria-modal="true" aria-label="Formulario de entrada" onSubmit={handleSubmit}>
        <h2>{initial ? "Editar entrada" : "Nueva entrada"}</h2>

        <label htmlFor="field-site">
          Sitio *
          <input
            id="field-site"
            value={site}
            onChange={(event) => setSite(event.target.value)}
            aria-invalid={Boolean(errors.site)}
          />
        </label>
        {errors.site && (
          <p className="field-error" role="alert">
            {errors.site}
          </p>
        )}

        <label htmlFor="field-link">
          Enlace
          <input
            id="field-link"
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
        </label>

        <label htmlFor="field-password">
          Contraseña *
          <input
            id="field-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
          />
        </label>
        {errors.password && (
          <p className="field-error" role="alert">
            {errors.password}
          </p>
        )}

        <label htmlFor="field-email">
          Correo
          <input
            id="field-email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label htmlFor="field-username">
          Usuario
          <input
            id="field-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label htmlFor="field-category">
          Categoría
          <select
            id="field-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <div className="modal-actions">
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

// ---------------------------------------------------------------------------
// Delete confirmation (vault-ui "Deletion confirmation").
// ---------------------------------------------------------------------------

export interface DeleteConfirmProps {
  entry: EntrySummary;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Spanish confirmation step shown before an entry is removed. */
export function DeleteConfirm({ entry, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-label="Confirmar eliminación">
        <h2>Eliminar entrada</h2>
        <p>¿Eliminar la entrada «{entry.site}»?</p>
        <p className="warning">Esta acción no se puede deshacer.</p>
        <div className="modal-actions">
          <button type="button" className="action-button danger" onClick={onConfirm}>
            Eliminar
          </button>
          <button type="button" className="action-button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search and filters (vault-entries "Search and filters").
// ---------------------------------------------------------------------------

export interface SearchFiltersProps {
  filters: Filters;
  onChange: (next: Filters) => void;
}

/** Site search plus category and email filters, all conjunctive. */
export function SearchFilters({ filters, onChange }: SearchFiltersProps) {
  return (
    <div className="filters">
      <input
        type="search"
        className="filter-input"
        placeholder="Buscar por sitio…"
        aria-label="Buscar por sitio"
        value={filters.site ?? ""}
        onChange={(event) => onChange({ ...filters, site: event.target.value })}
      />
      <select
        className="filter-input"
        aria-label="Filtrar por categoría"
        value={filters.category ?? ""}
        onChange={(event) =>
          onChange({ ...filters, category: event.target.value || null })
        }
      >
        <option value="">Todas las categorías</option>
        {CATEGORIES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <input
        type="search"
        className="filter-input"
        placeholder="Filtrar por correo…"
        aria-label="Filtrar por correo"
        value={filters.email ?? ""}
        onChange={(event) => onChange({ ...filters, email: event.target.value })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login backoff notice (vault-session "Bounded login attempts").
// ---------------------------------------------------------------------------

export interface BackoffNoticeProps {
  seconds: number;
  /** Called when the countdown reaches zero. */
  onExpire: () => void;
}

/** Counts down the Rust backoff delay with a Spanish message. */
export function BackoffNotice({ seconds, onExpire }: BackoffNoticeProps) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => setRemaining((current) => current - 1), 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  useEffect(() => {
    if (remaining === 0) onExpire();
  }, [remaining, onExpire]);

  return (
    <p className="backoff" role="alert">
      Demasiados intentos fallidos. Intenta de nuevo en {remaining} segundos.
    </p>
  );
}