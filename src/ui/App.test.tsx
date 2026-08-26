// App-level tests for the Spanish screens (vault-ui): boot resolution,
// irreversible-loss warnings, vault creation (which does not auto-unlock),
// login errors and backoff, explicit lock, auto-lock surfacing, card flip
// details, copy, delete confirmation and the entry form save path.
//
// The Tauri IPC module is mocked so everything runs headless in jsdom; the
// typed client (`./api`) routes through the same mocked invoke.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { EntrySummary, EntryDetails } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

const ENTRY: EntrySummary = {
  id: "id-1",
  site: "GitHub",
  link: "https://github.com",
  email: "ana@example.com",
  username: "ana",
  category: "trabajo",
};

const DETAILS: EntryDetails = { summary: ENTRY, password: "s3cr3t" };

/** Route mocked invoke by command name. Handlers throw to reject. */
function mockRoutes(routes: Record<string, (args?: unknown) => unknown>) {
  mockedInvoke.mockImplementation((command: string, args?: unknown) => {
    const handler = routes[command];
    if (!handler) return Promise.reject(new Error(`No mock registered for ${command}`));
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

function bootUnlocked() {
  mockRoutes({
    list: () => [ENTRY],
  });
  return render(<App />);
}

async function reachLogin(): Promise<void> {
  mockRoutes({
    list: () => {
      throw "Locked";
    },
  });
  render(<App />);
  await screen.findByLabelText("Contraseña maestra");
}

describe("App — boot resolution", () => {
  it("shows the vault with entry cards when boot list succeeds", async () => {
    bootUnlocked();
    expect(await screen.findByRole("heading", { name: "Mi bóveda" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nueva entrada" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bloquear" })).toBeTruthy();
  });

  it("shows the login screen with the Spanish irreversible-loss warning when locked", async () => {
    await reachLogin();
    expect(screen.getByText(/pérdida irreversible/i)).toBeTruthy();
    expect(screen.getByText(/no existe ningún mecanismo de recuperación/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desbloquear" })).toBeTruthy();
  });
});

describe("App — login and backoff", () => {
  it("rejects an incorrect master password with a Spanish message", async () => {
    mockRoutes({
      list: () => {
        throw "Locked";
      },
      unlock: () => {
        throw "AuthenticationFailed";
      },
    });
    render(<App />);
    await screen.findByLabelText("Contraseña maestra");

    fireEvent.change(screen.getByLabelText("Contraseña maestra"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));

    expect(await screen.findByText("Contraseña incorrecta.")).toBeTruthy();
    expect(screen.getByLabelText("Contraseña maestra")).toBeTruthy();
  });

  it("surfaces the backoff countdown and disables the submit button", async () => {
    mockRoutes({
      list: () => {
        throw "Locked";
      },
      unlock: () => {
        throw { Backoff: { seconds: 5 } };
      },
    });
    render(<App />);
    await screen.findByLabelText("Contraseña maestra");

    fireEvent.change(screen.getByLabelText("Contraseña maestra"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));

    expect(await screen.findByText(/Demasiados intentos fallidos/)).toBeTruthy();
    expect(screen.getByText(/en 5 segundos/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desbloquear" })).toHaveProperty("disabled", true);
  });

  it("unlocks with the correct password and shows the vault", async () => {
    let unlocked = false;
    mockRoutes({
      list: () => {
        if (unlocked) return [ENTRY];
        throw "Locked";
      },
      unlock: () => {
        unlocked = true;
      },
      get_entry_details: () => DETAILS,
    });
    render(<App />);
    await screen.findByLabelText("Contraseña maestra");

    fireEvent.change(screen.getByLabelText("Contraseña maestra"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));

    expect(await screen.findByRole("heading", { name: "Mi bóveda" })).toBeTruthy();
    expect(mockedInvoke).toHaveBeenCalledWith("unlock", {
      req: { master_password: "correct horse" },
    });
  });
});

describe("App — vault creation", () => {
  it("switches to the create screen with its warning when the vault is not initialized", async () => {
    mockRoutes({
      list: () => {
        throw "Locked";
      },
      unlock: () => {
        throw "VaultNotInitialized";
      },
    });
    render(<App />);
    await screen.findByLabelText("Contraseña maestra");

    fireEvent.change(screen.getByLabelText("Contraseña maestra"), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));

    expect(await screen.findByLabelText("Nueva contraseña maestra")).toBeTruthy();
    expect(screen.getByText(/pérdida irreversible/i)).toBeTruthy();
    expect(screen.getByText(/no existe ningún mecanismo de recuperación/i)).toBeTruthy();
  });

  it("keeps the create form open with a Spanish message when passwords do not match", async () => {
    mockRoutes({
      list: () => {
        throw "Locked";
      },
      unlock: () => {
        throw "VaultNotInitialized";
      },
    });
    render(<App />);
    await screen.findByLabelText("Contraseña maestra");
    fireEvent.change(screen.getByLabelText("Contraseña maestra"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    await screen.findByLabelText("Nueva contraseña maestra");

    fireEvent.change(screen.getByLabelText("Nueva contraseña maestra"), {
      target: { value: "uno" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña maestra"), {
      target: { value: "dos" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear bóveda" }));

    expect(screen.getByText("Las contraseñas no coinciden.")).toBeTruthy();
    expect(mockedInvoke).not.toHaveBeenCalledWith("create_vault", expect.anything());
    expect(screen.getByLabelText("Nueva contraseña maestra")).toBeTruthy();
  });

  it("creates the vault and then shows the login screen (create does not auto-unlock)", async () => {
    mockRoutes({
      list: () => {
        throw "Locked";
      },
      unlock: () => {
        throw "VaultNotInitialized";
      },
      create_vault: () => undefined,
    });
    render(<App />);
    await screen.findByLabelText("Contraseña maestra");
    fireEvent.change(screen.getByLabelText("Contraseña maestra"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    await screen.findByLabelText("Nueva contraseña maestra");

    fireEvent.change(screen.getByLabelText("Nueva contraseña maestra"), {
      target: { value: "maestra-fuerte" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña maestra"), {
      target: { value: "maestra-fuerte" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear bóveda" }));

    expect(mockedInvoke).toHaveBeenCalledWith("create_vault", {
      req: { master_password: "maestra-fuerte" },
    });
    // create_vault does NOT auto-unlock: the login screen must appear.
    expect(await screen.findByLabelText("Contraseña maestra")).toBeTruthy();
    expect(screen.getByText("Bóveda creada correctamente. Ahora inicia sesión.")).toBeTruthy();
  });
});

describe("App — unlocked vault interactions", () => {
  it("locks explicitly and shows the locked warning", async () => {
    mockRoutes({
      list: () => [ENTRY],
      lock: () => undefined,
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    fireEvent.click(screen.getByRole("button", { name: "Bloquear" }));

    expect(mockedInvoke).toHaveBeenCalledWith("lock");
    expect(await screen.findByLabelText("Contraseña maestra")).toBeTruthy();
    expect(screen.getByText(/pérdida irreversible/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Mi bóveda" })).toBeNull();
  });

  it("fetches decrypted details on flip and keeps the password masked by default", async () => {
    mockRoutes({
      list: () => [ENTRY],
      get_entry_details: () => DETAILS,
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    fireEvent.click(screen.getByRole("button", { name: "Ver detalles" }));

    expect(mockedInvoke).toHaveBeenCalledWith("get_entry_details", { id: "id-1" });
    const card = (await screen.findByText("Contraseña")).closest(".card-back") as HTMLElement;
    expect(within(card).getByLabelText("Valor de la contraseña").textContent).toContain("•");
    expect(within(card).getByLabelText("Valor de la contraseña").textContent).not.toContain(
      "s3cr3t",
    );
  });

  it("copies a field through the command surface and shows Copiado", async () => {
    mockRoutes({
      list: () => [ENTRY],
      get_entry_details: () => DETAILS,
      copy_field: () => undefined,
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });
    fireEvent.click(screen.getByRole("button", { name: "Ver detalles" }));
    await screen.findByText("Contraseña");

    fireEvent.click(screen.getByRole("button", { name: "Copiar contraseña" }));

    expect(mockedInvoke).toHaveBeenCalledWith("copy_field", { id: "id-1", field: "password" });
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeTruthy();
  });

  it("confirms deletion in Spanish and refreshes the list afterwards", async () => {
    let listResult: EntrySummary[] = [ENTRY];
    mockRoutes({
      list: () => listResult,
      get_entry_details: () => DETAILS,
      delete: () => {
        listResult = [];
      },
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });
    fireEvent.click(screen.getByRole("button", { name: "Ver detalles" }));
    await screen.findByText("Contraseña");

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(screen.getByText("¿Eliminar la entrada «GitHub»?")).toBeTruthy();
    expect(screen.getByText("Esta acción no se puede deshacer.")).toBeTruthy();

    const confirmDialog = screen.getByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Eliminar" }));

    expect(mockedInvoke).toHaveBeenCalledWith("delete", { id: "id-1" });
    expect(await screen.findByText(/Aún no hay entradas/)).toBeTruthy();
  });

  it("saves a new entry from the form modal", async () => {
    mockRoutes({
      list: () => [ENTRY],
      create: () => "id-2",
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    fireEvent.click(screen.getByRole("button", { name: "Nueva entrada" }));
    expect(screen.getByRole("dialog", { name: "Formulario de entrada" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Sitio/), { target: { value: "GitLab" } });
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "p4ss" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(mockedInvoke).toHaveBeenCalledWith("create", {
      input: {
        site: "GitLab",
        link: "",
        password: "p4ss",
        email: "",
        username: "",
        category: "entretenimiento",
      },
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Formulario de entrada" })).toBeNull(),
    );
  });

  it("returns to the locked screen when a command reports the vault auto-locked", async () => {
    mockRoutes({
      list: () => [ENTRY],
      get_entry_details: () => DETAILS,
      copy_field: () => {
        throw "Locked";
      },
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });
    fireEvent.click(screen.getByRole("button", { name: "Ver detalles" }));
    await screen.findByText("Contraseña");

    fireEvent.click(screen.getByRole("button", { name: "Copiar contraseña" }));

    expect(await screen.findByLabelText("Contraseña maestra")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "GitHub" })).toBeNull();
  });
});