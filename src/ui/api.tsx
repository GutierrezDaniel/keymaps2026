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

// ---------------------------------------------------------------------------
// Domain types (design "Interfaces / Contracts").
// ---------------------------------------------------------------------------

const CATEGORIES = ["entretenimiento", "trabajo", "estudio", "servicios"] as const;

type Category = (typeof CATEGORIES)[number];

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
  | "NotFound"
  | "InvalidField"
  | "Crypto"
  | "Store"
  | "Clipboard"
  | "Backup"
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
  NotFound: "NotFound",
  InvalidField: "InvalidField",
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

  /** Export the vault to `path` in its native encrypted format. */
  async export(path: string): Promise<void> {
    await invoke("export", { path });
  },

  /** Copy an entry field to the clipboard (20s conditional clear in Rust). */
  async copyField(id: string, field: CopyField): Promise<void> {
    await invoke("copy_field", { id, field });
  },

  /** Report user activity; resets the Rust inactivity clock. */
  async recordActivity(): Promise<void> {
    await invoke("record_activity");
  },
};

export { api, toCommandError, CATEGORIES };
export type { Category, EntrySummary, EntryDetails, EntryInput, Filters, CopyField, CommandError };