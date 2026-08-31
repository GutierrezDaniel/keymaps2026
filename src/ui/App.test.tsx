// App-level tests for the Spanish screens (vault-ui): boot resolution,
// irreversible-loss warnings, vault creation (which does not auto-unlock),
// login errors and backoff, explicit lock, auto-lock surfacing, details modal,
// copy, delete confirmation and the entry form save path.
//
// The Tauri IPC module is mocked so everything runs headless in jsdom; the
// typed client (`./api`) routes through the same mocked invoke.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { EntrySummary, EntryDetails, CategoryDto } from "./api";

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

/** Repository category map (deterministic alphabetical order, as the backend
 *  lists it): the four seeds with their migration colors. */
const CATEGORIES: CategoryDto[] = [
  { name: "entretenimiento", color: "#7a5220" },
  { name: "estudio", color: "#2f6b3f" },
  { name: "servicios", color: "#6a4a8f" },
  { name: "trabajo", color: "#2f5d8c" },
];

/** Route mocked invoke by command name. Handlers throw to reject. An unlisted
 *  `list_emails` route resolves to an empty list: the App loads the email
 *  selector on every boot and refresh, and unrelated tests don't care. */
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

/** Boot straight into an unlocked vault. The category map and the email
 *  selector load with the vault, so both routes are registered. */
function bootUnlocked() {
  mockRoutes({
    list: () => [ENTRY],
    list_categories: () => CATEGORIES,
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

async function openDetailsModal(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Ver detalles de GitHub" }));
  await screen.findByRole("dialog", { name: "Formulario de entrada" });
}

describe("App — boot resolution", () => {
  it("shows the vault with summary cards when boot list succeeds", async () => {
    bootUnlocked();
    expect(await screen.findByRole("heading", { name: "Mi bóveda" })).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
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
      list_categories: () => CATEGORIES,
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
      list_categories: () => CATEGORIES,
      lock: () => undefined,
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    fireEvent.click(screen.getByRole("button", { name: "Bloquear" }));

    expect(mockedInvoke).toHaveBeenCalledWith("lock");
    expect(await screen.findByLabelText("Contraseña maestra")).toBeTruthy();
    expect(screen.getByText(/pérdida irreversible/i)).toBeTruthy();
    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("opens the unified entry modal on card click, fetches details and keeps the password masked", async () => {
    mockRoutes({
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
      get_entry_details: () => DETAILS,
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    await openDetailsModal();

    expect(mockedInvoke).toHaveBeenCalledWith("get_entry_details", { id: "id-1" });
    const dialog = screen.getByRole("dialog", { name: "Formulario de entrada" });
    expect(within(dialog).getByRole("heading", { name: "Editar entrada" })).toBeTruthy();
    expect(within(dialog).getByLabelText(/Contraseña/)).toHaveProperty("type", "password");
    expect(within(dialog).getByLabelText(/Contraseña/)).toHaveProperty("value", "s3cr3t");
  });

  it("copies a field through the command surface and shows Copiado", async () => {
    mockRoutes({
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
      get_entry_details: () => DETAILS,
      copy_field: () => undefined,
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });
    await openDetailsModal();

    fireEvent.click(screen.getByRole("button", { name: "Copiar contraseña" }));

    expect(mockedInvoke).toHaveBeenCalledWith("copy_field", { id: "id-1", field: "password" });
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeTruthy();
  });

  it("confirms deletion in Spanish, plays the leave animation and refreshes the list", async () => {
    let listResult: EntrySummary[] = [ENTRY];
    mockRoutes({
      list: () => listResult,
      list_categories: () => CATEGORIES,
      get_entry_details: () => DETAILS,
      delete: () => {
        listResult = [];
      },
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });
    await openDetailsModal();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(screen.getByText("¿Eliminar la entrada «GitHub»?")).toBeTruthy();
    expect(screen.getByText("Esta acción no se puede deshacer.")).toBeTruthy();

    const confirmDialog = screen.getByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Eliminar" }));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("delete", { id: "id-1" }),
    );
    expect(await screen.findByText(/Aún no hay entradas/)).toBeTruthy();
    // The details modal must close once the entry is gone.
    expect(screen.queryByRole("dialog", { name: "Formulario de entrada" })).toBeNull();
  });

  it("pre-fills the unified modal from the entry when a card is opened", async () => {
    mockRoutes({
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
      get_entry_details: () => DETAILS,
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    await openDetailsModal();

    const dialog = screen.getByRole("dialog", { name: "Formulario de entrada" });
    expect(within(dialog).getByRole("heading", { name: "Editar entrada" })).toBeTruthy();
    expect(within(dialog).getByLabelText(/Sitio/)).toHaveProperty("value", "GitHub");
    expect(within(dialog).getByLabelText(/Enlace/)).toHaveProperty("value", "https://github.com");
    expect(within(dialog).getByLabelText(/Correo/)).toHaveProperty("value", "ana@example.com");
    expect(within(dialog).getByLabelText(/Usuario/)).toHaveProperty("value", "ana");
    expect(within(dialog).getByLabelText(/Categoría/).textContent).toBe("trabajo");
    // Details were fetched before editing, so the decrypted password also
    // pre-fills (initialPassword flows from the cached details).
    expect(within(dialog).getByLabelText(/Contraseña/)).toHaveProperty("value", "s3cr3t");
  });

  it("saves a new entry from the form modal", async () => {
    mockRoutes({
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
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

  it("opens a clean new-entry form after a save (no stale inputs)", async () => {
    mockRoutes({
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
      create: () => "id-2",
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    fireEvent.click(screen.getByRole("button", { name: "Nueva entrada" }));
    fireEvent.change(screen.getByLabelText(/Sitio/), { target: { value: "GitLab" } });
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "p4ss" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Formulario de entrada" })).toBeNull(),
    );

    // Reopen: the fields must be empty, not the previously typed values.
    fireEvent.click(screen.getByRole("button", { name: "Nueva entrada" }));
    expect(screen.getByRole("dialog", { name: "Formulario de entrada" })).toBeTruthy();
    expect(screen.getByLabelText(/Sitio/)).toHaveProperty("value", "");
    expect(screen.getByLabelText(/Contraseña/)).toHaveProperty("value", "");
  });

  it("loads the distinct emails into the email dropdown when unlocked", async () => {
    mockRoutes({
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
      list_emails: () => ["ana@example.com", "bob@example.com"],
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    expect(mockedInvoke).toHaveBeenCalledWith("list_emails");
    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    const listbox = screen.getByRole("listbox", { name: "Filtrar por correo" });
    expect(within(listbox).getByRole("option", { name: "Todos los correos" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "ana@example.com" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "bob@example.com" })).toBeTruthy();
  });

  it("loads the repository categories into the category filter dropdown when unlocked", async () => {
    bootUnlocked();
    await screen.findByRole("heading", { name: "Mi bóveda" });

    expect(mockedInvoke).toHaveBeenCalledWith("list_categories");
    fireEvent.click(screen.getByRole("button", { name: "Filtrar por categoría" }));
    const listbox = screen.getByRole("listbox", { name: "Filtrar por categoría" });
    for (const category of CATEGORIES) {
      expect(within(listbox).getByRole("option", { name: category.name })).toBeTruthy();
    }
  });

  it("paints entry cards with the mapped category color and falls back for unknown categories", async () => {
    const unknownEntry: EntrySummary = { ...ENTRY, id: "id-2", site: "Ghost", category: "fantasma" };
    mockRoutes({
      list: () => [ENTRY, unknownEntry],
      list_categories: () => CATEGORIES,
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    const cards = screen.getAllByTestId("entry-card");
    const knownCard = cards.find((card) => card.getAttribute("data-category") === "trabajo") as HTMLElement;
    const unknownCard = cards.find((card) => card.getAttribute("data-category") === "fantasma") as HTMLElement;
    // Known category → the repository color (trabajo → #2f5d8c).
    expect(knownCard.style.getPropertyValue("--category-color")).toBe("#2f5d8c");
    // Unknown category → no inline variable, so the CSS fallback token applies.
    expect(unknownCard.style.getPropertyValue("--category-color")).toBe("");
  });

  it("filters the vault list when an email is selected in the dropdown", async () => {
    mockRoutes({
      list: (args) => {
        const filters = (args as { filters?: { email?: string | null } } | undefined)
          ?.filters;
        if (filters?.email) return [];
        return [ENTRY];
      },
      list_categories: () => CATEGORIES,
      list_emails: () => ["ana@example.com"],
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    fireEvent.click(screen.getByRole("option", { name: "ana@example.com" }));

    expect(mockedInvoke).toHaveBeenCalledWith("list", {
      filters: { email: "ana@example.com" },
    });
    expect(
      await screen.findByText(/No hay entradas que coincidan con la búsqueda/),
    ).toBeTruthy();
  });

  it("returns to the locked screen when a command reports the vault auto-locked", async () => {
    mockRoutes({
      list: () => [ENTRY],
      list_categories: () => CATEGORIES,
      get_entry_details: () => DETAILS,
      copy_field: () => {
        throw "Locked";
      },
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Mi bóveda" });
    await openDetailsModal();

    fireEvent.click(screen.getByRole("button", { name: "Copiar contraseña" }));

    expect(await screen.findByLabelText("Contraseña maestra")).toBeTruthy();
    expect(screen.queryByText("GitHub")).toBeNull();
  });
});