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
import { api, toCommandError } from "./api";
import type { EntrySummary, EntryDetails, EntryInput, Filters, CopyField, CommandError } from "./api";
import { BackoffNotice, DeleteConfirm, EntryCard, EntryFormModal, SearchFilters } from "./components";

type Phase = "booting" | "create" | "locked" | "unlocked";

/** Map a typed command error to a Spanish user-facing message. */
function spanishMessage(error: CommandError): string {
  switch (error.kind) {
    case "AuthenticationFailed":
      return "Contraseña incorrecta.";
    case "InvalidCategory":
      return "La categoría seleccionada no es válida.";
    case "NotFound":
      return "La entrada ya no existe.";
    case "InvalidField":
      return "Los datos enviados no son válidos.";
    case "Crypto":
    case "Store":
    case "Clipboard":
    case "Backup":
      return error.message ? `Ocurrió un error: ${error.message}` : "Ocurrió un error interno.";
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
// state warning") and the backoff countdown (vault-session "Bounded login").
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
      <p className="warning" role="alert">
        <strong>Advertencia: pérdida irreversible</strong>
        Si olvidas la contraseña maestra, perderás el acceso a la bóveda de forma permanente.
        No existe ningún mecanismo de recuperación.
      </p>
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
  const [filters, setFilters] = useState<Filters>({});
  const [details, setDetails] = useState<Record<string, EntryDetails>>({});
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EntrySummary | null>(null);
  const [deleting, setDeleting] = useState<EntrySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backoff, setBackoff] = useState<number | null>(null);

  const filtersRef = useRef<Filters>({});
  const editingRef = useRef<EntrySummary | null>(null);

  /** Clear everything secret-bearing and return to the locked screen. */
  function lockScreen() {
    setPhase("locked");
    setEntries([]);
    setEmails([]);
    setDetails({});
    setFlipped({});
    setEditing(null);
    setDeleting(null);
    setFormOpen(false);
    setNotice(null);
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
      setFlipped({});
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
      await applyList(filtersRef.current);
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
    lockScreen();
  }

  function handleFiltersChange(next: Filters) {
    filtersRef.current = next;
    setFilters(next);
    void applyList(next);
  }

  async function handleToggleFlip(id: string) {
    setFlipped((previous) => ({ ...previous, [id]: !previous[id] }));
    if (!details[id]) {
      try {
        const entryDetails = await api.getEntryDetails(id);
        setDetails((previous) => ({ ...previous, [id]: entryDetails }));
      } catch (raw) {
        const commandError = toCommandError(raw);
        if (commandError.kind === "Locked") {
          lockScreen();
        } else {
          setError(spanishMessage(commandError));
        }
      }
    }
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
    setFormOpen(true);
  }

  function openEditEntry(entry: EntrySummary) {
    setEditing(entry);
    editingRef.current = entry;
    setError(null);
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
    try {
      await api.delete(entry.id);
      setDeleting(null);
      await applyList(filtersRef.current);
    } catch (raw) {
      const commandError = toCommandError(raw);
      if (commandError.kind === "Locked") {
        lockScreen();
      } else if (commandError.kind === "NotFound") {
        setDeleting(null);
        await applyList(filtersRef.current);
      } else {
        setError(spanishMessage(commandError));
      }
    }
  }

  if (phase === "booting") {
    return (
      <div className="app-shell">
        <h1 className="app-title">Keymaps2026 — Administrador de Contraseñas</h1>
        <p>Cargando…</p>
      </div>
    );
  }

  if (phase === "create") {
    return (
      <div className="app-shell">
        <h1 className="app-title">Keymaps2026 — Administrador de Contraseñas</h1>
        <CreateScreen error={error} onCreated={handleCreated} />
      </div>
    );
  }

  if (phase === "locked") {
    return (
      <div className="app-shell">
        <h1 className="app-title">Keymaps2026 — Administrador de Contraseñas</h1>
        <LoginScreen
          error={error}
          notice={notice}
          backoff={backoff}
          onExpireBackoff={() => setBackoff(null)}
          onUnlock={handleUnlock}
        />
      </div>
    );
  }

  const hasFilters = Boolean(filters.site || filters.category || filters.email);

  return (
    <div className="app-shell">
      <header className="vault-header">
        <h1>Mi bóveda</h1>
        <div>
          <button type="button" className="primary-button" onClick={openNewEntry}>
            Nueva entrada
          </button>
          <button type="button" className="action-button" onClick={handleLock}>
            Bloquear
          </button>
        </div>
      </header>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}

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
              details={details[entry.id] ?? null}
              flipped={Boolean(flipped[entry.id])}
              onToggleFlip={() => void handleToggleFlip(entry.id)}
              onCopy={(field) => void handleCopy(entry.id, field)}
              onEdit={() => openEditEntry(entry)}
              onDelete={() => setDeleting(entry)}
            />
          ))}
        </div>
      )}

      <EntryFormModal
        key={editing?.id ?? "new"}
        open={formOpen}
        initial={editing}
        initialPassword={editing ? (details[editing.id]?.password ?? "") : ""}
        onSave={handleSave}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
          editingRef.current = null;
        }}
      />

      {deleting && (
        <DeleteConfirm
          entry={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}