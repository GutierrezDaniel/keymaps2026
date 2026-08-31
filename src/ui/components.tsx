// Spanish UI components — world "Cuaderno de Códigos": entry cards show only
// the site name with a category color chip; selecting a card opens a centered
// details modal (flip-in) with icon actions. All user-visible copy is neutral
// professional Spanish. Components are presentational: they receive data and
// callbacks, and never talk to the backend directly — which keeps them
// testable headless.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import {
  AtSign,
  Check,
  Copy,
  Eye,
  EyeOff,
  ListFilter,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { CATEGORY_PALETTE, toCommandError } from "./api";
import type {
  EntrySummary,
  EntryInput,
  Filters,
  CopyField,
  CategoryDto,
  UpdateCategoryRequest,
  UpdateCategoryResult,
  CommandError,
} from "./api";
import "./styles.css";

// ---------------------------------------------------------------------------
// Category ordering (vault-entries "Category selectors are ordered"): the
// modal and every selector show categories in deterministic alphabetical
// order — case-normalized primary key, exact name as the secondary key.
// ---------------------------------------------------------------------------

function sortCategories(categories: CategoryDto[]): CategoryDto[] {
  return [...categories].sort((a, b) => {
    const lowerA = a.name.toLowerCase();
    const lowerB = b.name.toLowerCase();
    if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return 0;
  });
}

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
  /** Category color from the repository map. Absent for unknown categories,
   *  so the card falls back to the CSS `--category-fallback` token. */
  color?: string;
  /** True while the card is animating out before deletion. */
  leaving?: boolean;
  /** True while this card is the origin of a card→modal morph (it shares the
   *  modal's view-transition name only while the morph is in flight). */
  morphOrigin?: boolean;
  /** Called when the card is activated (opens the details modal). */
  onOpen: () => void;
}

/** A card whose front shows only the site name; the category is carried by a
 *  colored top chip (`--category-color` drives the ink color, with a CSS
 *  fallback for unknown categories). Clicking opens the details modal. */
export function EntryCard({
  entry,
  color,
  leaving = false,
  morphOrigin = false,
  onOpen,
}: EntryCardProps) {
  return (
    <article
      className={`entry-card${leaving ? " leaving" : ""}${morphOrigin ? " morph-origin" : ""}`}
      style={color ? ({ "--category-color": color } as CSSProperties) : undefined}
      data-testid="entry-card"
      data-category={entry.category}
    >
      <button
        type="button"
        className="card-open"
        aria-label={`Ver detalles de ${entry.site}`}
        onClick={() => onOpen()}
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
  /** Repository categories; rendered alphabetically (ties by exact name). */
  categories: CategoryDto[];
  onChange: (category: string) => void;
}

/** The entry sheet's category picker. A native <select> opens its options
 *  with the OS theme (white in WebKit/GTK) no matter the CSS, so the modal
 *  uses the same themed listbox pattern as the vault filters. */
export function CategorySelect({ value, categories, onChange }: CategorySelectProps) {
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

  const options = sortCategories(categories);

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
          {options.map((option) => (
            <button
              key={option.name}
              type="button"
              role="option"
              aria-selected={option.name === value}
              className={`filter-option${option.name === value ? " selected" : ""}`}
              onClick={() => {
                onChange(option.name);
                setOpen(false);
              }}
            >
              {option.name}
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
  /** Repository categories for the picker (alphabetical); a new entry
   *  defaults to the first one, an existing entry keeps its own value. */
  categories: CategoryDto[];
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
  categories,
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
  /** Repository categories for the filter dropdown (alphabetical). */
  categories: CategoryDto[];
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
export function SearchFilters({ filters, categories, emails, onChange }: SearchFiltersProps) {
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
        options={sortCategories(categories).map((category) => ({
          value: category.name,
          label: category.name,
        }))}
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
// Category administration modal (category-administration spec). Presentational:
// receives the repository map, the per-category entry counts and callbacks;
// never talks to the backend directly. The list is alphabetical, the trash is
// disabled for in-use and last categories with an explanatory tooltip, rename
// and delete are confirmed with the affected-entry count, and recolor applies
// directly (no confirmation).
// ---------------------------------------------------------------------------

/** Map a category command error to a Spanish inline message. "Locked" is
 *  deliberately absent: the App handles lock transitions itself. */
function categoryErrorMessage(error: CommandError): string {
  switch (error.kind) {
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
    default:
      return "Ocurrió un error inesperado.";
  }
}

/** Normalize a callback rejection into a typed [`CommandError`]. App handlers
 *  rethrow already-normalized errors, so a `{ kind }` payload passes through;
 *  anything else (raw Tauri shapes, test rejects) goes through
 *  [`toCommandError`]. */
function commandErrorFrom(raw: unknown): CommandError {
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as CommandError).kind === "string"
  ) {
    return raw as CommandError;
  }
  return toCommandError(raw);
}

/** The 24-swatch color picker shared by the new-category form and the row
 *  editor. Each swatch is a radio in a radiogroup so the selected color is
 *  announced and testable. */
function SwatchGrid({ value, onSelect }: { value: string; onSelect: (color: string) => void }) {
  return (
    <div className="swatch-grid" role="radiogroup" aria-label="Color de categoría">
      {CATEGORY_PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={`Color ${color}`}
          className={`swatch${color === value ? " selected" : ""}`}
          style={{ background: color }}
          onClick={() => onSelect(color)}
        />
      ))}
    </div>
  );
}

export interface CategoryAdminModalProps {
  open: boolean;
  /** Repository categories (backend-sorted; the modal re-sorts defensively). */
  categories: CategoryDto[];
  /** Number of entries referencing each category name, from the full
   *  unfiltered entry list — drives the in-use trash disable and the counts
   *  shown in the confirmation dialogs. */
  usage: Record<string, number>;
  onCreate: (category: CategoryDto) => Promise<void>;
  onUpdate: (request: UpdateCategoryRequest) => Promise<UpdateCategoryResult>;
  onDelete: (name: string) => Promise<void>;
  onClose: () => void;
}

interface RenamePending {
  old_name: string;
  new_name: string;
  color: string;
  affected_entries: number;
}

/** Category administration: create, rename (confirmed), recolor (instant) and
 *  delete (unused only, confirmed) against the repository map. */
export function CategoryAdminModal({
  open,
  categories,
  usage,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: CategoryAdminModalProps) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(CATEGORY_PALETTE[0]);
  const [newError, setNewError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<string>(CATEGORY_PALETTE[0]);
  const [editError, setEditError] = useState<string | null>(null);
  const [renameConfirm, setRenameConfirm] = useState<RenamePending | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fresh state every time the modal opens: no stale drafts, errors or
  // pending confirmations leak between sessions.
  useEffect(() => {
    if (!open) return;
    setNewName("");
    setNewColor(CATEGORY_PALETTE[0]);
    setNewError(null);
    setEditingName(null);
    setDraftName("");
    setDraftColor("");
    setEditError(null);
    setRenameConfirm(null);
    setDeleteConfirm(null);
    setActionError(null);
  }, [open]);

  if (!open) return null;

  /** Why the trash of this category is disabled, or null when deletable:
   *  in-use categories and the last remaining category cannot be removed
   *  (the backend enforces both; the UI prevents the action first). */
  function deleteBlockReason(name: string): string | null {
    const count = usage[name] ?? 0;
    if (count > 0) {
      return count === 1
        ? "1 entrada sigue usando esta categoría."
        : `${count} entradas siguen usando esta categoría.`;
    }
    if (categories.length <= 1) return "Debe quedar al menos una categoría.";
    return null;
  }

  function startEdit(category: CategoryDto) {
    setEditingName(category.name);
    setDraftName(category.name);
    setDraftColor(category.color);
    setEditError(null);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (name === "") {
      setNewError("El nombre de la categoría no puede estar vacío.");
      return;
    }
    if (categories.some((category) => category.name === name)) {
      setNewError("Ya existe una categoría con ese nombre.");
      return;
    }
    setNewError(null);
    try {
      await onCreate({ name, color: newColor });
      setNewName("");
      setNewColor(CATEGORY_PALETTE[0]);
    } catch (raw) {
      const commandError = commandErrorFrom(raw);
      if (commandError.kind !== "Locked") setNewError(categoryErrorMessage(commandError));
    }
  }

  /** Commit the row being edited. Same-name saves are recolors and apply
   *  directly (confirmed, no dialog); renames go through the backend preview
   *  and only write after the user confirms the affected-entry count. */
  async function handleSaveEdit() {
    const oldName = editingName;
    if (oldName === null) return;
    const name = draftName.trim();
    if (name === "") {
      setEditError("El nombre de la categoría no puede estar vacío.");
      return;
    }
    if (name !== oldName && categories.some((category) => category.name === name)) {
      setEditError("Ya existe una categoría con ese nombre.");
      return;
    }
    setEditError(null);
    try {
      if (name === oldName) {
        await onUpdate({ old_name: oldName, new_name: oldName, color: draftColor, confirmed: true });
        setEditingName(null);
      } else {
        const result = await onUpdate({
          old_name: oldName,
          new_name: name,
          color: draftColor,
          confirmed: false,
        });
        if (result.status === "rename_preview") {
          setRenameConfirm({
            old_name: oldName,
            new_name: name,
            color: draftColor,
            affected_entries: result.affected_entries,
          });
        }
      }
    } catch (raw) {
      const commandError = commandErrorFrom(raw);
      if (commandError.kind !== "Locked") setEditError(categoryErrorMessage(commandError));
    }
  }

  async function confirmRename() {
    const pending = renameConfirm;
    if (!pending) return;
    setRenameConfirm(null);
    try {
      await onUpdate({
        old_name: pending.old_name,
        new_name: pending.new_name,
        color: pending.color,
        confirmed: true,
      });
      setEditingName(null);
    } catch (raw) {
      const commandError = commandErrorFrom(raw);
      if (commandError.kind !== "Locked") setEditError(categoryErrorMessage(commandError));
    }
  }

  async function confirmDelete() {
    if (deleteConfirm === null) return;
    const name = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await onDelete(name);
    } catch (raw) {
      const commandError = commandErrorFrom(raw);
      if (commandError.kind !== "Locked") setActionError(categoryErrorMessage(commandError));
    }
  }

  const sorted = sortCategories(categories);

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal category-admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Administrar categorías"
      >
        <div className="details-head">
          <h2>Administrar categorías</h2>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {actionError && (
          <p className="field-error" role="alert">
            {actionError}
          </p>
        )}

        <h3 className="category-new-title">Nueva categoría</h3>
        <form className="category-new-form" onSubmit={(event) => void handleCreate(event)}>
          <div className="category-new-head">
            <input
              type="text"
              className="category-name-input"
              placeholder="Nombre de la nueva categoría"
              aria-label="Nombre de la nueva categoría"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" className="action-button primary">
              Agregar
            </button>
          </div>
          <SwatchGrid value={newColor} onSelect={setNewColor} />
          {newError && (
            <p className="field-error" role="alert">
              {newError}
            </p>
          )}
        </form>

        <ul className="category-list">
          {sorted.map((category) => {
            const editing = editingName === category.name;
            const blockReason = deleteBlockReason(category.name);
            const trash = (
              <button
                type="button"
                className="icon-button danger"
                aria-label={`Eliminar ${category.name}`}
                disabled={blockReason !== null}
                onClick={() => setDeleteConfirm(category.name)}
              >
                <Trash2 size={15} />
              </button>
            );
            return (
              <li key={category.name} className="category-row" data-category={category.name}>
                {editing ? (
                  <div className="category-edit">
                    <div className="category-edit-head">
                      <span
                        className="category-dot"
                        style={{ background: draftColor }}
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        className="category-name-input"
                        aria-label={`Nombre de ${category.name}`}
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                      <span className="category-row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Guardar nombre"
                          onClick={() => void handleSaveEdit()}
                        >
                          <Check size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Cancelar edición"
                          onClick={() => setEditingName(null)}
                        >
                          <X size={15} />
                        </button>
                      </span>
                    </div>
                    {editError && (
                      <p className="field-error" role="alert">
                        {editError}
                      </p>
                    )}
                    <SwatchGrid value={draftColor} onSelect={setDraftColor} />
                  </div>
                ) : (
                  <div className="category-row-main">
                    <span
                      className="category-dot"
                      style={{ background: category.color }}
                      aria-hidden="true"
                    />
                    <span className="category-row-name">{category.name}</span>
                    {(usage[category.name] ?? 0) > 0 && (
                      <span className="category-count">
                        {usage[category.name]} {usage[category.name] === 1 ? "entrada" : "entradas"}
                      </span>
                    )}
                    <span className="category-row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Editar ${category.name}`}
                        onClick={() => startEdit(category)}
                      >
                        <Pencil size={15} />
                      </button>
                      {blockReason !== null ? (
                        <span className="tooltip-wrap" data-tooltip={blockReason}>
                          {trash}
                        </span>
                      ) : (
                        trash
                      )}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {renameConfirm !== null && (
          <div className="modal-overlay" role="presentation">
            <div
              className="modal"
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirmar cambio de nombre"
            >
              <h2>Renombrar categoría</h2>
              <p>
                ¿Renombrar «{renameConfirm.old_name}» a «{renameConfirm.new_name}»?
              </p>
              <p>
                {renameConfirm.affected_entries === 1
                  ? "1 entrada se actualizará."
                  : `${renameConfirm.affected_entries} entradas se actualizarán.`}
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="action-button primary"
                  onClick={() => void confirmRename()}
                >
                  Renombrar
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={() => setRenameConfirm(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteConfirm !== null && (
          <div className="modal-overlay" role="presentation">
            <div
              className="modal"
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirmar eliminación de categoría"
            >
              <h2>Eliminar categoría</h2>
              <p>¿Eliminar la categoría «{deleteConfirm}»?</p>
              <p>
                {usage[deleteConfirm] ?? 0} entradas asociadas. Esta acción no se puede deshacer.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="action-button danger"
                  onClick={() => void confirmDelete()}
                >
                  Eliminar
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={() => setDeleteConfirm(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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