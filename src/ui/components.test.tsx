// Component tests for the Spanish UI pieces (vault-ui): card flip with the
// six Spanish labels, password masking with reveal/hide, no copy control for
// the category, form validation messages, delete confirmation, and the login
// backoff countdown.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import type { EntrySummary, EntryDetails } from "./api";
import {
  EntryCard,
  EntryFormModal,
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

const DETAILS: EntryDetails = { summary: SUMMARY, password: "s3cr3t" };

function renderCard(overrides: Partial<Parameters<typeof EntryCard>[0]> = {}) {
  return render(
    <EntryCard
      entry={SUMMARY}
      details={DETAILS}
      flipped={false}
      onToggleFlip={() => undefined}
      onCopy={() => undefined}
      onEdit={() => undefined}
      onDelete={() => undefined}
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("EntryCard — Spanish labels and flip", () => {
  it("shows the site and category on the front side", () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "GitHub" })).toBeTruthy();
    const front = screen.getByRole("heading", { name: "GitHub" }).closest(".card-front") as HTMLElement;
    expect(within(front).getByText("trabajo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver detalles" })).toBeTruthy();
  });

  it("flips to a detail side with all six fields labeled in Spanish", () => {
    renderCard({ flipped: true });
    const back = screen.getByText("Sitio").closest(".card-back") as HTMLElement;
    for (const label of ["Sitio", "Enlace", "Contraseña", "Correo", "Usuario", "Categoría"]) {
      expect(within(back).getByText(label)).toBeTruthy();
    }
    expect(within(back).getByText("GitHub")).toBeTruthy();
    expect(within(back).getByText("https://github.com")).toBeTruthy();
    expect(within(back).getByText("ana@example.com")).toBeTruthy();
    expect(within(back).getByText("ana")).toBeTruthy();
    expect(within(back).getByRole("button", { name: "Ver resumen" })).toBeTruthy();
  });

  it("hides plaintext secrets on the front side", () => {
    renderCard();
    expect(screen.queryByText("s3cr3t")).toBeNull();
  });
});

describe("EntryCard — password masking", () => {
  it("masks the password by default on the detail side", () => {
    renderCard({ flipped: true });
    const value = screen.getByLabelText("Valor de la contraseña");
    expect(value.textContent).not.toContain("s3cr3t");
    expect(value.textContent).toContain("•");
  });

  it("reveals the password with Mostrar and hides it again with Ocultar", () => {
    renderCard({ flipped: true });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByLabelText("Valor de la contraseña").textContent).toBe("s3cr3t");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar" }));
    expect(screen.getByLabelText("Valor de la contraseña").textContent).not.toContain(
      "s3cr3t",
    );
  });

  it("never offers a copy control for the category field", () => {
    renderCard({ flipped: true });
    const categoryRow = screen.getByText("Categoría").closest(".field-row") as HTMLElement;
    expect(within(categoryRow).queryByRole("button")).toBeNull();
  });
});

describe("EntryFormModal — Spanish validation", () => {
  it("keeps the modal open and shows a Spanish message for a missing required field", () => {
    const onSave = vi.fn();
    render(<EntryFormModal open initial={null} onSave={onSave} onCancel={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("El sitio es obligatorio.")).toBeTruthy();
    expect(screen.getByText("La contraseña es obligatoria.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Formulario de entrada" })).toBeTruthy();
  });

  it("submits a valid form with the six field values", () => {
    const onSave = vi.fn();
    render(<EntryFormModal open initial={null} onSave={onSave} onCancel={() => undefined} />);

    fireEvent.change(screen.getByLabelText(/Sitio/), { target: { value: "GitLab" } });
    fireEvent.change(screen.getByLabelText(/Enlace/), {
      target: { value: "https://gitlab.com" },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: "p4ss" } });
    fireEvent.change(screen.getByLabelText(/Correo/), {
      target: { value: "ana@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Usuario/), { target: { value: "ana" } });
    fireEvent.change(screen.getByLabelText(/Categoría/), { target: { value: "estudio" } });
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

describe("SearchFilters — site search and email/category selects", () => {
  it("sends the typed site value as a filter", () => {
    const onChange = vi.fn();
    render(<SearchFilters filters={{}} emails={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Buscar por sitio"), {
      target: { value: "GitHub" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ site: "GitHub" });
  });

  it("renders the email select with every provided email and the all-emails option", () => {
    render(
      <SearchFilters
        filters={{}}
        emails={["ana@example.com", "bob@example.com"]}
        onChange={() => undefined}
      />,
    );

    const emailSelect = screen.getByLabelText("Filtrar por correo") as HTMLSelectElement;
    expect(emailSelect.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Todos los correos" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "ana@example.com" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "bob@example.com" })).toBeTruthy();
  });

  it("emits the selected email as a filter", () => {
    const onChange = vi.fn();
    render(
      <SearchFilters filters={{}} emails={["ana@example.com"]} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText("Filtrar por correo"), {
      target: { value: "ana@example.com" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ email: "ana@example.com" });
  });

  it("emits null for the email filter when Todos los correos is selected", () => {
    const onChange = vi.fn();
    render(
      <SearchFilters
        filters={{ site: "GitHub", email: "ana@example.com" }}
        emails={["ana@example.com"]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filtrar por correo"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({ site: "GitHub", email: null });
  });

  it("sends null instead of an empty string when the site filter is cleared", () => {
    const onChange = vi.fn();
    render(
      <SearchFilters
        filters={{ site: "GitHub", email: "ana@example.com" }}
        emails={["ana@example.com"]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Buscar por sitio"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ site: null, email: "ana@example.com" });
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
  it("is masked by default and toggles with Mostrar/Ocultar", () => {
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