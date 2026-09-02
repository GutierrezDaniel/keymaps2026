// Component tests for the Spanish UI pieces (vault-ui): summary card with the
// category color chip, the details modal with the six Spanish labels and icon
// actions, password masking with reveal/hide, no copy control for the
// category, form validation messages, delete confirmation, the searchbox with
// dropdown filters, and the login backoff countdown.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import type { EntrySummary, CategoryDto } from "./api";
import {
  EntryCard,
  EntryModal,
  DeleteConfirm,
  BackoffNotice,
  MaskedPassword,
  SearchFilters,
  CategoryAdminModal,
  ImportConfirmModal,
} from "./components";

const SUMMARY: EntrySummary = {
  id: "id-1",
  site: "GitHub",
  link: "https://github.com",
  email: "ana@example.com",
  username: "ana",
  category: "trabajo",
};

/** Repository-backed categories fixture (alphabetical, as the backend lists
 *  them): the four seeds with their migration colors. */
const CATEGORIES: CategoryDto[] = [
  { name: "entretenimiento", color: "#7a5220" },
  { name: "estudio", color: "#2f6b3f" },
  { name: "servicios", color: "#6a4a8f" },
  { name: "trabajo", color: "#2f5d8c" },
];

function renderCard(overrides: Partial<Parameters<typeof EntryCard>[0]> = {}) {
  return render(
    <EntryCard entry={SUMMARY} onOpen={() => undefined} {...overrides} />,
  );
}

function renderDetailsModal() {
  return render(
    <EntryModal
      open
      initial={SUMMARY}
      categories={CATEGORIES}
      initialPassword="s3cr3t"
      onSave={() => undefined}
      onCancel={() => undefined}
      onCopy={() => undefined}
      onDelete={() => undefined}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("EntryCard — summary card and category color chip", () => {
  it("shows only the site name and carries the category as a color chip", () => {
    renderCard();
    const card = screen.getByTestId("entry-card");
    expect(within(card).getByText("GitHub")).toBeTruthy();
    expect(card.getAttribute("data-category")).toBe("trabajo");
    expect(screen.getByRole("button", { name: "Ver detalles de GitHub" })).toBeTruthy();
  });

  it("hides plaintext secrets on the summary card", () => {
    renderCard();
    expect(screen.queryByText("s3cr3t")).toBeNull();
    expect(screen.queryByText("ana@example.com")).toBeNull();
  });

  it("calls onOpen when the card is activated", () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Ver detalles de GitHub" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("marks the card as the morph origin when requested", () => {
    renderCard({ morphOrigin: true });
    const card = screen.getByTestId("entry-card");
    expect(card.classList.contains("morph-origin")).toBe(true);
  });

  it("paints the chip with the repository color via the CSS custom property", () => {
    renderCard({ color: "#c05640" });
    const card = screen.getByTestId("entry-card");
    expect(card.style.getPropertyValue("--category-color")).toBe("#c05640");
  });

  it("leaves the CSS variable unset for an unknown category so the fallback applies", () => {
    renderCard();
    const card = screen.getByTestId("entry-card");
    expect(card.style.getPropertyValue("--category-color")).toBe("");
  });
});

describe("EntryModal — unified create/view/edit sheet", () => {
  it("shows all six fields labeled in Spanish for an existing entry", () => {
    renderDetailsModal();
    const dialog = screen.getByRole("dialog", { name: "Formulario de entrada" });
    for (const label of ["Sitio *", "Enlace", "Contraseña *", "Correo", "Usuario", "Categoría"]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "Editar entrada" })).toBeTruthy();
    expect(screen.getByLabelText(/Sitio/)).toHaveProperty("value", "GitHub");
    expect(screen.getByLabelText(/Enlace/)).toHaveProperty("value", "https://github.com");
    expect(screen.getByLabelText(/Correo/)).toHaveProperty("value", "ana@example.com");
    expect(screen.getByLabelText(/Usuario/)).toHaveProperty("value", "ana");
  });

  it("hides plaintext secrets until the password is revealed", () => {
    renderDetailsModal();
    expect(screen.getByLabelText(/Contraseña/)).toHaveProperty("type", "password");
    expect(screen.getByLabelText(/Contraseña/)).toHaveProperty("value", "s3cr3t");
  });

  it("toggles the password visibility with the reveal icon", () => {
    renderDetailsModal();
    const input = screen.getByLabelText(/Contraseña/);
    expect(input).toHaveProperty("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByLabelText(/Contraseña/)).toHaveProperty("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Ocultar" }));
    expect(screen.getByLabelText(/Contraseña/)).toHaveProperty("type", "password");
  });

  it("starts an existing entry prefilled and a new entry empty", () => {
    const { rerender } = render(
      <EntryModal
        open
        initial={SUMMARY}
        categories={CATEGORIES}
        initialPassword="s3cr3t"
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByLabelText(/Sitio/)).toHaveProperty("value", "GitHub");

    // Closing and reopening for a new entry must not leak the previous values.
    rerender(
      <EntryModal
        open={false}
        initial={null}
        categories={CATEGORIES}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    rerender(
      <EntryModal
        open
        initial={null}
        categories={CATEGORIES}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByLabelText(/Sitio/)).toHaveProperty("value", "");
    expect(screen.getByLabelText(/Contraseña/)).toHaveProperty("value", "");
  });

  it("offers icon copy controls for link, password, email and username", () => {
    renderDetailsModal();
    expect(screen.getByRole("button", { name: "Copiar enlace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar contraseña" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar correo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar usuario" })).toBeTruthy();
  });

  it("never offers a copy control for the category field", () => {
    renderDetailsModal();
    const categoryRow = screen.getByText("Categoría").closest(".field-control") as HTMLElement;
    expect(within(categoryRow).queryByRole("button", { name: /Copiar/ })).toBeNull();
  });

  it("exposes delete and close as icon actions for an existing entry", () => {
    renderDetailsModal();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeTruthy();
  });

  it("does not offer copy or delete actions for a new entry", () => {
    render(
      <EntryModal
        open
        initial={null}
        categories={CATEGORIES}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("heading", { name: "Nueva entrada" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copiar contraseña" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
  });
});

describe("EntryModal — Spanish validation", () => {
  it("keeps the modal open and shows a Spanish message for a missing required field", () => {
    const onSave = vi.fn();
    render(
      <EntryModal
        open
        initial={null}
        categories={CATEGORIES}
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("El sitio es obligatorio.")).toBeTruthy();
    expect(screen.getByText("La contraseña es obligatoria.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Formulario de entrada" })).toBeTruthy();
  });

  it("submits a valid form with the six field values", () => {
    const onSave = vi.fn();
    render(
      <EntryModal
        open
        initial={null}
        categories={CATEGORIES}
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Sitio/), { target: { value: "GitLab" } });
    fireEvent.change(screen.getByLabelText(/Enlace/), {
      target: { value: "https://gitlab.com" },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "p4ss" } });
    fireEvent.change(screen.getByLabelText(/Correo/), {
      target: { value: "ana@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Usuario/), { target: { value: "ana" } });
    // The category picker is a themed listbox: open it and pick an option.
    fireEvent.click(screen.getByLabelText(/Categoría/));
    fireEvent.click(screen.getByRole("option", { name: "estudio" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSave).toHaveBeenCalledWith({
      site: "GitLab",
      link: "https://gitlab.com",
      password: "p4ss",
      email: "ana@example.com",
      username: "ana",
      category: "estudio",
    });
  });
});

describe("SearchFilters — site searchbox and icon-triggered dropdowns", () => {
  it("sends the typed site value as a filter from the searchbox", () => {
    const onChange = vi.fn();
    render(<SearchFilters filters={{}} categories={CATEGORIES} emails={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Buscar por sitio"), {
      target: { value: "GitHub" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ site: "GitHub" });
  });

  it("sends null instead of an empty string when the site filter is cleared", () => {
    const onChange = vi.fn();
    render(
      <SearchFilters
        filters={{ site: "GitHub", email: "ana@example.com" }}
        categories={CATEGORIES}
        emails={["ana@example.com"]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Buscar por sitio"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ site: null, email: "ana@example.com" });
  });

  it("opens the email dropdown with every provided email and the all-emails option", () => {
    render(
      <SearchFilters
        filters={{}}
        categories={CATEGORIES}
        emails={["ana@example.com", "bob@example.com"]}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));

    const listbox = screen.getByRole("listbox", { name: "Filtrar por correo" });
    expect(within(listbox).getByRole("option", { name: "Todos los correos" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "ana@example.com" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "bob@example.com" })).toBeTruthy();
  });

  it("emits the selected email as a filter", () => {
    const onChange = vi.fn();
    render(
      <SearchFilters
        filters={{}}
        categories={CATEGORIES}
        emails={["ana@example.com"]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    fireEvent.click(screen.getByRole("option", { name: "ana@example.com" }));

    expect(onChange).toHaveBeenLastCalledWith({ email: "ana@example.com" });
  });

  it("emits null for the email filter when Todos los correos is selected", () => {
    const onChange = vi.fn();
    render(
      <SearchFilters
        filters={{ site: "GitHub", email: "ana@example.com" }}
        categories={CATEGORIES}
        emails={["ana@example.com"]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por correo" }));
    fireEvent.click(screen.getByRole("option", { name: "Todos los correos" }));

    expect(onChange).toHaveBeenCalledWith({ site: "GitHub", email: null });
  });

  it("opens the category dropdown with the repository categories", () => {
    render(<SearchFilters filters={{}} categories={CATEGORIES} emails={[]} onChange={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por categoría" }));

    const listbox = screen.getByRole("listbox", { name: "Filtrar por categoría" });
    expect(within(listbox).getByRole("option", { name: "Todas las categorías" })).toBeTruthy();
    for (const category of CATEGORIES) {
      expect(within(listbox).getByRole("option", { name: category.name })).toBeTruthy();
    }
  });

  it("lists the category options in deterministic alphabetical order", () => {
    render(
      <SearchFilters
        filters={{}}
        categories={[
          { name: "trabajo", color: "#2f5d8c" },
          { name: "Alfa", color: "#c05640" },
          { name: "alfa", color: "#b76e2b" },
        ]}
        emails={[]}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filtrar por categoría" }));

    const listbox = screen.getByRole("listbox", { name: "Filtrar por categoría" });
    const labels = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent);
    // Case-normalized primary order (Alfa/alfa tie) then exact-name tie-break.
    expect(labels).toEqual(["Todas las categorías", "Alfa", "alfa", "trabajo"]);
  });
});

describe("DeleteConfirm — Spanish confirmation", () => {
  it("asks for confirmation in Spanish before removal", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteConfirm entry={SUMMARY} onConfirm={onConfirm} onCancel={onCancel} />);

    expect(screen.getByText("¿Eliminar la entrada «GitHub»?")).toBeTruthy();
    expect(screen.getByText("Esta acción no se puede deshacer.")).toBeTruthy();
  });

  it("removes the entry only after confirming, and cancelling preserves it", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteConfirm entry={SUMMARY} onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("CategoryAdminModal — administration controls", () => {
  function renderAdmin(
    overrides: Partial<Parameters<typeof CategoryAdminModal>[0]> = {},
  ) {
    const props = {
      open: true,
      categories: CATEGORIES,
      usage: { trabajo: 3, estudio: 0 },
      onCreate: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
    render(<CategoryAdminModal {...props} />);
    return props;
  }

  it("lists the categories in deterministic alphabetical order", () => {
    renderAdmin({
      categories: [
        { name: "trabajo", color: "#2f5d8c" },
        { name: "Alfa", color: "#c05640" },
        { name: "alfa", color: "#b76e2b" },
      ],
    });
    const rows = screen.getAllByRole("listitem").map((item) => item.getAttribute("data-category"));
    expect(rows).toEqual(["Alfa", "alfa", "trabajo"]);
  });

  it("offers exactly the 24 palette swatches in the new-category form", () => {
    renderAdmin();
    expect(screen.getAllByRole("radio")).toHaveLength(24);
  });

  it("creates a category with the selected swatch and resets the form", async () => {
    const props = renderAdmin();
    fireEvent.change(screen.getByLabelText("Nombre de la nueva categoría"), {
      target: { value: "lectura" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Color #8a4f7d" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    expect(props.onCreate).toHaveBeenCalledWith({ name: "lectura", color: "#8a4f7d" });
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre de la nueva categoría")).toHaveProperty("value", ""),
    );
  });

  it("rejects a blank name and an exact duplicate with Spanish messages", () => {
    const props = renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(screen.getByText("El nombre de la categoría no puede estar vacío.")).toBeTruthy();
    expect(props.onCreate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Nombre de la nueva categoría"), {
      target: { value: "trabajo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(screen.getByText("Ya existe una categoría con ese nombre.")).toBeTruthy();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("surfaces a backend rejection inline in the create form", async () => {
    const onCreate = vi.fn().mockRejectedValue({ kind: "DuplicateCategory" });
    renderAdmin({ onCreate });
    fireEvent.change(screen.getByLabelText("Nombre de la nueva categoría"), {
      target: { value: "lectura" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    expect(await screen.findByText("Ya existe una categoría con ese nombre.")).toBeTruthy();
  });

  it("applies a recolor instantly without a confirmation dialog", async () => {
    const onUpdate = vi.fn().mockResolvedValue({ status: "applied" });
    renderAdmin({ onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    // The row under edit adds a second swatch grid; scope to the edit row.
    const editRow = screen.getByLabelText("Nombre de trabajo").closest(".category-edit") as HTMLElement;
    fireEvent.click(within(editRow).getByRole("radio", { name: "Color #ad3a2d" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        old_name: "trabajo",
        new_name: "trabajo",
        color: "#ad3a2d",
        confirmed: true,
      }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("confirms a rename with the affected-entry count before applying", async () => {
    const onUpdate = vi
      .fn()
      .mockResolvedValueOnce({ status: "rename_preview", affected_entries: 3 })
      .mockResolvedValueOnce({ status: "applied" });
    renderAdmin({ onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "laburo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        old_name: "trabajo",
        new_name: "laburo",
        color: "#2f5d8c",
        confirmed: false,
      }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Confirmar cambio de nombre" });
    expect(within(dialog).getByText("3 entradas se actualizarán.")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Renombrar" }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        old_name: "trabajo",
        new_name: "laburo",
        color: "#2f5d8c",
        confirmed: true,
      }),
    );
  });

  it("cancelling a rename confirmation leaves the category unchanged", async () => {
    const onUpdate = vi.fn().mockResolvedValue({ status: "rename_preview", affected_entries: 3 });
    renderAdmin({ onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "laburo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    await screen.findByRole("alertdialog", { name: "Confirmar cambio de nombre" });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Only the preview was requested; the draft stays in the edit row.
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Nombre de trabajo")).toHaveProperty("value", "laburo");
  });

  it("disables the trash of an in-use category with an explanatory tooltip", () => {
    const props = renderAdmin({ usage: { trabajo: 3, estudio: 0 } });
    const trash = screen.getByRole("button", { name: "Eliminar trabajo" }) as HTMLButtonElement;
    expect(trash.disabled).toBe(true);
    const wrapper = trash.closest(".tooltip-wrap") as HTMLElement;
    expect(wrapper.getAttribute("data-tooltip")).toBe(
      "3 entradas siguen usando esta categoría.",
    );
    fireEvent.click(trash);
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("protects the last remaining category from deletion", () => {
    const props = renderAdmin({
      categories: [{ name: "trabajo", color: "#2f5d8c" }],
      usage: { trabajo: 0 },
    });
    const trash = screen.getByRole("button", { name: "Eliminar trabajo" }) as HTMLButtonElement;
    expect(trash.disabled).toBe(true);
    const wrapper = trash.closest(".tooltip-wrap") as HTMLElement;
    expect(wrapper.getAttribute("data-tooltip")).toBe("Debe quedar al menos una categoría.");
    fireEvent.click(trash);
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("deletes an unused category after a confirmation showing the count", async () => {
    const props = renderAdmin({ usage: { trabajo: 0, estudio: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "Eliminar trabajo" }));

    const dialog = screen.getByRole("alertdialog", {
      name: "Confirmar eliminación de categoría",
    });
    expect(within(dialog).getByText("0 entradas asociadas. Esta acción no se puede deshacer.")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith("trabajo"));
  });

  it("shows the entry count next to an in-use category row", () => {
    renderAdmin({ usage: { trabajo: 3, estudio: 0 } });
    expect(screen.getByText("3 entradas")).toBeTruthy();
  });
});

describe("ImportConfirmModal — Spanish replacement confirmation", () => {
  it("explains the replacement and offers Cancel/Confirm in Spanish", () => {
    render(<ImportConfirmModal onConfirm={() => undefined} onCancel={() => undefined} />);
    const dialog = screen.getByRole("alertdialog", { name: "Confirmar importación" });
    expect(within(dialog).getByText(/Se reemplazará la bóveda actual/)).toBeTruthy();
    expect(within(dialog).getByText("Esta acción no se puede deshacer.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Importar" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("calls onConfirm from the Importar action and onCancel from Cancelar", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ImportConfirmModal onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Importar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("BackoffNotice — countdown surfacing", () => {
  it("shows the Spanish backoff message with the remaining seconds", () => {
    vi.useFakeTimers();
    render(<BackoffNotice seconds={3} onExpire={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toContain("en 3 segundos");
  });

  it("counts down each second and calls onExpire at zero", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<BackoffNotice seconds={2} onExpire={onExpire} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("alert").textContent).toContain("en 1 segundos");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

describe("MaskedPassword — masking contract", () => {
  it("is masked by default and toggles with Mostrar/Ocultar icons", () => {
    render(<MaskedPassword value="s3cr3t" />);
    expect(screen.getByLabelText("Valor de la contraseña").textContent).toContain("•");

    fireEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByLabelText("Valor de la contraseña").textContent).toBe("s3cr3t");

    fireEvent.click(screen.getByRole("button", { name: "Ocultar" }));
    expect(screen.getByLabelText("Valor de la contraseña").textContent).not.toContain(
      "s3cr3t",
    );
  });
});