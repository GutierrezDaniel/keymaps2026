// Component tests for the Spanish UI pieces (vault-ui): summary card with the
// category color chip, the details modal with the six Spanish labels and icon
// actions, password masking with reveal/hide, no copy control for the
// category, form validation messages, delete confirmation, the searchbox with
// dropdown filters, and the login backoff countdown.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import type { EntrySummary, CategoryDto } from "./api";
import {
  EntryCard,
  EntryModal,
  DeleteConfirm,
  BackoffNotice,
  MaskedPassword,
  SearchFilters,
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

  it("passes the card's bounding rect as the modal morph origin", () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Ver detalles de GitHub" }));
    const origin = onOpen.mock.calls[0][0] as DOMRect | null;
    expect(origin).not.toBeNull();
    expect(origin).toHaveProperty("width");
    expect(origin).toHaveProperty("height");
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