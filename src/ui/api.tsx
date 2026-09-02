// Typed Tauri IPC client for the vault commands.
//
// Mirrors the serde DTO shapes and command names in
// `src-tauri/src/adapters/tauri.rs` exactly (camelCase argument keys, snake_case
// DTO field names, snake_case `CopyField` variants). Every command maps 1:1 to a
// `#[tauri::command]`; the client never invents a command or a field.
//
// Command errors are rejected by Tauri with the serialized `CommandError` enum:
// unit variants arrive as strings ("Locked") and struct variants as externally
// tagged objects ({ Backoff: { seconds } }). `toCommandError` normalizes both
// shapes so the UI can branch on a typed kind instead of raw payloads.
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

// ---------------------------------------------------------------------------
// Domain types (design "Interfaces / Contracts").
// ---------------------------------------------------------------------------

/** Wire form of a category: a display name and one palette color —
 *  `CategoryDto` in tauri.rs. */
interface CategoryDto {
  name: string;
  color: string;
}

/** The exact 24 predefined swatches (design "Interfaces / Contracts"),
 *  mirrored from `CATEGORY_PALETTE` in entry.rs. The backend rejects colors
 *  outside this set; the swatch grid only ever offers these. */
const CATEGORY_PALETTE = [
  "#7a5220", "#2f5d8c", "#2f6b3f", "#6a4a8f", "#ad3a2d", "#c05640", "#b76e2b", "#d4a72c",
  "#86601f", "#5f7f35", "#4f8a6b", "#2f6b63", "#3b7d91", "#4a6fa5", "#6b5b95", "#8a4f7d",
  "#a34f67", "#9a5b4a", "#7c5a3c", "#596275", "#36454f", "#708090", "#8f9e9d", "#a67c52",
] as const;

/** Input for `update_category`: the old name, the target name/color, and
 *  whether the rename was confirmed — `UpdateCategoryRequest` in tauri.rs.
 *  Recolors (old == new) apply directly; unconfirmed renames return a preview
 *  and perform no write. */
interface UpdateCategoryRequest {
  old_name: string;
  new_name: string;
  color: string;
  confirmed: boolean;
}

/** Result of an update: either applied, or a rename awaiting confirmation with
 *  the number of entries the cascade would affect. Internally tagged enum in
 *  Rust (`tag = "status"`, snake_case): `{ status: "applied" }` or
 *  `{ status: "rename_preview", affected_entries }`. */
type UpdateCategoryResult =
  | { status: "applied" }
  | { status: "rename_preview"; affected_entries: number };

/** Result of `import_vault`: either the candidate validated and awaits
 *  explicit confirmation (no write), or the confirmed replacement was
 *  applied and the session relocked. Internally tagged enum in Rust
 *  (`tag = "status"`, snake_case): `{ status: "confirmation_required" }` or
 *  `{ status: "applied" }`. */
type ImportResult =
  | { status: "confirmation_required" }
  | { status: "applied" };

/** Metadata-only entry view (no secret material) — `EntrySummaryDto`. */
interface EntrySummary {
  id: string;
  site: string;
  link: string;
  email: string;
  username: string;
  category: string;
}

/** Full entry view; `password` is transient — `EntryDetailsDto`. */
interface EntryDetails {
  summary: EntrySummary;
  password: string;
}

/** Input for creating or updating an entry — `EntryInputDto`. */
interface EntryInput {
  site: string;
  link: string;
  password: string;
  email: string;
  username: string;
  category: string;
}

/** Search/filter criteria (all combine conjunctively) — `FilterDto`. */
interface Filters {
  site?: string | null;
  category?: string | null;
  email?: string | null;
}

/** Entry fields that may be copied — `CopyField` (snake_case on the wire). */
const COPY_FIELD = {
  PASSWORD: "password",
  LINK: "link",
  EMAIL: "email",
  USERNAME: "username",
} as const;

type CopyField = (typeof COPY_FIELD)[keyof typeof COPY_FIELD];

// ---------------------------------------------------------------------------
// Command errors (serialized `CommandError` from tauri.rs).
// ---------------------------------------------------------------------------

type CommandErrorKind =
  | "Locked"
  | "Backoff"
  | "AuthenticationFailed"
  | "VaultNotInitialized"
  | "AlreadyInitialized"
  | "InvalidCategory"
  | "BlankCategoryName"
  | "InvalidCategoryColor"
  | "DuplicateCategory"
  | "CategoryInUse"
  | "LastCategory"
  | "CategoryNotFound"
  | "NotFound"
  | "InvalidField"
  | "Crypto"
  | "Store"
  | "Clipboard"
  | "Backup"
  | "Import"
  | "Unknown";

interface CommandError {
  kind: CommandErrorKind;
  /** Present only when kind === "Backoff". */
  seconds?: number;
  /** Free-text detail for transport errors and unknown payloads. */
  message?: string;
}

const UNIT_VARIANTS: Record<string, CommandErrorKind> = {
  Locked: "Locked",
  AuthenticationFailed: "AuthenticationFailed",
  VaultNotInitialized: "VaultNotInitialized",
  AlreadyInitialized: "AlreadyInitialized",
  InvalidCategory: "InvalidCategory",
  BlankCategoryName: "BlankCategoryName",
  InvalidCategoryColor: "InvalidCategoryColor",
  DuplicateCategory: "DuplicateCategory",
  CategoryInUse: "CategoryInUse",
  LastCategory: "LastCategory",
  CategoryNotFound: "CategoryNotFound",
  NotFound: "NotFound",
  InvalidField: "InvalidField",
  Import: "Import",
};

const TAGGED_VARIANTS: Record<string, CommandErrorKind> = {
  Crypto: "Crypto",
  Store: "Store",
  Clipboard: "Clipboard",
  Backup: "Backup",
};

/** Normalize a Tauri rejection value into a typed [`CommandError`]. */
function toCommandError(reason: unknown): CommandError {
  if (typeof reason === "string") {
    const kind = UNIT_VARIANTS[reason];
    if (kind) return { kind };
    if (reason === "Backoff") return { kind: "Backoff", seconds: 0 };
    return { kind: "Unknown", message: reason };
  }
  if (typeof reason === "object" && reason !== null) {
    const payload = reason as Record<string, unknown>;
    if ("Backoff" in payload) {
      const backoff = payload.Backoff as { seconds?: unknown } | undefined;
      return {
        kind: "Backoff",
        seconds: typeof backoff?.seconds === "number" ? backoff.seconds : 0,
      };
    }
    for (const [tag, kind] of Object.entries(TAGGED_VARIANTS)) {
      if (tag in payload) {
        return { kind, message: String(payload[tag] ?? "") };
      }
    }
  }
  return { kind: "Unknown", message: String(reason) };
}

// ---------------------------------------------------------------------------
// The typed client.
// ---------------------------------------------------------------------------

function passwordRequest(masterPassword: string): { req: { master_password: string } } {
  return { req: { master_password: masterPassword } };
}

function filtersPayload(filters: Filters | null): { filters: Filters | null } {
  return { filters };
}

/** Default export filename (vault-backup "Native export dialog and default
 *  filename"): `clavemaestra-backup-YYYY-MM-DD-HHmm.db`, date plus time. */
function backupFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `clavemaestra-backup-${stamp}.db`;
}

const api = {
  /** Initialize a fresh vault. Does NOT unlock (the user then unlocks). */
  async createVault(masterPassword: string): Promise<void> {
    await invoke("create_vault", passwordRequest(masterPassword));
  },

  /** Unlock by authenticating the master password against the vault. */
  async unlock(masterPassword: string): Promise<void> {
    await invoke("unlock", passwordRequest(masterPassword));
  },

  /** Lock immediately; the Rust session zeroizes the derived key. */
  async lock(): Promise<void> {
    await invoke("lock");
  },

  /** List entry summaries, filtered conjunctively. Pass null for no filters. */
  async list(filters: Filters | null): Promise<EntrySummary[]> {
    return invoke<EntrySummary[]>("list", filtersPayload(filters));
  },

  /** List the distinct non-empty emails stored in the vault, ascending — the
   *  complete set for the email filter, independent of any active filter. */
  async listEmails(): Promise<string[]> {
    return invoke<string[]>("list_emails");
  },

  /** Fetch a full entry including the transient decrypted password. */
  async getEntryDetails(id: string): Promise<EntryDetails> {
    return invoke<EntryDetails>("get_entry_details", { id });
  },

  /** Create an entry; resolves with the new record id (hex string). */
  async create(input: EntryInput): Promise<string> {
    return invoke<string>("create", { input });
  },

  /** Update an existing entry by record id. */
  async update(id: string, input: EntryInput): Promise<void> {
    await invoke("update", { id, input });
  },

  /** Delete an entry by record id. */
  async delete(id: string): Promise<void> {
    await invoke("delete", { id });
  },

  /** Open the native save dialog with the timestamped default filename
   *  (design "Interfaces / Contracts"); resolves with the chosen destination
   *  or null when the user cancels. */
  async chooseExportPath(): Promise<string | null> {
    return save({
      title: "Exportar respaldo",
      defaultPath: backupFileName(),
      filters: [{ name: "Base de datos", extensions: ["db"] }],
    });
  },

  /** Open the native open dialog for a single backup file (design
   *  "Interfaces / Contracts"); resolves with the chosen path or null when
   *  the user cancels. */
  async chooseImportPath(): Promise<string | null> {
    return open({
      title: "Seleccionar respaldo",
      multiple: false,
      directory: false,
      filters: [{ name: "Base de datos", extensions: ["db"] }],
    });
  },

  /** Export the vault to `dest` in its native encrypted format —
   *  `export_vault`. The old synchronous `export` command was replaced by
   *  this async path-only command (Slice 2), so the wire uses `dest`. */
  async export(path: string): Promise<void> {
    await invoke("export_vault", { dest: path });
  },

  /** Validate (`confirmed === false`, preview, no write) or validate-and-
   *  replace (`confirmed === true`) the vault from `path` — `import_vault`.
   *  Resolves the tagged result; `applied` means the backend relocked and
   *  invalidated the prior session. */
  async importVault(path: string, confirmed: boolean): Promise<ImportResult> {
    return invoke<ImportResult>("import_vault", { path, confirmed });
  },

  /** Copy an entry field to the clipboard (20s conditional clear in Rust). */
  async copyField(id: string, field: CopyField): Promise<void> {
    await invoke("copy_field", { id, field });
  },

  /** Report user activity; resets the Rust inactivity clock. */
  async recordActivity(): Promise<void> {
    await invoke("record_activity");
  },

  /** List the repository categories in deterministic alphabetical order
   *  (case-normalized name, exact-name tie-break) — `list_categories`. */
  async listCategories(): Promise<CategoryDto[]> {
    return invoke<CategoryDto[]>("list_categories");
  },

  /** Create a category with a non-blank name and a palette color —
   *  `create_category`. */
  async createCategory(category: CategoryDto): Promise<void> {
    await invoke("create_category", { input: category });
  },

  /** Update a category. Recolor (old == new) applies directly; an unconfirmed
   *  rename returns a preview with the affected entry count and writes
   *  nothing — `update_category`. */
  async updateCategory(request: UpdateCategoryRequest): Promise<UpdateCategoryResult> {
    return invoke<UpdateCategoryResult>("update_category", { request });
  },

  /** Delete an unused category; the service refuses in-use and last
   *  categories — `delete_category`. */
  async deleteCategory(name: string): Promise<void> {
    await invoke("delete_category", { name });
  },
};

export { api, toCommandError, CATEGORY_PALETTE };
export type {
  CategoryDto,
  UpdateCategoryRequest,
  UpdateCategoryResult,
  ImportResult,
  EntrySummary,
  EntryDetails,
  EntryInput,
  Filters,
  CopyField,
  CommandError,
};