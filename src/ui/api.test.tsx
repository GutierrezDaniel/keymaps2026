// Typed IPC client tests: every command must invoke the exact Tauri command
// name and argument shape the Rust side expects (vault-ui + the serde DTO
// contracts in src-tauri/src/adapters/tauri.rs), and error rejections must
// normalize into typed CommandError values.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { api, toCommandError } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

describe("api — command wiring", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
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

  it("export invokes export with the destination path", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await api.export("/tmp/backup.db");
    expect(mockedInvoke).toHaveBeenCalledWith("export", { path: "/tmp/backup.db" });
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
});

describe("toCommandError — rejection normalization", () => {
  it("maps unit-variant strings to typed kinds", () => {
    expect(toCommandError("Locked")).toEqual({ kind: "Locked" });
    expect(toCommandError("AuthenticationFailed")).toEqual({ kind: "AuthenticationFailed" });
    expect(toCommandError("VaultNotInitialized")).toEqual({ kind: "VaultNotInitialized" });
    expect(toCommandError("AlreadyInitialized")).toEqual({ kind: "AlreadyInitialized" });
    expect(toCommandError("InvalidCategory")).toEqual({ kind: "InvalidCategory" });
    expect(toCommandError("NotFound")).toEqual({ kind: "NotFound" });
    expect(toCommandError("InvalidField")).toEqual({ kind: "InvalidField" });
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