// Application shell: the Spanish login, vault-creation and locked screens plus
// the unlocked vault view (vault-ui spec).
//
// Screen state machine:
//   booting → create | locked | unlocked
//   create → locked (create_vault does NOT auto-unlock — PR 3 contract)
//   locked → unlocked (unlock) | create (VaultNotInitialized)
//   unlocked → locked (explicit lock, or any command rejecting "Locked", which
//   is how the Rust 5-minute auto-lock surfaces to the UI).
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Download, Lock, Plus, Tags, Upload } from "lucide-react";
import { api, toCommandError } from "./api";
import type {
  EntrySummary,
  EntryDetails,
  EntryInput,
  Filters,
  CopyField,
  CommandError,
  CategoryDto,
  UpdateCategoryRequest,
  UpdateCategoryResult,
} from "./api";
import {
  BackoffNotice,
  CategoryAdminModal,
  DeleteConfirm,
  EntryCard,
  EntryModal,
  ImportConfirmModal,
  SearchFilters,
  Toast,
} from "./components";
import { TOAST_DURATION_MS } from "./components";

type Phase = "booting" | "create" | "locked" | "unlocked";

/** View Transitions API, feature-detected. WebKitGTK versions used by Tauri
 *  on Linux may lack it; every call degrades to the plain CSS fallback. */
function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && "startViewTransition" in document;
}

/** A minimal structural type for the View Transitions API surface we use. */
interface ViewTransition {
  finished: Promise<void>;
}

/** Wrap a state commit in a same-document view transition when the runtime
 *  supports it; otherwise run the commit directly. The `phase` marker adds the
 *  sheet fold/rise choreography (unlock/lock); modal morphs pass no marker.
 *  An async commit is awaited by the transition before the "after" snapshot,
 *  so phases that load data (unlock → vault) fold after the new page exists. */
function withViewTransition(commit: () => void | Promise<void>, phase = false): void {
  if (!supportsViewTransitions()) {
    void commit();
    return;
  }
  const root = document.documentElement;
  if (phase) root.classList.add("phase-transition");
  const transition = (document as Document & {
    startViewTransition: (callback: () => void | Promise<void>) => ViewTransition;
  }).startViewTransition(commit);
  void transition.finished.finally(() => {
    if (phase) root.classList.remove("phase-transition");
  });
}

/** Map a typed command error to a Spanish user-facing message. */
function spanishMessage(error: CommandError): string {
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

// ---------------------------------------------------------------------------
// Create screen — irreversible-loss warning before master-password
// confirmation (vault-ui "Vault creation warning").
// ---------------------------------------------------------------------------

interface CreateScreenProps {
  error: string | null;
  onCreated: (password: string) => void;
}

function CreateScreen({ error, onCreated }: CreateScreenProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password === "") {
      setLocalError("La contraseña maestra es obligatoria.");
      return;
    }
    if (password !== confirmation) {
      setLocalError("Las contraseñas no coinciden.");
      return;
    }
    setLocalError(null);
    onCreated(password);
  }

  return (
    <div className="screen">
      <h2>Crear bóveda</h2>
      <p className="warning" role="alert">
        <strong>Advertencia: pérdida irreversible</strong>
        Si pierdes la contraseña maestra, no hay forma de recuperar la bóveda. Esta acción es
        irreversible y no existe ningún mecanismo de recuperación.
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="new-master-password">
          Nueva contraseña maestra
          <input
            id="new-master-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label htmlFor="confirm-master-password">
          Confirmar contraseña maestra
          <input
            id="confirm-master-password"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {(localError ?? error) && (
          <p className="field-error" role="alert">
            {localError ?? error}
          </p>
        )}
        <button type="submit" className="primary-button">
          Crear bóveda
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Locked screen — login with the irreversible-loss warning (vault-ui "Locked-
// state warning") placed as a quiet note below the password input, and the
// backoff countdown (vault-session "Bounded login").
// ---------------------------------------------------------------------------

interface LoginScreenProps {
  error: string | null;
  notice: string | null;
  backoff: number | null;
  onExpireBackoff: () => void;
  onUnlock: (password: string) => void;
}

function LoginScreen({ error, notice, backoff, onExpireBackoff, onUnlock }: LoginScreenProps) {
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onUnlock(password);
  }

  return (
    <div className="screen">
      <h2>Desbloquear bóveda</h2>
      <form onSubmit={handleSubmit}>
        <label htmlFor="master-password">
          Contraseña maestra
          <input
            id="master-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="notice">{notice}</p>}
        {backoff !== null && (
          <BackoffNotice seconds={backoff} onExpire={onExpireBackoff} />
        )}
        <button type="submit" className="primary-button" disabled={backoff !== null}>
          Desbloquear
        </button>
      </form>
      <p className="warning quiet" role="alert">
        <strong>Advertencia: pérdida irreversible</strong>
        Si olvidas la contraseña maestra, perderás el acceso a la bóveda de forma permanente.
        No existe ningún mecanismo de recuperación.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [phase, setPhase] = useState<Phase>("booting");
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [emails, setEmails] = useState<string[]>([]);
  /** Repository categories (deterministic alphabetical order from the
   *  backend); drives the admin modal, entry-form selectors, filters and the
   *  card color map. */
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  /** Number of entries referencing each category, computed from a full
   *  unfiltered entry snapshot — never from the filtered display list, which
   *  an active filter can shrink to a subset. */
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [adminOpen, setAdminOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const [details, setDetails] = useState<Record<string, EntryDetails>>({});
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EntrySummary | null>(null);
  const [deleting, setDeleting] = useState<EntrySummary | null>(null);
  /** Pending validated import awaiting explicit replacement confirmation:
   *  the selected backup path (vault-import "Validate before replacement"). */
  const [importConfirm, setImportConfirm] = useState<{ path: string } | null>(null);
  /** Transient backup feedback (user correction, post-verify): a single
   *  toast at a time, auto-cleared by one timer so a new toast replaces an
   *  old one without a stale timer firing later. */
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );
  const toastTimerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backoff, setBackoff] = useState<number | null>(null);
  /** Id of the card serving as the morph origin for the details modal. While
   *  set, that card shares the modal's view-transition name so the browser
   *  morphs card → modal (and back) instead of cross-fading. */
  const [morphOriginId, setMorphOriginId] = useState<string | null>(null);
  /** True while the details modal is morphing (View Transitions active), so
   *  the sheet suppresses its CSS flip-in and lets the transition own motion. */
  const [morphActive, setMorphActive] = useState(false);

  const filtersRef = useRef<Filters>({});
  const editingRef = useRef<EntrySummary | null>(null);

  /** Clear everything secret-bearing and return to the locked screen. */
  function lockScreen() {
    setPhase("locked");
    setEntries([]);
    setEmails([]);
    setCategories([]);
    setUsage({});
    setAdminOpen(false);
    setDetails({});
    setLeavingId(null);
    setEditing(null);
    setDeleting(null);
    setImportConfirm(null);
    setFormOpen(false);
    setMorphOriginId(null);
    setMorphActive(false);
    setNotice(null);
  }

  /** Show a transient toast (user correction, post-verify). A single
   *  auto-clear timer guarantees the previous toast's timer is cleared when
   *  a new toast replaces an old one. */
  function showToast(kind: "success" | "error", message: string) {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ kind, message });
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, TOAST_DURATION_MS);
  }

  /** Clear the pending toast timer on unmount so it never fires into a
   *  detached tree. */
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  /** Refresh the category map and its per-category entry counts. Categories
   *  and usage only change through the administration modal or entry saves,
   *  so this runs after unlock, after entry saves/deletes and after every
   *  category mutation — never on plain list refreshes. The usage snapshot
   *  comes from the unfiltered entry list so counts stay exact under any
   *  active filter. */
  async function loadCategories(): Promise<void> {
    try {
      const [categoryList, allEntries] = await Promise.all([
        api.listCategories(),
        api.list(null),
      ]);
      setCategories(categoryList);
      const next: Record<string, number> = {};
      for (const category of categoryList) next[category.name] = 0;
      for (const entry of allEntries) {
        next[entry.category] = (next[entry.category] ?? 0) + 1;
      }
      setUsage(next);
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else {
        setError(spanishMessage(commandError));
      }
    }
  }

  /** Refresh the email selector options from the repository. The complete
   *  distinct set must come from the backend: the loaded entry list can be
   *  shrunk by an active filter, so deriving emails from it would be partial. */
  async function loadEmails(): Promise<void> {
    try {
      setEmails(await api.listEmails());
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else {
        setError(spanishMessage(commandError));
      }
    }
  }

  /** Refresh the entry list with the given filters. */
  async function applyList(f: Filters): Promise<void> {
    try {
      const list = await api.list(f);
      setEntries(list);
      setDetails({});
      setLeavingId(null);
      setPhase("unlocked");
      void loadEmails();
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else {
        setError(spanishMessage(commandError));
      }
    }
  }

  // Boot: determine the initial screen. A fresh vault reports "Locked" from
  // list (no session); unlock then reveals VaultNotInitialized → create.
  useEffect(() => {
    let cancelled = false;
    api
      .list(null)
      .then(async (list) => {
        if (cancelled) return;
        setEntries(list);
        setPhase("unlocked");
        void loadEmails();
        void loadCategories();
      })
      .catch((raw) => {
        if (cancelled) return;
        const commandError = toCommandError(raw);
        if (commandError.kind === "Locked") {
          setPhase("locked");
        } else {
          setError(spanishMessage(commandError));
          setPhase("locked");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreated(password: string) {
    setError(null);
    try {
      await api.createVault(password);
      setNotice("Bóveda creada correctamente. Ahora inicia sesión.");
      setBackoff(null);
      setPhase("locked");
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked" || commandError.kind === "AlreadyInitialized") {
        lockScreen();
      } else {
        setError(spanishMessage(commandError));
      }
    }
  }

  async function handleUnlock(password: string) {
    setError(null);
    setBackoff(null);
    try {
      await api.unlock(password);
      setNotice(null);
      // Breaking the seal: the locked sheet folds away and the vault rises.
      withViewTransition(() => applyList(filtersRef.current), true);
      void loadCategories();
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Backoff") {
        setBackoff(commandError.seconds ?? 0);
      } else if (commandError.kind === "AuthenticationFailed") {
        setError("Contraseña incorrecta.");
      } else if (commandError.kind === "VaultNotInitialized") {
        setNotice(null);
        setPhase("create");
      } else if (commandError.kind === "Locked") {
        lockScreen();
      } else {
        setError(spanishMessage(commandError));
      }
    }
  }

  async function handleLock() {
    setError(null);
    try {
      await api.lock();
    } catch {
      // Locking is best-effort; the screen still locks.
    }
    // The sheet folds back to the locked page like closing the codebook.
    withViewTransition(() => lockScreen(), true);
  }

  // -----------------------------------------------------------------------
  // Vault backup actions (vault-backup / vault-import specs). Only the
  // unlocked header offers them; dialogs are native and the commands receive
  // paths only (design "Dialog boundary").
  // -----------------------------------------------------------------------

  /** Native save dialog → encrypted export. A cancelled dialog is silent
   *  (the selection is null); success shows a success toast, failure an
   *  error toast (vault-backup "Safe export availability"). */
  async function handleExport() {
    setError(null);
    try {
      const path = await api.chooseExportPath();
      if (path === null) return; // cancelled: no feedback
      await api.export(path);
      showToast("success", "Respaldo exportado correctamente.");
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else {
        showToast("error", spanishMessage(commandError));
      }
    }
  }

  /** Native open dialog → preview validation (`confirmed === false`, no
   *  write). A cancelled dialog is silent; a validated initialized backup
   *  opens the replacement confirmation, any failure shows an error toast
   *  and leaves the current vault untouched (vault-import "Validate before
   *  replacement"). */
  async function handleImportSelect() {
    setError(null);
    try {
      const path = await api.chooseImportPath();
      if (path === null) return; // cancelled: no feedback
      const result = await api.importVault(path, false);
      if (result.status === "confirmation_required") {
        setImportConfirm({ path });
      }
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else {
        showToast("error", spanishMessage(commandError));
      }
    }
  }

  /** Confirmed import (`confirmed === true`, atomic replacement). On
   *  `applied` the backend already relocked and zeroized the prior session
   *  (vault-import "Relock and reauthenticate after import"), so the UI
   *  returns to login — where a success toast announces the imported vault's
   *  master password is required. Any failure keeps the current vault
   *  active. */
  async function handleImportConfirm() {
    const pending = importConfirm;
    if (!pending) return;
    setImportConfirm(null);
    setError(null);
    try {
      const result = await api.importVault(pending.path, true);
      if (result.status === "applied") {
        lockScreen();
        showToast(
          "success",
          "Bóveda reemplazada correctamente. Inicia sesión con la contraseña maestra del respaldo importado.",
        );
      }
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else {
        showToast("error", spanishMessage(commandError));
      }
    }
  }

  function handleFiltersChange(next: Filters) {
    filtersRef.current = next;
    setFilters(next);
    void applyList(next);
  }

  /** Open the unified entry modal for an existing entry, fetching the
   *  decrypted details (password prefill) on the first open. The sheet
   *  always enters with its standard flip-in animation, matching the
   *  new-entry modal; the card only participates in the reverse morph
   *  when the modal closes back into it. */
  async function openEditEntry(entry: EntrySummary) {
    setError(null);
    if (!details[entry.id]) {
      try {
        const entryDetails = await api.getEntryDetails(entry.id);
        setDetails((previous) => ({ ...previous, [entry.id]: entryDetails }));
      } catch (raw) {
        const commandError = toCommandError(raw);
        if (commandError.kind === "Locked") {
          lockScreen();
          return;
        }
        setError(spanishMessage(commandError));
        return;
      }
    }
    setMorphOriginId(null);
    setMorphActive(false);
    setEditing(entry);
    editingRef.current = entry;
    setFormOpen(true);
  }

  async function handleCopy(id: string, field: CopyField) {
    setError(null);
    try {
      await api.copyField(id, field);
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else {
        setError(spanishMessage(commandError));
      }
    }
  }

  function openNewEntry() {
    setEditing(null);
    editingRef.current = null;
    setError(null);
    setMorphOriginId(null);
    setMorphActive(false);
    setFormOpen(true);
  }

  async function handleSave(input: EntryInput) {
    setError(null);
    try {
      const editingEntry = editingRef.current;
      if (editingEntry) {
        await api.update(editingEntry.id, input);
      } else {
        await api.create(input);
      }
      setFormOpen(false);
      setEditing(null);
      editingRef.current = null;
      await applyList(filtersRef.current);
      // The entry may have changed categories, so the usage counts refresh.
      void loadCategories();
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else {
        setError(spanishMessage(commandError));
      }
    }
  }

  async function handleConfirmDelete() {
    const entry = deleting;
    if (!entry) return;
    setError(null);
    setDeleting(null);
    setLeavingId(entry.id);
    // Let the leave animation play before the list refresh removes the card.
    await new Promise((resolve) => window.setTimeout(resolve, 320));
    try {
      await api.delete(entry.id);
      setLeavingId(null);
      closeDetailsModal();
      await applyList(filtersRef.current);
      void loadCategories();
    } catch (raw) {
      setLeavingId(null);
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else if (commandError.kind === "NotFound") {
        closeDetailsModal();
        await applyList(filtersRef.current);
      } else {
        setError(spanishMessage(commandError));
      }
    }
  }

  /** Close the details modal; the sheet morphs back into the card that opened
   *  it when a view transition is available, otherwise it closes directly.
   *  For the reverse morph, the modal already carries the shared name in the
   *  "from" snapshot; the commit hands that name to the card so the browser
   *  sees modal → card. */
  function closeDetailsModal() {
    const entry = editingRef.current;
    if (entry && supportsViewTransitions()) {
      withViewTransition(() => {
        setMorphOriginId(entry.id);
        setMorphActive(false);
        setFormOpen(false);
        setEditing(null);
        editingRef.current = null;
      });
    } else {
      setMorphActive(false);
      setFormOpen(false);
      setEditing(null);
      editingRef.current = null;
      setMorphOriginId(null);
    }
  }

  // -----------------------------------------------------------------------
  // Category administration (category-administration spec). The modal owns
  // validation and confirmation UX; these handlers translate its callbacks
  // into commands and rethrow normalized errors so the modal can show them
  // inline. "Locked" locks the screen and is never rethrown.
  // -----------------------------------------------------------------------

  async function handleCreateCategory(category: CategoryDto): Promise<void> {
    try {
      await api.createCategory(category);
      await loadCategories();
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
        return;
      }
      throw commandError;
    }
  }

  async function handleUpdateCategory(
    request: UpdateCategoryRequest,
  ): Promise<UpdateCategoryResult> {
    try {
      const result = await api.updateCategory(request);
      if (result.status === "applied") await loadCategories();
      return result;
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      }
      throw commandError;
    }
  }

  async function handleDeleteCategory(name: string): Promise<void> {
    try {
      await api.deleteCategory(name);
      await loadCategories();
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
        return;
      }
      throw commandError;
    }
  }

  if (phase === "booting") {
    return (
      <div className="app-shell">
        <h1 className="app-title">Administrador de Contraseñas</h1>
        <p>Cargando…</p>
      </div>
    );
  }

  if (phase === "create") {
    return (
      <div className="app-shell">
        <h1 className="app-title">Administrador de Contraseñas</h1>
        <CreateScreen error={error} onCreated={handleCreated} />
        {toast && (
          <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
        )}
      </div>
    );
  }

  if (phase === "locked") {
    return (
      <div className="app-shell">
        <h1 className="app-title">Administrador de Contraseñas</h1>
        <LoginScreen
          error={error}
          notice={notice}
          backoff={backoff}
          onExpireBackoff={() => setBackoff(null)}
          onUnlock={handleUnlock}
        />
        {/* The import-applied toast survives the relock and announces the
            imported vault's password is required again. */}
        {toast && (
          <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
        )}
      </div>
    );
  }

  const hasFilters = Boolean(filters.site || filters.category || filters.email);

  /** Color for an entry's category chip from the repository map; undefined
   *  for unknown categories, so the card renders the CSS fallback. */
  function categoryColor(name: string): string | undefined {
    return categories.find((category) => category.name === name)?.color;
  }

  return (
    <div className="app-shell">
      <header className="vault-header">
        <h1>Mi bóveda</h1>
        <div className="vault-actions">
          <button type="button" className="primary-button" onClick={openNewEntry}>
            <Plus size={16} aria-hidden="true" />
            Nueva entrada
          </button>
          <button type="button" className="action-button" onClick={() => void handleExport()}>
            <Download size={15} aria-hidden="true" />
            Exportar respaldo
          </button>
          <button type="button" className="action-button" onClick={() => void handleImportSelect()}>
            <Upload size={15} aria-hidden="true" />
            Importar respaldo
          </button>
          <button type="button" className="action-button" onClick={() => setAdminOpen(true)}>
            <Tags size={15} aria-hidden="true" />
            Administrar categorías
          </button>
          <button type="button" className="icon-button" aria-label="Bloquear" onClick={handleLock}>
            <Lock size={18} />
          </button>
        </div>
      </header>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      <SearchFilters
        filters={filters}
        categories={categories}
        emails={emails}
        onChange={handleFiltersChange}
      />

      {entries.length === 0 ? (
        <p className="empty-state">
          {hasFilters
            ? "No hay entradas que coincidan con la búsqueda."
            : "Aún no hay entradas. Usa «Nueva entrada» para agregar la primera."}
        </p>
      ) : (
        <div className="card-grid">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              color={categoryColor(entry.category)}
              leaving={leavingId === entry.id}
              morphOrigin={morphOriginId === entry.id}
              onOpen={() => void openEditEntry(entry)}
            />
          ))}
        </div>
      )}

      <EntryModal
        key={editing?.id ?? "new"}
        open={formOpen}
        initial={editing}
        categories={categories}
        initialPassword={editing ? (details[editing.id]?.password ?? "") : ""}
        morphing={morphActive}
        onSave={handleSave}
        onCancel={closeDetailsModal}
        onCopy={editing ? (field) => void handleCopy(editing.id, field) : undefined}
        onDelete={editing ? () => setDeleting(editing) : undefined}
      />

      {deleting && (
        <DeleteConfirm
          entry={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {importConfirm && (
        <ImportConfirmModal
          onConfirm={() => void handleImportConfirm()}
          onCancel={() => setImportConfirm(null)}
        />
      )}

      <CategoryAdminModal
        open={adminOpen}
        categories={categories}
        usage={usage}
        onCreate={handleCreateCategory}
        onUpdate={handleUpdateCategory}
        onDelete={handleDeleteCategory}
        onClose={() => setAdminOpen(false)}
      />

      {toast && (
        <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}