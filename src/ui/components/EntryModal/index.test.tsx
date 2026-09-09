// EntryModal tests: the unified create/view/edit sheet with the six Spanish
// labels and icon actions, plus Spanish form validation messages. The picker
// options come from the shared CategoriesContext (repository map).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { EntrySummary, CategoryDto } from "../../api";
import { CategoriesProvider } from "../../contexts/CategoriesContext";
import { EntryModal } from "./index";

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

function tree(props: Parameters<typeof EntryModal>[0]) {
  return (
    <CategoriesProvider categories={CATEGORIES} usage={{}}>
      <EntryModal {...props} />
    </CategoriesProvider>
  );
}

function renderDetailsModal() {
  return render(
    tree({
      open: true,
      initial: SUMMARY,
      initialPassword: "s3cr3t",
      onSave: () => undefined,
      onCancel: () => undefined,
      onCopy: () => undefined,
      onDelete: () => undefined,
    }),
  );
}

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
      tree({
        open: true,
        initial: SUMMARY,
        initialPassword: "s3cr3t",
        onSave: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(screen.getByLabelText(/Sitio/)).toHaveProperty("value", "GitHub");

    // Closing and reopening for a new entry must not leak the previous values.
    rerender(
      tree({
        open: false,
        initial: null,
        onSave: () => undefined,
        onCancel: () => undefined,
      }),
    );
    rerender(
      tree({
        open: true,
        initial: null,
        onSave: () => undefined,
        onCancel: () => undefined,
      }),
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
      tree({
        open: true,
        initial: null,
        onSave: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(screen.getByRole("heading", { name: "Nueva entrada" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copiar contraseña" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
  });
});

describe("EntryModal — copy field controls", () => {
  it("copies the email field", () => {
    const onCopy = vi.fn();
    render(
      tree({
        open: true,
        initial: SUMMARY,
        initialPassword: "s3cr3t",
        onSave: () => undefined,
        onCancel: () => undefined,
        onCopy,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copiar correo" }));
    expect(onCopy).toHaveBeenCalledWith("email");
  });

  it("copies the username field", () => {
    const onCopy = vi.fn();
    render(
      tree({
        open: true,
        initial: SUMMARY,
        initialPassword: "s3cr3t",
        onSave: () => undefined,
        onCancel: () => undefined,
        onCopy,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copiar usuario" }));
    expect(onCopy).toHaveBeenCalledWith("username");
  });

  it("copies the link field", () => {
    const onCopy = vi.fn();
    render(
      tree({
        open: true,
        initial: SUMMARY,
        initialPassword: "s3cr3t",
        onSave: () => undefined,
        onCancel: () => undefined,
        onCopy,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));
    expect(onCopy).toHaveBeenCalledWith("link");
  });
});

describe("EntryModal — morphing and category defaults", () => {
  it("adds the morphing class while a view transition morphs the sheet in", () => {
    render(
      tree({
        open: true,
        initial: null,
        morphing: true,
        onSave: () => undefined,
        onCancel: () => undefined,
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Formulario de entrada" });
    expect(dialog.className).toContain("morphing");
  });

  it("defaults a new entry's category to the first repository category", () => {
    render(
      tree({
        open: true,
        initial: null,
        onSave: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(screen.getByLabelText(/Categoría/).textContent).toBe("entretenimiento");
  });

  it("defaults a new entry's category to empty when no categories exist", () => {
    render(
      <CategoriesProvider categories={[]} usage={{}}>
        <EntryModal
          open
          initial={null}
          onSave={() => undefined}
          onCancel={() => undefined}
        />
      </CategoriesProvider>,
    );
    expect(screen.getByLabelText(/Categoría/).textContent).toBe("");
  });
});

describe("EntryModal — Spanish validation", () => {
  it("keeps the modal open and shows a Spanish message for a missing required field", () => {
    const onSave = vi.fn();
    render(
      tree({
        open: true,
        initial: null,
        onSave,
        onCancel: () => undefined,
      }),
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
      tree({
        open: true,
        initial: null,
        onSave,
        onCancel: () => undefined,
      }),
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