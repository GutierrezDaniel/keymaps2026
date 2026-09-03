// Typed IPC client tests: every command must invoke the exact Tauri command
// name and argument shape the Rust side expects (vault-ui + the serde DTO
// contracts in src-tauri/src/adapters/tauri.rs), and error rejections must
// normalize into typed CommandError values.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { api, toCommandError, CATEGORY_PALETTE } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);
const mockedOpen = vi.mocked(open);

describe("api — command wiring", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedSave.mockReset();
    mockedOpen.mockReset();
  });

  it("createVault invokes create_vault with the master password in the req DTO", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.createVault("s3cret");
    expect(mockedInvoke).toHaveBeenCalledWith("create_vault", {
      req: { master_password: "s3cret" },
    });
  });

  it("unlock invokes unlock with the master password in the req DTO", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.unlock("s3cret");
    expect(mockedInvoke).toHaveBeenCalledWith("unlock", {
      req: { master_password: "s3cret" },
    });
  });

  it("lock invokes lock with no arguments", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.lock();
    expect(mockedInvoke).toHaveBeenCalledWith("lock");
  });

  it("list invokes list with null filters when empty", async () => {
    mockedInvoke.mockResolvedValue([]);
    await api.list(null);
    expect(mockedInvoke).toHaveBeenCalledWith("list", { filters: null });
  });

  it("list passes the conjunctive filter DTO unchanged", async () => {
    mockedInvoke.mockResolvedValue([]);
    await api.list({ site: "git", category: "trabajo", email: null });
    expect(mockedInvoke).toHaveBeenCalledWith("list", {
      filters: { site: "git", category: "trabajo", email: null },
    });
  });

  it("listEmails invokes list_emails with no arguments", async () => {
    mockedInvoke.mockResolvedValue(["a@b.c", "team@example.com"]);
    const emails = await api.listEmails();
    expect(emails).toEqual(["a@b.c", "team@example.com"]);
    expect(mockedInvoke).toHaveBeenCalledWith("list_emails");
  });

  it("getEntryDetails invokes get_entry_details by record id", async () => {
    mockedInvoke.mockResolvedValue({ summary: {}, password: "" });
    await api.getEntryDetails("abc123");
    expect(mockedInvoke).toHaveBeenCalledWith("get_entry_details", { id: "abc123" });
  });

  it("create invokes create with the full entry input DTO", async () => {
    mockedInvoke.mockResolvedValue("id-1");
    const input = {
      site: "github",
      link: "https://github.com",
      password: "s3cr3t",
      email: "a@b.c",
      username: "user",
      category: "trabajo",
    };
    await api.create(input);
    expect(mockedInvoke).toHaveBeenCalledWith("create", { input });
  });

  it("update invokes update with id and input DTO", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    const input = {
      site: "github",
      link: "",
      password: "new",
      email: "",
      username: "",
      category: "trabajo",
    };
    await api.update("id-1", input);
    expect(mockedInvoke).toHaveBeenCalledWith("update", { id: "id-1", input });
  });

  it("delete invokes delete by record id", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.delete("id-1");
    expect(mockedInvoke).toHaveBeenCalledWith("delete", { id: "id-1" });
  });

  it("export invokes export_vault with the destination path (replaced the sync export command)", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.export("/tmp/backup.db");
    expect(mockedInvoke).toHaveBeenCalledWith("export_vault", { dest: "/tmp/backup.db" });
  });

  it("copyField invokes copy_field with the snake_case field variant", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.copyField("id-1", "password");
    expect(mockedInvoke).toHaveBeenCalledWith("copy_field", { id: "id-1", field: "password" });
    await api.copyField("id-1", "username");
    expect(mockedInvoke).toHaveBeenCalledWith("copy_field", { id: "id-1", field: "username" });
  });

  it("recordActivity invokes record_activity with no arguments", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.recordActivity();
    expect(mockedInvoke).toHaveBeenCalledWith("record_activity");
  });

  it("listCategories invokes list_categories with no arguments", async () => {
    mockedInvoke.mockResolvedValue([
      { name: "entretenimiento", color: "#7a5220" },
      { name: "lectura", color: "#8a4f7d" },
    ]);
    const categories = await api.listCategories();
    expect(categories).toEqual([
      { name: "entretenimiento", color: "#7a5220" },
      { name: "lectura", color: "#8a4f7d" },
    ]);
    expect(mockedInvoke).toHaveBeenCalledWith("list_categories");
  });

  it("createCategory invokes create_category with the CategoryDto as input", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.createCategory({ name: "lectura", color: "#8a4f7d" });
    expect(mockedInvoke).toHaveBeenCalledWith("create_category", {
      input: { name: "lectura", color: "#8a4f7d" },
    });
  });

  it("updateCategory invokes update_category with the snake_case request DTO", async () => {
    mockedInvoke.mockResolvedValue({ status: "rename_preview", affected_entries: 3 });
    const result = await api.updateCategory({
      old_name: "trabajo",
      new_name: "laburo",
      color: "#c05640",
      confirmed: false,
    });
    expect(result).toEqual({ status: "rename_preview", affected_entries: 3 });
    expect(mockedInvoke).toHaveBeenCalledWith("update_category", {
      request: {
        old_name: "trabajo",
        new_name: "laburo",
        color: "#c05640",
        confirmed: false,
      },
    });
  });

  it("updateCategory resolves an applied recolor as the applied tagged result", async () => {
    mockedInvoke.mockResolvedValue({ status: "applied" });
    const result = await api.updateCategory({
      old_name: "trabajo",
      new_name: "trabajo",
      color: "#ad3a2d",
      confirmed: true,
    });
    expect(result).toEqual({ status: "applied" });
  });

  it("deleteCategory invokes delete_category by category name", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.deleteCategory("lectura");
    expect(mockedInvoke).toHaveBeenCalledWith("delete_category", { name: "lectura" });
  });

  it("CATEGORY_PALETTE exposes exactly the 24 backend swatches", () => {
    expect(CATEGORY_PALETTE).toHaveLength(24);
    expect(CATEGORY_PALETTE).toContain("#7a5220");
    expect(CATEGORY_PALETTE).toContain("#a67c52");
  });
});

describe("api — native dialog wrappers (vault-backup / vault-import)", () => {
  it("chooseExportPath opens the save dialog with the timestamped default filename", async () => {
    mockedSave.mockResolvedValue("/tmp/clavemaestra-backup.db");
    const path = await api.chooseExportPath();
    expect(path).toBe("/tmp/clavemaestra-backup.db");
    expect(mockedSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Exportar respaldo",
        defaultPath: expect.stringMatching(
          /^clavemaestra-backup-\d{4}-\d{2}-\d{2}-\d{4}\.db$/,
        ),
        filters: [{ name: "Base de datos", extensions: ["db"] }],
      }),
    );
  });

  it("chooseExportPath resolves null when the save dialog is cancelled", async () => {
    mockedSave.mockResolvedValue(null);
    expect(await api.chooseExportPath()).toBeNull();
  });

  it("chooseImportPath opens the open dialog for a single backup file", async () => {
    mockedOpen.mockResolvedValue("/home/user/backup.db");
    const path = await api.chooseImportPath();
    expect(path).toBe("/home/user/backup.db");
    expect(mockedOpen).toHaveBeenCalledWith({
      title: "Seleccionar respaldo",
      multiple: false,
      directory: false,
      filters: [{ name: "Base de datos", extensions: ["db"] }],
    });
  });

  it("chooseImportPath resolves null when the open dialog is cancelled", async () => {
    mockedOpen.mockResolvedValue(null);
    expect(await api.chooseImportPath()).toBeNull();
  });
});

describe("api — vault import wiring (vault-import spec)", () => {
  it("importVault previews with confirmed=false and returns the tagged confirmation result", async () => {
    mockedInvoke.mockResolvedValue({ status: "confirmation_required" });
    const result = await api.importVault("/home/user/backup.db", false);
    expect(result).toEqual({ status: "confirmation_required" });
    expect(mockedInvoke).toHaveBeenCalledWith("import_vault", {
      path: "/home/user/backup.db",
      confirmed: false,
    });
  });

  it("importVault confirms with confirmed=true and returns the applied result", async () => {
    mockedInvoke.mockResolvedValue({ status: "applied" });
    const result = await api.importVault("/home/user/backup.db", true);
    expect(result).toEqual({ status: "applied" });
    expect(mockedInvoke).toHaveBeenCalledWith("import_vault", {
      path: "/home/user/backup.db",
      confirmed: true,
    });
  });
});

describe("toCommandError — rejection normalization", () => {
  it("maps unit-variant strings to typed kinds", () => {
    expect(toCommandError("Locked")).toEqual({ kind: "Locked" });
    expect(toCommandError("AuthenticationFailed")).toEqual({ kind: "AuthenticationFailed" });
    expect(toCommandError("VaultNotInitialized")).toEqual({ kind: "VaultNotInitialized" });
    expect(toCommandError("AlreadyInitialized")).toEqual({ kind: "AlreadyInitialized" });
    expect(toCommandError("InvalidCategory")).toEqual({ kind: "InvalidCategory" });
    expect(toCommandError("BlankCategoryName")).toEqual({ kind: "BlankCategoryName" });
    expect(toCommandError("InvalidCategoryColor")).toEqual({ kind: "InvalidCategoryColor" });
    expect(toCommandError("DuplicateCategory")).toEqual({ kind: "DuplicateCategory" });
    expect(toCommandError("CategoryInUse")).toEqual({ kind: "CategoryInUse" });
    expect(toCommandError("LastCategory")).toEqual({ kind: "LastCategory" });
    expect(toCommandError("CategoryNotFound")).toEqual({ kind: "CategoryNotFound" });
    expect(toCommandError("NotFound")).toEqual({ kind: "NotFound" });
    expect(toCommandError("InvalidField")).toEqual({ kind: "InvalidField" });
    expect(toCommandError("Import")).toEqual({ kind: "Import" });
  });

  it("maps the Backoff struct variant and keeps its seconds", () => {
    expect(toCommandError({ Backoff: { seconds: 5 } })).toEqual({
      kind: "Backoff",
      seconds: 5,
    });
  });

  it("maps transport variants to typed kinds with their message", () => {
    expect(toCommandError({ Store: "disk full" })).toEqual({
      kind: "Store",
      message: "disk full",
    });
    expect(toCommandError({ Crypto: "auth failed" })).toEqual({
      kind: "Crypto",
      message: "auth failed",
    });
  });

  it("falls back to Unknown for anything else", () => {
    expect(toCommandError(new Error("boom"))).toEqual({ kind: "Unknown", message: "Error: boom" });
    expect(toCommandError(undefined)).toEqual({ kind: "Unknown", message: "undefined" });
  });
});