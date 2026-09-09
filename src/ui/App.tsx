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
import { Lock, Plus, Tags } from "lucide-react";
import { api, toCommandError } from "./api";
import type { EntrySummary, EntryDetails, Filters, CategoryDto } from "./api";
import { CreateScreen } from "./components/CreateScreen";
import { LoginScreen } from "./components/LoginScreen";
import { BackupActionsMenu } from "./components/BackupActionsMenu";
import { CategoryAdminModal } from "./components/CategoryAdminModal";
import { DeleteConfirm } from "./components/DeleteConfirm";
import { EntryCard } from "./components/EntryCard";
import { EntryModal } from "./components/EntryModal";
import { ImportConfirmModal } from "./components/ImportConfirmModal";
import { SearchFilters } from "./components/SearchFilters";
import { Toast } from "./components/Toast";
import { CategoriesProvider } from "./contexts/CategoriesContext";
import { spanishMessage } from "./helpers/spanishMessages";
import { useVaultCommands } from "./helpers/useVaultCommands";
import type { Phase } from "./helpers/useVaultCommands";

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

  const {
    loadEmails,
    loadCategories,
    applyList,
    closeDetailsModal,
    handleCreated,
    handleUnlock,
    handleLock,
    handleExport,
    handleImportSelect,
    handleImportConfirm,
    openEditEntry,
    handleCopy,
    handleSave,
    handleConfirmDelete,
    handleCreateCategory,
    handleUpdateCategory,
    handleDeleteCategory,
  } = useVaultCommands({
    importConfirm,
    details,
    deleting,
    setPhase,
    setEntries,
    setEmails,
    setCategories,
    setUsage,
    setAdminOpen,
    setDetails,
    setLeavingId,
    setEditing,
    setDeleting,
    setImportConfirm,
    setFormOpen,
    setMorphOriginId,
    setMorphActive,
    setError,
    setNotice,
    setBackoff,
    setToast,
    filtersRef,
    editingRef,
    toastTimerRef,
  });

  /** Clear the pending toast timer on unmount so it never fires into a
   *  detached tree. */
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

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

  function openNewEntry() {
    setEditing(null);
    editingRef.current = null;
    setError(null);
    setMorphOriginId(null);
    setMorphActive(false);
    setFormOpen(true);
  }

  function handleFiltersChange(next: Filters) {
    filtersRef.current = next;
    setFilters(next);
    void applyList(next);
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

  return (
    <CategoriesProvider categories={categories} usage={usage}>
      <div className="app-shell">
        <header className="vault-header">
          <h1>Mi bóveda</h1>
          <div className="vault-actions">
            <button type="button" className="primary-button" onClick={openNewEntry}>
              <Plus size={16} aria-hidden="true" />
              Nueva entrada
            </button>
            <button type="button" className="action-button" onClick={() => setAdminOpen(true)}>
              <Tags size={15} aria-hidden="true" />
              Administrar categorías
            </button>
            <BackupActionsMenu
              onExport={() => void handleExport()}
              onImport={() => void handleImportSelect()}
            />
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

        <SearchFilters filters={filters} emails={emails} onChange={handleFiltersChange} />

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
          // Dead defensively: openEditEntry always fetches details before setEditing,
          // so details[editing.id] exists and its password is a string.
          /* v8 ignore next -- @preserve */
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
          onCreate={handleCreateCategory}
          onUpdate={handleUpdateCategory}
          onDelete={handleDeleteCategory}
          onClose={() => setAdminOpen(false)}
        />

        {toast && (
          <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
        )}
      </div>
    </CategoriesProvider>
  );
}