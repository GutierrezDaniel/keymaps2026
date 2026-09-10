// useVaultCommands tests: the command-orchestration hook (design decision 3)
// owns no state and performs no IPC beyond the typed api client, so renderHook
// drives every handler directly against mocked invoke/dialog modules. Each
// handler's success path, "Locked" (relock) path and generic-error path is
// asserted, plus the defensive guards and the view-transition morph close.
// App keeps its own integration coverage for the same flows (App.test.tsx);
// this file closes the hook's direct branch matrix.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useVaultCommands } from "./useVaultCommands";
import type { UseVaultCommandsDeps } from "./useVaultCommands";
import type { EntrySummary, EntryDetails, CategoryDto } from "../api";
import { TOAST_DURATION_MS } from "../components/Toast";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);
const mockedOpen = vi.mocked(open);

const ENTRY: EntrySummary = {
  id: "id-1",
  site: "GitHub",
  link: "https://github.com",
  email: "ana@example.com",
  username: "ana",
  category: "trabajo",
};

const DETAILS: EntryDetails = { summary: ENTRY, password: "s3cr3t" };

const CATEGORIES: CategoryDto[] = [
  { name: "entretenimiento", color: "#7a5220" },
  { name: "trabajo", color: "#2f5d8c" },
];

/** All-setters mock deps; per-test overrides replace the values/refs under
 *  test. The three refs are plain objects, matching what App's useRef
 *  returns for the hook's MutableRefObject contract. */
function makeDeps(overrides: Partial<UseVaultCommandsDeps> = {}): UseVaultCommandsDeps {
  return {
    importConfirm: null,
    details: {},
    deleting: null,
    setPhase: vi.fn(),
    setEntries: vi.fn(),
    setEmails: vi.fn(),
    setCategories: vi.fn(),
    setUsage: vi.fn(),
    setAdminOpen: vi.fn(),
    setDetails: vi.fn(),
    setLeavingId: vi.fn(),
    setEditing: vi.fn(),
    setDeleting: vi.fn(),
    setImportConfirm: vi.fn(),
    setFormOpen: vi.fn(),
    setMorphOriginId: vi.fn(),
    setMorphActive: vi.fn(),
    setError: vi.fn(),
    setNotice: vi.fn(),
    setBackoff: vi.fn(),
    setToast: vi.fn(),
    filtersRef: { current: {} },
    editingRef: { current: null },
    toastTimerRef: { current: null },
    ...overrides,
  };
}

function mount(deps: UseVaultCommandsDeps) {
  const { result } = renderHook(() => useVaultCommands(deps));
  return result.current;
}

/** Route mocked invoke by command name; handlers throw to reject. An
 *  unlisted list_emails resolves to [] (the hook loads it on every refresh). */
function mockRoutes(routes: Record<string, (args?: unknown) => unknown>) {
  mockedInvoke.mockImplementation((command: string, args?: unknown) => {
    const handler =
      routes[command] ?? (command === "list_emails" ? () => [] : undefined);
    if (!handler) return Promise.reject(new Error(`No mock registered for ${command}`));
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

/** Drain pending microtask promise chains (fire-and-forget refreshes). */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedSave.mockReset();
  mockedOpen.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
});

describe("useVaultCommands — loadEmails / loadCategories / applyList", () => {
  it("loadEmails stores the distinct email set", async () => {
    mockRoutes({ list_emails: () => ["a@b.c"] });
    const deps = makeDeps();
    const commands = mount(deps);
    await commands.loadEmails();
    expect(deps.setEmails).toHaveBeenCalledWith(["a@b.c"]);
  });

  it("loadEmails relocks on a Locked rejection and surfaces other errors", async () => {
    const locked = makeDeps();
    mockRoutes({ list_emails: () => { throw "Locked"; } });
    await mount(locked).loadEmails();
    expect(locked.setPhase).toHaveBeenCalledWith("locked");
    expect(locked.setEntries).toHaveBeenCalledWith([]);

    const failed = makeDeps();
    mockRoutes({ list_emails: () => { throw { Store: "no emails" }; } });
    await mount(failed).loadEmails();
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setError).toHaveBeenCalledWith("Ocurrió un error: no emails");
  });

  it("loadCategories computes usage counts from the unfiltered list", async () => {
    mockRoutes({ list_categories: () => CATEGORIES, list: () => [ENTRY] });
    const deps = makeDeps();
    await mount(deps).loadCategories();
    expect(deps.setCategories).toHaveBeenCalledWith(CATEGORIES);
    expect(deps.setUsage).toHaveBeenCalledWith({ entretenimiento: 0, trabajo: 1 });
  });

  it("loadCategories relocks on Locked and surfaces other errors", async () => {
    const locked = makeDeps();
    mockRoutes({ list_categories: () => { throw "Locked"; } });
    await mount(locked).loadCategories();
    expect(locked.setPhase).toHaveBeenCalledWith("locked");

    const failed = makeDeps();
    mockRoutes({ list_categories: () => { throw { Store: "x" }; } });
    await mount(failed).loadCategories();
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setError).toHaveBeenCalledWith("Ocurrió un error: x");
  });

  it("applyList stores the filtered list, clears stale details and refreshes emails", async () => {
    mockRoutes({ list: () => [ENTRY] });
    const deps = makeDeps();
    await mount(deps).applyList({ category: "trabajo" });
    expect(deps.setEntries).toHaveBeenCalledWith([ENTRY]);
    expect(deps.setDetails).toHaveBeenCalledWith({});
    expect(deps.setLeavingId).toHaveBeenCalledWith(null);
    expect(deps.setPhase).toHaveBeenCalledWith("unlocked");
    expect(mockedInvoke).toHaveBeenCalledWith("list_emails");
  });

  it("applyList relocks on Locked and surfaces other errors", async () => {
    const locked = makeDeps();
    mockRoutes({ list: () => { throw "Locked"; } });
    await mount(locked).applyList({});
    expect(locked.setPhase).toHaveBeenCalledWith("locked");

    const failed = makeDeps();
    mockRoutes({ list: () => { throw { Store: "x" }; } });
    await mount(failed).applyList({});
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setError).toHaveBeenCalledWith("Ocurrió un error: x");
  });
});

describe("useVaultCommands — create and unlock", () => {
  it("handleCreated creates the vault, notices and returns to login (no auto-unlock)", async () => {
    mockRoutes({ create_vault: () => undefined });
    const deps = makeDeps();
    await mount(deps).handleCreated("s3cret");
    expect(mockedInvoke).toHaveBeenCalledWith("create_vault", {
      req: { master_password: "s3cret" },
    });
    expect(deps.setNotice).toHaveBeenCalledWith(
      "Bóveda creada correctamente. Ahora inicia sesión.",
    );
    expect(deps.setBackoff).toHaveBeenCalledWith(null);
    expect(deps.setPhase).toHaveBeenCalledWith("locked");
  });

  it("handleCreated relocks on Locked and AlreadyInitialized rejections", async () => {
    for (const rejection of ["Locked", "AlreadyInitialized"]) {
      const deps = makeDeps();
      mockRoutes({ create_vault: () => { throw rejection; } });
      await mount(deps).handleCreated("s3cret");
      expect(deps.setPhase).toHaveBeenCalledWith("locked");
      // Only the initial error clear ran — no Spanish message was set.
      expect(deps.setError).toHaveBeenCalledTimes(1);
      expect(deps.setError).toHaveBeenCalledWith(null);
    }
  });

  it("handleCreated surfaces other errors without leaving the create screen", async () => {
    const deps = makeDeps();
    mockRoutes({ create_vault: () => { throw { Store: "x" }; } });
    await mount(deps).handleCreated("s3cret");
    expect(deps.setPhase).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith("Ocurrió un error: x");
  });

  it("handleUnlock unlocks and refreshes the vault with a view transition", async () => {
    mockRoutes({
      unlock: () => undefined,
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
    });
    const deps = makeDeps();
    await mount(deps).handleUnlock("s3cret");
    await flush();
    expect(deps.setNotice).toHaveBeenCalledWith(null);
    expect(deps.setEntries).toHaveBeenCalledWith([ENTRY]);
    expect(deps.setPhase).toHaveBeenCalledWith("unlocked");
    expect(mockedInvoke).toHaveBeenCalledWith("list_categories");
  });

  it("handleUnlock applies the backoff seconds, defaulting to zero", async () => {
    const withSeconds = makeDeps();
    mockRoutes({ unlock: () => { throw { Backoff: { seconds: 5 } }; } });
    await mount(withSeconds).handleUnlock("pw");
    expect(withSeconds.setBackoff).toHaveBeenCalledWith(5);

    const bare = makeDeps();
    mockRoutes({ unlock: () => { throw "Backoff"; } });
    await mount(bare).handleUnlock("pw");
    expect(bare.setBackoff).toHaveBeenCalledWith(0);
  });

  it("handleUnlock rejects a wrong password with the Spanish copy", async () => {
    const deps = makeDeps();
    mockRoutes({ unlock: () => { throw "AuthenticationFailed"; } });
    await mount(deps).handleUnlock("pw");
    expect(deps.setError).toHaveBeenCalledWith("Contraseña incorrecta.");
    expect(deps.setBackoff).toHaveBeenCalledWith(null);
  });

  it("handleUnlock switches to the create screen on VaultNotInitialized", async () => {
    const deps = makeDeps();
    mockRoutes({ unlock: () => { throw "VaultNotInitialized"; } });
    await mount(deps).handleUnlock("pw");
    expect(deps.setPhase).toHaveBeenCalledWith("create");
    expect(deps.setNotice).toHaveBeenCalledWith(null);
  });

  it("handleUnlock relocks on Locked and surfaces other errors", async () => {
    const locked = makeDeps();
    mockRoutes({ unlock: () => { throw "Locked"; } });
    await mount(locked).handleUnlock("pw");
    expect(locked.setPhase).toHaveBeenCalledWith("locked");

    const failed = makeDeps();
    mockRoutes({ unlock: () => { throw { Store: "x" }; } });
    await mount(failed).handleUnlock("pw");
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setError).toHaveBeenCalledWith("Ocurrió un error: x");
  });

  it("handleLock locks the screen even when the lock command fails", async () => {
    for (const reject of [false, true]) {
      const deps = makeDeps();
      mockRoutes({
        lock: () => {
          if (reject) throw new Error("boom");
          return undefined;
        },
      });
      await mount(deps).handleLock();
      expect(deps.setPhase).toHaveBeenCalledWith("locked");
    }
  });
});

describe("useVaultCommands — backup and import", () => {
  it("handleExport is silent when the save dialog is cancelled", async () => {
    mockedSave.mockResolvedValue(null);
    const deps = makeDeps();
    await mount(deps).handleExport();
    expect(mockedInvoke).not.toHaveBeenCalledWith("export_vault", expect.anything());
    expect(deps.setToast).not.toHaveBeenCalled();
  });

  it("handleExport shows a success toast and a single auto-clear timer", async () => {
    vi.useFakeTimers();
    mockedSave.mockResolvedValue("/tmp/backup.db");
    mockRoutes({ export_vault: () => undefined });
    const deps = makeDeps();
    await mount(deps).handleExport();
    expect(mockedInvoke).toHaveBeenCalledWith("export_vault", { dest: "/tmp/backup.db" });
    expect(deps.setToast).toHaveBeenCalledWith({
      kind: "success",
      message: "Respaldo exportado correctamente.",
    });

    // A second toast replaces the first and clears its pending timer.
    mockedSave.mockResolvedValue("/tmp/backup-2.db");
    await mount(deps).handleExport();
    expect(deps.setToast).toHaveBeenLastCalledWith({
      kind: "success",
      message: "Respaldo exportado correctamente.",
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(deps.setToast).toHaveBeenLastCalledWith(null);
  });

  it("handleExport relocks on Locked and toasts other failures", async () => {
    const locked = makeDeps();
    mockedSave.mockResolvedValue("/tmp/backup.db");
    mockRoutes({ export_vault: () => { throw "Locked"; } });
    await mount(locked).handleExport();
    expect(locked.setPhase).toHaveBeenCalledWith("locked");
    expect(locked.setToast).not.toHaveBeenCalled();

    const failed = makeDeps();
    mockRoutes({ export_vault: () => { throw { Backup: "disk full" }; } });
    await mount(failed).handleExport();
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setToast).toHaveBeenCalledWith({
      kind: "error",
      message: "Ocurrió un error: disk full",
    });
  });

  it("handleImportSelect is silent when the open dialog is cancelled", async () => {
    mockedOpen.mockResolvedValue(null);
    const deps = makeDeps();
    await mount(deps).handleImportSelect();
    expect(mockedInvoke).not.toHaveBeenCalledWith("import_vault", expect.anything());
    expect(deps.setImportConfirm).not.toHaveBeenCalled();
  });

  it("handleImportSelect opens the replacement confirmation for a valid preview", async () => {
    mockedOpen.mockResolvedValue("/home/user/backup.db");
    mockRoutes({ import_vault: () => ({ status: "confirmation_required" }) });
    const deps = makeDeps();
    await mount(deps).handleImportSelect();
    expect(deps.setImportConfirm).toHaveBeenCalledWith({ path: "/home/user/backup.db" });
  });

  it("handleImportSelect ignores an already-applied preview result", async () => {
    mockedOpen.mockResolvedValue("/home/user/backup.db");
    mockRoutes({ import_vault: () => ({ status: "applied" }) });
    const deps = makeDeps();
    await mount(deps).handleImportSelect();
    expect(deps.setImportConfirm).not.toHaveBeenCalled();
  });

  it("handleImportSelect relocks on Locked and toasts other failures", async () => {
    const locked = makeDeps();
    mockedOpen.mockResolvedValue("/home/user/backup.db");
    mockRoutes({ import_vault: () => { throw "Locked"; } });
    await mount(locked).handleImportSelect();
    expect(locked.setPhase).toHaveBeenCalledWith("locked");

    const failed = makeDeps();
    mockRoutes({ import_vault: () => { throw "Import"; } });
    await mount(failed).handleImportSelect();
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setToast).toHaveBeenCalledWith({
      kind: "error",
      message:
        "No se pudo importar la bóveda. Verifica que el archivo sea un respaldo válido e inténtalo de nuevo.",
    });
  });

  it("handleImportConfirm is a no-op without a pending confirmation", async () => {
    const deps = makeDeps(); // importConfirm: null
    await mount(deps).handleImportConfirm();
    expect(mockedInvoke).not.toHaveBeenCalledWith("import_vault", expect.anything());
    expect(deps.setImportConfirm).not.toHaveBeenCalled();
  });

  it("handleImportConfirm replaces the vault, relocks and announces re-login", async () => {
    mockRoutes({ import_vault: () => ({ status: "applied" }) });
    const deps = makeDeps({ importConfirm: { path: "/home/user/backup.db" } });
    await mount(deps).handleImportConfirm();
    expect(mockedInvoke).toHaveBeenCalledWith("import_vault", {
      path: "/home/user/backup.db",
      confirmed: true,
    });
    expect(deps.setImportConfirm).toHaveBeenCalledWith(null);
    expect(deps.setPhase).toHaveBeenCalledWith("locked");
    expect(deps.setToast).toHaveBeenCalledWith({
      kind: "success",
      message:
        "Bóveda reemplazada correctamente. Inicia sesión con la contraseña maestra del respaldo importado.",
    });
  });

  it("handleImportConfirm ignores a non-applied confirmed result", async () => {
    mockRoutes({ import_vault: () => ({ status: "confirmation_required" }) });
    const deps = makeDeps({ importConfirm: { path: "/x.db" } });
    await mount(deps).handleImportConfirm();
    expect(deps.setPhase).not.toHaveBeenCalled();
    expect(deps.setToast).not.toHaveBeenCalled();
  });

  it("handleImportConfirm relocks on Locked and toasts other failures", async () => {
    const locked = makeDeps({ importConfirm: { path: "/x.db" } });
    mockRoutes({ import_vault: () => { throw "Locked"; } });
    await mount(locked).handleImportConfirm();
    expect(locked.setPhase).toHaveBeenCalledWith("locked");

    const failed = makeDeps({ importConfirm: { path: "/x.db" } });
    mockRoutes({ import_vault: () => { throw "Import"; } });
    await mount(failed).handleImportConfirm();
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setToast).toHaveBeenCalledWith({
      kind: "error",
      message:
        "No se pudo importar la bóveda. Verifica que el archivo sea un respaldo válido e inténtalo de nuevo.",
    });
  });
});

describe("useVaultCommands — entry commands", () => {
  it("openEditEntry fetches details once and opens the modal", async () => {
    mockRoutes({ get_entry_details: () => DETAILS });
    const deps = makeDeps();
    await mount(deps).openEditEntry(ENTRY);
    expect(mockedInvoke).toHaveBeenCalledWith("get_entry_details", { id: "id-1" });
    expect(deps.setDetails).toHaveBeenCalledWith(expect.any(Function));
    expect(deps.setEditing).toHaveBeenCalledWith(ENTRY);
    expect(deps.setFormOpen).toHaveBeenCalledWith(true);
    expect(deps.setMorphOriginId).toHaveBeenCalledWith(null);
  });

  it("openEditEntry skips the fetch when the details are already cached", async () => {
    const deps = makeDeps({ details: { "id-1": DETAILS } });
    await mount(deps).openEditEntry(ENTRY);
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "get_entry_details",
      expect.anything(),
    );
    expect(deps.setEditing).toHaveBeenCalledWith(ENTRY);
    expect(deps.setFormOpen).toHaveBeenCalledWith(true);
  });

  it("openEditEntry relocks on Locked and surfaces other fetch errors", async () => {
    const locked = makeDeps();
    mockRoutes({ get_entry_details: () => { throw "Locked"; } });
    await mount(locked).openEditEntry(ENTRY);
    expect(locked.setPhase).toHaveBeenCalledWith("locked");
    // lockScreen closes the form instead of opening it.
    expect(locked.setFormOpen).toHaveBeenCalledWith(false);

    const failed = makeDeps();
    mockRoutes({ get_entry_details: () => { throw { Store: "x" }; } });
    await mount(failed).openEditEntry(ENTRY);
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setError).toHaveBeenCalledWith("Ocurrió un error: x");
    expect(failed.setFormOpen).not.toHaveBeenCalled();
  });

  it("handleCopy copies the requested field", async () => {
    mockRoutes({ copy_field: () => undefined });
    const deps = makeDeps();
    await mount(deps).handleCopy("id-1", "password");
    expect(mockedInvoke).toHaveBeenCalledWith("copy_field", {
      id: "id-1",
      field: "password",
    });
  });

  it("handleCopy relocks on Locked and surfaces other errors", async () => {
    const locked = makeDeps();
    mockRoutes({ copy_field: () => { throw "Locked"; } });
    await mount(locked).handleCopy("id-1", "password");
    expect(locked.setPhase).toHaveBeenCalledWith("locked");

    const failed = makeDeps();
    mockRoutes({ copy_field: () => { throw { Store: "x" }; } });
    await mount(failed).handleCopy("id-1", "password");
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setError).toHaveBeenCalledWith("Ocurrió un error: x");
  });

  it("handleSave creates a new entry and refreshes", async () => {
    mockRoutes({
      create: () => "id-2",
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
    });
    const deps = makeDeps();
    const input = {
      site: "GitLab",
      link: "",
      password: "p4ss",
      email: "",
      username: "",
      category: "trabajo",
    };
    await mount(deps).handleSave(input);
    expect(mockedInvoke).toHaveBeenCalledWith("create", { input });
    expect(deps.setFormOpen).toHaveBeenCalledWith(false);
    expect(deps.setEditing).toHaveBeenCalledWith(null);
    await flush();
    expect(deps.setEntries).toHaveBeenCalledWith([ENTRY]);
    expect(mockedInvoke).toHaveBeenCalledWith("list_categories");
  });

  it("handleSave updates the entry being edited", async () => {
    mockRoutes({
      update: () => undefined,
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
    });
    const deps = makeDeps({ editingRef: { current: ENTRY } });
    const input = {
      site: "GitLab",
      link: "https://github.com",
      password: "s3cr3t",
      email: "ana@example.com",
      username: "ana",
      category: "trabajo",
    };
    await mount(deps).handleSave(input);
    expect(mockedInvoke).toHaveBeenCalledWith("update", { id: "id-1", input });
    expect(deps.editingRef.current).toBeNull();
  });

  it("handleSave relocks on Locked and surfaces other errors", async () => {
    const input = {
      site: "GitLab",
      link: "",
      password: "p4ss",
      email: "",
      username: "",
      category: "trabajo",
    };
    const locked = makeDeps();
    mockRoutes({ create: () => { throw "Locked"; } });
    await mount(locked).handleSave(input);
    expect(locked.setPhase).toHaveBeenCalledWith("locked");

    const failed = makeDeps();
    mockRoutes({ create: () => { throw { Store: "x" }; } });
    await mount(failed).handleSave(input);
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setError).toHaveBeenCalledWith("Ocurrió un error: x");
  });

  it("handleConfirmDelete is a no-op without a pending deletion", async () => {
    const deps = makeDeps(); // deleting: null
    await mount(deps).handleConfirmDelete();
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete", expect.anything());
  });

  it("handleConfirmDelete plays the leave delay, deletes and refreshes", async () => {
    vi.useFakeTimers();
    mockRoutes({
      delete: () => undefined,
      list: () => [],
      list_categories: () => CATEGORIES,
    });
    const deps = makeDeps({ deleting: ENTRY });
    const promise = mount(deps).handleConfirmDelete();
    await vi.advanceTimersByTimeAsync(320);
    await promise;
    await flush();
    expect(mockedInvoke).toHaveBeenCalledWith("delete", { id: "id-1" });
    expect(deps.setLeavingId).toHaveBeenCalledWith(null);
    expect(deps.setEntries).toHaveBeenCalledWith([]);
    expect(mockedInvoke).toHaveBeenCalledWith("list_categories");
  });

  it("handleConfirmDelete closes the modal and refreshes on NotFound", async () => {
    vi.useFakeTimers();
    mockRoutes({
      delete: () => { throw "NotFound"; },
      list: () => [],
      list_categories: () => CATEGORIES,
    });
    const deps = makeDeps({ deleting: ENTRY, editingRef: { current: ENTRY } });
    const promise = mount(deps).handleConfirmDelete();
    await vi.advanceTimersByTimeAsync(320);
    await promise;
    await flush();
    expect(deps.setFormOpen).toHaveBeenCalledWith(false);
    expect(deps.setEntries).toHaveBeenCalledWith([]);
    expect(deps.setPhase).not.toHaveBeenCalledWith("locked");
  });

  it("handleConfirmDelete relocks on Locked and surfaces other errors", async () => {
    vi.useFakeTimers();
    const locked = makeDeps({ deleting: ENTRY });
    mockRoutes({ delete: () => { throw "Locked"; } });
    const lockedPromise = mount(locked).handleConfirmDelete();
    await vi.advanceTimersByTimeAsync(320);
    await lockedPromise;
    expect(locked.setPhase).toHaveBeenCalledWith("locked");

    const failed = makeDeps({ deleting: ENTRY });
    mockRoutes({ delete: () => { throw { Store: "x" }; } });
    const failedPromise = mount(failed).handleConfirmDelete();
    await vi.advanceTimersByTimeAsync(320);
    await failedPromise;
    expect(failed.setPhase).not.toHaveBeenCalled();
    expect(failed.setError).toHaveBeenCalledWith("Ocurrió un error: x");
  });

  it("closeDetailsModal closes directly without a transition when unsupported", () => {
    const deps = makeDeps({ editingRef: { current: ENTRY } });
    mount(deps).closeDetailsModal();
    expect(deps.setFormOpen).toHaveBeenCalledWith(false);
    expect(deps.setEditing).toHaveBeenCalledWith(null);
    expect(deps.setMorphOriginId).toHaveBeenCalledWith(null);
    expect(deps.setMorphActive).toHaveBeenCalledWith(false);
  });

  it("closeDetailsModal closes through a view transition when supported", async () => {
    let ran = false;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      writable: true,
      value: (callback: () => void) => {
        callback();
        ran = true;
        return { finished: Promise.resolve() };
      },
    });
    const deps = makeDeps({ editingRef: { current: ENTRY } });
    mount(deps).closeDetailsModal();
    await act(async () => {
      await Promise.resolve();
    });
    expect(ran).toBe(true);
    expect(deps.setMorphOriginId).toHaveBeenCalledWith("id-1");
    expect(deps.setFormOpen).toHaveBeenCalledWith(false);
    expect(deps.setEditing).toHaveBeenCalledWith(null);
  });

  it("closeDetailsModal clears the morph origin when no entry is open", () => {
    const deps = makeDeps();
    mount(deps).closeDetailsModal();
    expect(deps.setFormOpen).toHaveBeenCalledWith(false);
    expect(deps.setMorphOriginId).toHaveBeenCalledWith(null);
  });
});

describe("useVaultCommands — category administration", () => {
  it("handleCreateCategory creates and refreshes the map", async () => {
    mockRoutes({
      create_category: () => undefined,
      list_categories: () => CATEGORIES,
      list: () => [],
    });
    const deps = makeDeps();
    await mount(deps).handleCreateCategory({ name: "lectura", color: "#8a4f7d" });
    expect(mockedInvoke).toHaveBeenCalledWith("create_category", {
      input: { name: "lectura", color: "#8a4f7d" },
    });
    expect(deps.setCategories).toHaveBeenCalledWith(CATEGORIES);
  });

  it("handleCreateCategory relocks silently on Locked and rethrows other errors", async () => {
    const locked = makeDeps();
    mockRoutes({ create_category: () => { throw "Locked"; } });
    await mount(locked).handleCreateCategory({ name: "x", color: "#2f5d8c" });
    expect(locked.setPhase).toHaveBeenCalledWith("locked");
    expect(locked.setError).not.toHaveBeenCalled();

    const failed = makeDeps();
    mockRoutes({ create_category: () => { throw "DuplicateCategory"; } });
    await expect(
      mount(failed).handleCreateCategory({ name: "x", color: "#2f5d8c" }),
    ).rejects.toEqual({ kind: "DuplicateCategory" });
    expect(failed.setPhase).not.toHaveBeenCalled();
  });

  it("handleUpdateCategory refreshes the map on an applied rename", async () => {
    mockRoutes({
      update_category: () => ({ status: "applied" }),
      list_categories: () => CATEGORIES,
      list: () => [],
    });
    const deps = makeDeps();
    const result = await mount(deps).handleUpdateCategory({
      old_name: "trabajo",
      new_name: "laburo",
      color: "#2f5d8c",
      confirmed: true,
    });
    expect(result).toEqual({ status: "applied" });
    expect(deps.setCategories).toHaveBeenCalledWith(CATEGORIES);
  });

  it("handleUpdateCategory returns a rename preview without refreshing", async () => {
    mockRoutes({ update_category: () => ({ status: "rename_preview", affected_entries: 3 }) });
    const deps = makeDeps();
    const result = await mount(deps).handleUpdateCategory({
      old_name: "trabajo",
      new_name: "laburo",
      color: "#2f5d8c",
      confirmed: false,
    });
    expect(result).toEqual({ status: "rename_preview", affected_entries: 3 });
    expect(mockedInvoke).not.toHaveBeenCalledWith("list_categories");
  });

  it("handleUpdateCategory relocks on Locked and rethrows all rejections", async () => {
    const locked = makeDeps();
    mockRoutes({ update_category: () => { throw "Locked"; } });
    await expect(
      mount(locked).handleUpdateCategory({
        old_name: "a",
        new_name: "b",
        color: "#2f5d8c",
        confirmed: true,
      }),
    ).rejects.toEqual({ kind: "Locked" });
    expect(locked.setPhase).toHaveBeenCalledWith("locked");

    const failed = makeDeps();
    mockRoutes({ update_category: () => { throw "CategoryNotFound"; } });
    await expect(
      mount(failed).handleUpdateCategory({
        old_name: "a",
        new_name: "b",
        color: "#2f5d8c",
        confirmed: true,
      }),
    ).rejects.toEqual({ kind: "CategoryNotFound" });
    expect(failed.setPhase).not.toHaveBeenCalled();
  });

  it("handleDeleteCategory deletes and refreshes the map", async () => {
    mockRoutes({
      delete_category: () => undefined,
      list_categories: () => CATEGORIES,
      list: () => [],
    });
    const deps = makeDeps();
    await mount(deps).handleDeleteCategory("lectura");
    expect(mockedInvoke).toHaveBeenCalledWith("delete_category", { name: "lectura" });
    expect(deps.setCategories).toHaveBeenCalledWith(CATEGORIES);
  });

  it("handleDeleteCategory relocks silently on Locked and rethrows other errors", async () => {
    const locked = makeDeps();
    mockRoutes({ delete_category: () => { throw "Locked"; } });
    await mount(locked).handleDeleteCategory("lectura");
    expect(locked.setPhase).toHaveBeenCalledWith("locked");
    expect(locked.setError).not.toHaveBeenCalled();

    const failed = makeDeps();
    mockRoutes({ delete_category: () => { throw "CategoryInUse"; } });
    await expect(
      mount(failed).handleDeleteCategory("lectura"),
    ).rejects.toEqual({ kind: "CategoryInUse" });
    expect(failed.setPhase).not.toHaveBeenCalled();
  });
});