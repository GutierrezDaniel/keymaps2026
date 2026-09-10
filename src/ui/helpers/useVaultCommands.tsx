// Command orchestration for the vault App (vault-ui / vault-backup /
// vault-import / category-administration specs). `useVaultCommands` owns no
// state and performs no IPC of its own beyond the typed `./api` client: App
// keeps every useState/useRef and injects the setters and refs this hook
// needs. The shared behavior helpers it relies on — Spanish error mapping
// (`./spanishMessages`) and view-transition wrappers (`./viewTransitions`) —
// are imported directly from helpers/ (Phase 3). Each returned handler is
// equivalent to the inline App handler it replaces — same normalized error
// handling, same async sequencing, same Spanish strings and same transition
// calls.
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { api, toCommandError } from "../api";
import { TOAST_DURATION_MS } from "../components/Toast";
import { spanishMessage } from "./spanishMessages";
import { supportsViewTransitions, withViewTransition } from "./viewTransitions";
import type {
  EntrySummary,
  EntryDetails,
  EntryInput,
  Filters,
  CopyField,
  CategoryDto,
  UpdateCategoryRequest,
  UpdateCategoryResult,
} from "../api";

/** Vault screen phases — owned by App, typed here so the command handlers
 *  that transition between phases share the union. */
export type Phase = "booting" | "create" | "locked" | "unlocked";

export interface UseVaultCommandsDeps {
  /** Current state values the command sequencing reads. */
  importConfirm: { path: string } | null;
  details: Record<string, EntryDetails>;
  deleting: EntrySummary | null;
  /** State setters (App owns all state). */
  setPhase: Dispatch<SetStateAction<Phase>>;
  setEntries: Dispatch<SetStateAction<EntrySummary[]>>;
  setEmails: Dispatch<SetStateAction<string[]>>;
  setCategories: Dispatch<SetStateAction<CategoryDto[]>>;
  setUsage: Dispatch<SetStateAction<Record<string, number>>>;
  setAdminOpen: Dispatch<SetStateAction<boolean>>;
  setDetails: Dispatch<SetStateAction<Record<string, EntryDetails>>>;
  setLeavingId: Dispatch<SetStateAction<string | null>>;
  setEditing: Dispatch<SetStateAction<EntrySummary | null>>;
  setDeleting: Dispatch<SetStateAction<EntrySummary | null>>;
  setImportConfirm: Dispatch<SetStateAction<{ path: string } | null>>;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
  setMorphOriginId: Dispatch<SetStateAction<string | null>>;
  setMorphActive: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setBackoff: Dispatch<SetStateAction<number | null>>;
  setToast: Dispatch<
    SetStateAction<{ kind: "success" | "error"; message: string } | null>
  >;
  /** Mutable refs (App owns them). */
  filtersRef: MutableRefObject<Filters>;
  editingRef: MutableRefObject<EntrySummary | null>;
  toastTimerRef: MutableRefObject<number | null>;
}

export interface UseVaultCommandsResult {
  loadEmails: () => Promise<void>;
  loadCategories: () => Promise<void>;
  applyList: (filters: Filters) => Promise<void>;
  closeDetailsModal: () => void;
  handleCreated: (password: string) => Promise<void>;
  handleUnlock: (password: string) => Promise<void>;
  handleLock: () => Promise<void>;
  handleExport: () => Promise<void>;
  handleImportSelect: () => Promise<void>;
  handleImportConfirm: () => Promise<void>;
  openEditEntry: (entry: EntrySummary) => Promise<void>;
  handleCopy: (id: string, field: CopyField) => Promise<void>;
  handleSave: (input: EntryInput) => Promise<void>;
  handleConfirmDelete: () => Promise<void>;
  handleCreateCategory: (category: CategoryDto) => Promise<void>;
  handleUpdateCategory: (request: UpdateCategoryRequest) => Promise<UpdateCategoryResult>;
  handleDeleteCategory: (name: string) => Promise<void>;
}

export function useVaultCommands(deps: UseVaultCommandsDeps): UseVaultCommandsResult {
  const {
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
  } = deps;

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

  /** A failed command either locked the session (lock the screen) or routes
   *  its Spanish message to the given error sink. */
  function onCommandFailure(raw: unknown, onError: (message: string) => void) {
    const commandError = toCommandError(raw);
    if (commandError.kind === "Locked") {
      lockScreen();
    } else {
      onError(spanishMessage(commandError));
    }
  }

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
      onCommandFailure(raw, setError);
    }
  }

  /** Refresh the email selector options from the repository. The complete
   *  distinct set must come from the backend: the loaded entry list can be
   *  shrunk by an active filter, so deriving emails from it would be partial. */
  async function loadEmails(): Promise<void> {
    try {
      setEmails(await api.listEmails());
    } catch (raw) {
      onCommandFailure(raw, setError);
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
      onCommandFailure(raw, setError);
    }
  }

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
        // Dead defensively: toCommandError always yields a numeric seconds.
        /* v8 ignore next -- @preserve */
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
      onCommandFailure(raw, (message) => showToast("error", message));
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
      onCommandFailure(raw, (message) => showToast("error", message));
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
      onCommandFailure(raw, (message) => showToast("error", message));
    }
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
      onCommandFailure(raw, setError);
    }
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
      onCommandFailure(raw, setError);
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

  return {
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
  };
}
