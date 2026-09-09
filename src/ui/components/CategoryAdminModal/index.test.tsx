// CategoryAdminModal tests: administration controls (create, recolor, rename
// with the affected-entry count, delete guards) with exact Spanish messages.
// The repository map and usage counts come from the shared CategoriesContext.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { CategoryDto } from "../../api";
import { CategoriesProvider } from "../../contexts/CategoriesContext";
import { CategoryAdminModal } from "./index";

/** Repository-backed categories fixture (alphabetical, as the backend lists
 *  them): the four seeds with their migration colors. */
const CATEGORIES: CategoryDto[] = [
  { name: "entretenimiento", color: "#7a5220" },
  { name: "estudio", color: "#2f6b3f" },
  { name: "servicios", color: "#6a4a8f" },
  { name: "trabajo", color: "#2f5d8c" },
];

function renderAdmin(
  overrides: Partial<Parameters<typeof CategoryAdminModal>[0]> & {
    categories?: CategoryDto[];
    usage?: Record<string, number>;
  } = {},
) {
  const { categories = CATEGORIES, usage = { trabajo: 3, estudio: 0 }, ...props } = overrides;
  const modalProps = {
    open: true,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...props,
  };
  render(
    <CategoriesProvider categories={categories} usage={usage}>
      <CategoryAdminModal {...modalProps} />
    </CategoriesProvider>,
  );
  return modalProps;
}

describe("CategoryAdminModal — administration controls", () => {

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

describe("CategoryAdminModal — edit and error paths", () => {
  it("rejects a blank edited name with a Spanish message", () => {
    const props = renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(screen.getByText("El nombre de la categoría no puede estar vacío.")).toBeTruthy();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("rejects renaming to an existing category with a Spanish message", () => {
    const props = renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "estudio" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(screen.getByText("Ya existe una categoría con ese nombre.")).toBeTruthy();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("applies a rename whose preview already resolved as applied (no dialog)", async () => {
    const onUpdate = vi.fn().mockResolvedValue({ status: "applied" });
    renderAdmin({ onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "laburo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ confirmed: false }),
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("surfaces an edit rejection inline with a Spanish message", async () => {
    const onUpdate = vi.fn().mockRejectedValue({ kind: "DuplicateCategory" });
    renderAdmin({ onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "laburo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    expect(await screen.findByText("Ya existe una categoría con ese nombre.")).toBeTruthy();
  });

  it("ignores a Locked edit rejection (the App locks the screen)", async () => {
    const onUpdate = vi.fn().mockRejectedValue({ kind: "Locked" });
    renderAdmin({ onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "laburo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(screen.queryByText("Ocurrió un error inesperado.")).toBeNull();
  });

  it("surfaces a confirmed-rename rejection inline", async () => {
    const onUpdate = vi
      .fn()
      .mockResolvedValueOnce({ status: "rename_preview", affected_entries: 1 })
      .mockRejectedValueOnce({ kind: "CategoryNotFound" });
    renderAdmin({ onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "laburo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Confirmar cambio de nombre",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Renombrar" }));
    expect(await screen.findByText("La categoría ya no existe.")).toBeTruthy();
  });

  it("ignores a Locked confirmed-rename rejection", async () => {
    const onUpdate = vi
      .fn()
      .mockResolvedValueOnce({ status: "rename_preview", affected_entries: 1 })
      .mockRejectedValueOnce({ kind: "Locked" });
    renderAdmin({ onUpdate });
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "laburo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Confirmar cambio de nombre",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Renombrar" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Ocurrió un error inesperado.")).toBeNull();
  });

  it("surfaces a delete rejection in the action banner", async () => {
    const onDelete = vi.fn().mockRejectedValue({ kind: "CategoryInUse" });
    renderAdmin({ onDelete, usage: { trabajo: 0, estudio: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "Eliminar trabajo" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("La categoría está en uso y no se puede eliminar.")).toBeTruthy();
  });

  it("ignores a Locked delete rejection", async () => {
    const onDelete = vi.fn().mockRejectedValue({ kind: "Locked" });
    renderAdmin({ onDelete, usage: { trabajo: 0, estudio: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "Eliminar trabajo" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("trabajo"));
    expect(screen.queryByText("Ocurrió un error inesperado.")).toBeNull();
  });

  it("cancels the delete confirmation without calling onDelete", () => {
    const props = renderAdmin({ usage: { trabajo: 0, estudio: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "Eliminar trabajo" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Confirmar eliminación de categoría",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("shows zero associated entries when the category has no usage row", () => {
    renderAdmin({ usage: {} });
    fireEvent.click(screen.getByRole("button", { name: "Eliminar trabajo" }));
    expect(
      screen.getByText("0 entradas asociadas. Esta acción no se puede deshacer."),
    ).toBeTruthy();
  });

  it("cancels an edit and reverts the row", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Editar trabajo" }));
    fireEvent.change(screen.getByLabelText("Nombre de trabajo"), {
      target: { value: "laburo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edición" }));
    expect(screen.queryByLabelText("Nombre de trabajo")).toBeNull();
    expect(screen.getByText("trabajo")).toBeTruthy();
  });

  it("normalizes a raw create rejection through the generic fallback", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("boom"));
    renderAdmin({ onCreate });
    fireEvent.change(screen.getByLabelText("Nombre de la nueva categoría"), {
      target: { value: "lectura" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(await screen.findByText("Ocurrió un error inesperado.")).toBeTruthy();
  });

  it("ignores a Locked create rejection", async () => {
    const onCreate = vi.fn().mockRejectedValue({ kind: "Locked" });
    renderAdmin({ onCreate });
    fireEvent.change(screen.getByLabelText("Nombre de la nueva categoría"), {
      target: { value: "lectura" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(screen.queryByText("Ocurrió un error inesperado.")).toBeNull();
  });
});