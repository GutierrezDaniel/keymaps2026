// Spanish UI components — world "Cuaderno de Códigos": entry cards show only
// the site name with a category color chip; selecting a card opens a centered
// details modal (flip-in) with icon actions. All user-visible copy is neutral
// professional Spanish. Components are presentational: they receive data and
// callbacks, and never talk to the backend directly — which keeps them
// testable headless.
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  AtSign,
  Check,
  Copy,
  Eye,
  EyeOff,
  ListFilter,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { CATEGORIES } from "./api";
import type { EntrySummary, EntryInput, Filters, CopyField } from "./api";
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
        className="icon-button"
        aria-label={revealed ? "Ocultar" : "Mostrar"}
        onClick={() => setRevealed((previous) => !previous)}
      >
        {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Copy control as an icon with transient "Copiado" feedback.
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
    <button
      type="button"
      className={`icon-button copy-button${copied ? " copied" : ""}`}
      aria-label={copied ? "Copiado" : label}
      onClick={handleClick}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Entry card — summary only (site name + category color chip). The whole card
// is the affordance that opens the details modal.
// ---------------------------------------------------------------------------

export interface EntryCardProps {
  entry: EntrySummary;
  /** True while the card is animating out before deletion. */
  leaving?: boolean;
  /** True while this card is the origin of a card→modal morph (it shares the
   *  modal's view-transition name only while the morph is in flight). */
  morphOrigin?: boolean;
  /** Called when the card is activated; receives the card's bounding rect so
   *  the caller can morph the details modal from this exact card. */
  onOpen: (origin: DOMRect | null) => void;
}

/** A card whose front shows only the site name; the category is carried by a
 *  colored top chip (data-category drives the ink color). Clicking opens the
 *  details modal. */
export function EntryCard({
  entry,
  leaving = false,
  morphOrigin = false,
  onOpen,
}: EntryCardProps) {
  return (
    <article
      className={`entry-card${leaving ? " leaving" : ""}${morphOrigin ? " morph-origin" : ""}`}
      data-testid="entry-card"
      data-category={entry.category}
    >
      <button
        type="button"
        className="card-open"
        aria-label={`Ver detalles de ${entry.site}`}
        onClick={(event) => {
          const card = event.currentTarget.closest(".entry-card");
          onOpen(card ? card.getBoundingClientRect() : null);
        }}
      >
        <span className="card-site">{entry.site}</span>
      </button>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Category dropdown — custom themed listbox for the entry sheet.
// ---------------------------------------------------------------------------

export interface CategorySelectProps {
  value: string;
  onChange: (category: string) => void;
}

/** The entry sheet's category picker. A native <select> opens its options
 *  with the OS theme (white in WebKit/GTK) no matter the CSS, so the modal
 *  uses the same themed listbox pattern as the vault filters. */
export function CategorySelect({ value, onChange }: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div className="category-select" ref={rootRef}>
      <button
        type="button"
        id="field-category"
        className="category-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span>{value}</span>
        <span className="category-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="filter-listbox category-listbox" role="listbox" aria-label="Categoría">
          {CATEGORIES.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              className={`filter-option${option === value ? " selected" : ""}`}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry modal — one modal for viewing details (creating), editing an
// existing one. Shows the six fields as a form; copy controls appear only
// for an existing entry (link, password, email, username — never the
// category), and delete only for an existing entry.
// ---------------------------------------------------------------------------

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
  const [site, setSite] = useState(initial?.site ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [password, setPassword] = useState(initialPassword);
  const [email, setEmail] = useState(initial?.email ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
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
    setCategory(initial?.category ?? CATEGORIES[0]);
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
            <CategorySelect value={category} onChange={setCategory} />
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
  /** Complete distinct email set from the repository — never derived from the
   *  loaded entry list, which a filter can shrink to a subset. */
  emails: string[];
  onChange: (next: Filters) => void;
}

interface FilterOption {
  value: string;
  label: string;
}

/** Icon-triggered dropdown (listbox) for a single conjunctive filter. */
function FilterListbox({
  triggerLabel,
  emptyLabel,
  value,
  options,
  onChange,
  icon,
}: {
  triggerLabel: string;
  emptyLabel: string;
  value: string | null;
  options: FilterOption[];
  onChange: (value: string | null) => void;
  icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const isActive = value !== null;

  return (
    <div className="filter-menu" ref={rootRef}>
      <button
        type="button"
        className={`icon-button filter-trigger${isActive ? " active" : ""}`}
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        {icon}
        {isActive && <span className="filter-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="filter-listbox" role="listbox" aria-label={triggerLabel}>
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            className={`filter-option${value === null ? " selected" : ""}`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            {emptyLabel}
          </button>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={`filter-option${value === option.value ? " selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Site searchbox plus category and email dropdowns, all conjunctive. The
 *  email options come from the backend so the selector stays complete even
 *  while a filter shrinks the loaded entries. */
export function SearchFilters({ filters, emails, onChange }: SearchFiltersProps) {
  return (
    <div className="filters">
      <div className="search-shell">
        <Search size={16} className="search-icon" aria-hidden="true" />
        <input
          type="search"
          className="filter-input searchbox"
          placeholder="Buscar por sitio…"
          aria-label="Buscar por sitio"
          value={filters.site ?? ""}
          onChange={(event) => onChange({ ...filters, site: event.target.value || null })}
        />
      </div>
      <FilterListbox
        triggerLabel="Filtrar por categoría"
        emptyLabel="Todas las categorías"
        value={filters.category ?? null}
        options={CATEGORIES.map((category) => ({ value: category, label: category }))}
        onChange={(category) => onChange({ ...filters, category })}
        icon={<ListFilter size={17} />}
      />
      <FilterListbox
        triggerLabel="Filtrar por correo"
        emptyLabel="Todos los correos"
        value={filters.email ?? null}
        options={emails.map((email) => ({ value: email, label: email }))}
        onChange={(email) => onChange({ ...filters, email })}
        icon={<AtSign size={17} />}
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