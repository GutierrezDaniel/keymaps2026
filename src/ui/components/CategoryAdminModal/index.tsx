// Spanish UI component — the category administration modal
// (category-administration spec). All user-visible copy is neutral
// professional Spanish. Presentational: receives the open flag and callbacks;
// its repository map and per-category entry counts come from the shared
// CategoriesContext, and it never talks to the backend directly — which
// keeps it testable headless.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { CATEGORY_PALETTE, toCommandError } from "../../api";
import type {
  CategoryDto,
  UpdateCategoryRequest,
  UpdateCategoryResult,
  CommandError,
} from "../../api";
import { useCategories } from "../../contexts/CategoriesContext";
import { categoryErrorMessage } from "../../helpers/spanishMessages";
import { sortCategories } from "../../helpers/sortCategories";
import { SwatchGrid } from "../SwatchGrid";

/** Normalize a callback rejection into a typed [`CommandError`]. App handlers
 *  rethrow already-normalized errors, so a `{ kind }` payload passes through;
 *  anything else (raw Tauri shapes, test rejects) goes through
 *  [`toCommandError`]. */
function commandErrorFrom(raw: unknown): CommandError {
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as CommandError).kind === "string"
  ) {
    return raw as CommandError;
  }
  return toCommandError(raw);
}

export interface CategoryAdminModalProps {
  open: boolean;
  onCreate: (category: CategoryDto) => Promise<void>;
  onUpdate: (request: UpdateCategoryRequest) => Promise<UpdateCategoryResult>;
  onDelete: (name: string) => Promise<void>;
  onClose: () => void;
}

interface RenamePending {
  old_name: string;
  new_name: string;
  color: string;
  affected_entries: number;
}

/** Category administration: create, rename (confirmed), recolor (instant) and
 *  delete (unused only, confirmed) against the repository map. */
export function CategoryAdminModal({
  open,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: CategoryAdminModalProps) {
  const { categories, usage } = useCategories();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(CATEGORY_PALETTE[0]);
  const [newError, setNewError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<string>(CATEGORY_PALETTE[0]);
  const [editError, setEditError] = useState<string | null>(null);
  const [renameConfirm, setRenameConfirm] = useState<RenamePending | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fresh state every time the modal opens: no stale drafts, errors or
  // pending confirmations leak between sessions.
  useEffect(() => {
    if (!open) return;
    setNewName("");
    setNewColor(CATEGORY_PALETTE[0]);
    setNewError(null);
    setEditingName(null);
    setDraftName("");
    setDraftColor("");
    setEditError(null);
    setRenameConfirm(null);
    setDeleteConfirm(null);
    setActionError(null);
  }, [open]);

  if (!open) return null;

  /** Why the trash of this category is disabled, or null when deletable:
   *  in-use categories and the last remaining category cannot be removed
   *  (the backend enforces both; the UI prevents the action first). */
  function deleteBlockReason(name: string): string | null {
    const count = usage[name] ?? 0;
    if (count > 0) {
      return count === 1
        ? "1 entrada sigue usando esta categoría."
        : `${count} entradas siguen usando esta categoría.`;
    }
    if (categories.length <= 1) return "Debe quedar al menos una categoría.";
    return null;
  }

  function startEdit(category: CategoryDto) {
    setEditingName(category.name);
    setDraftName(category.name);
    setDraftColor(category.color);
    setEditError(null);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (name === "") {
      setNewError("El nombre de la categoría no puede estar vacío.");
      return;
    }
    if (categories.some((category) => category.name === name)) {
      setNewError("Ya existe una categoría con ese nombre.");
      return;
    }
    setNewError(null);
    try {
      await onCreate({ name, color: newColor });
      setNewName("");
      setNewColor(CATEGORY_PALETTE[0]);
    } catch (raw) {
      const commandError = commandErrorFrom(raw);
      if (commandError.kind !== "Locked") setNewError(categoryErrorMessage(commandError));
    }
  }

  /** Commit the row being edited. Same-name saves are recolors and apply
   *  directly (confirmed, no dialog); renames go through the backend preview
   *  and only write after the user confirms the affected-entry count. */
  async function handleSaveEdit() {
    const oldName = editingName;
    // Dead defensively: the only caller is the edit-row save button, which
    // renders solely while editingName is set.
    /* v8 ignore next -- @preserve */
    if (oldName === null) return;
    const name = draftName.trim();
    if (name === "") {
      setEditError("El nombre de la categoría no puede estar vacío.");
      return;
    }
    if (name !== oldName && categories.some((category) => category.name === name)) {
      setEditError("Ya existe una categoría con ese nombre.");
      return;
    }
    setEditError(null);
    try {
      if (name === oldName) {
        await onUpdate({ old_name: oldName, new_name: oldName, color: draftColor, confirmed: true });
        setEditingName(null);
      } else {
        const result = await onUpdate({
          old_name: oldName,
          new_name: name,
          color: draftColor,
          confirmed: false,
        });
        if (result.status === "rename_preview") {
          setRenameConfirm({
            old_name: oldName,
            new_name: name,
            color: draftColor,
            affected_entries: result.affected_entries,
          });
        }
      }
    } catch (raw) {
      const commandError = commandErrorFrom(raw);
      if (commandError.kind !== "Locked") setEditError(categoryErrorMessage(commandError));
    }
  }

  async function confirmRename() {
    const pending = renameConfirm;
    // Dead defensively: the Renombrar button renders only while renameConfirm
    // is set, so a click always observes a pending confirmation.
    /* v8 ignore next -- @preserve */
    if (!pending) return;
    setRenameConfirm(null);
    try {
      await onUpdate({
        old_name: pending.old_name,
        new_name: pending.new_name,
        color: pending.color,
        confirmed: true,
      });
      setEditingName(null);
    } catch (raw) {
      const commandError = commandErrorFrom(raw);
      if (commandError.kind !== "Locked") setEditError(categoryErrorMessage(commandError));
    }
  }

  async function confirmDelete() {
    // Dead defensively: the Eliminar button renders only while deleteConfirm
    // is set, so a click always observes a pending deletion.
    /* v8 ignore next -- @preserve */
    if (deleteConfirm === null) return;
    const name = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await onDelete(name);
    } catch (raw) {
      const commandError = commandErrorFrom(raw);
      if (commandError.kind !== "Locked") setActionError(categoryErrorMessage(commandError));
    }
  }

  const sorted = sortCategories(categories);

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal category-admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Administrar categorías"
      >
        <div className="details-head">
          <h2>Administrar categorías</h2>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {actionError && (
          <p className="field-error" role="alert">
            {actionError}
          </p>
        )}

        <h3 className="category-new-title">Nueva categoría</h3>
        <form className="category-new-form" onSubmit={(event) => void handleCreate(event)}>
          <div className="category-new-head">
            <input
              type="text"
              className="category-name-input"
              placeholder="Nombre de la nueva categoría"
              aria-label="Nombre de la nueva categoría"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" className="action-button primary">
              Agregar
            </button>
          </div>
          <SwatchGrid value={newColor} onSelect={setNewColor} />
          {newError && (
            <p className="field-error" role="alert">
              {newError}
            </p>
          )}
        </form>

        <ul className="category-list">
          {sorted.map((category) => {
            const editing = editingName === category.name;
            const blockReason = deleteBlockReason(category.name);
            const trash = (
              <button
                type="button"
                className="icon-button danger"
                aria-label={`Eliminar ${category.name}`}
                disabled={blockReason !== null}
                onClick={() => setDeleteConfirm(category.name)}
              >
                <Trash2 size={15} />
              </button>
            );
            return (
              <li key={category.name} className="category-row" data-category={category.name}>
                {editing ? (
                  <div className="category-edit">
                    <div className="category-edit-head">
                      <span
                        className="category-dot"
                        style={{ background: draftColor }}
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        className="category-name-input"
                        aria-label={`Nombre de ${category.name}`}
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                      <span className="category-row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Guardar nombre"
                          onClick={() => void handleSaveEdit()}
                        >
                          <Check size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Cancelar edición"
                          onClick={() => setEditingName(null)}
                        >
                          <X size={15} />
                        </button>
                      </span>
                    </div>
                    {editError && (
                      <p className="field-error" role="alert">
                        {editError}
                      </p>
                    )}
                    <SwatchGrid value={draftColor} onSelect={setDraftColor} />
                  </div>
                ) : (
                  <div className="category-row-main">
                    <span
                      className="category-dot"
                      style={{ background: category.color }}
                      aria-hidden="true"
                    />
                    <span className="category-row-name">{category.name}</span>
                    {(usage[category.name] ?? 0) > 0 && (
                      <span className="category-count">
                        {usage[category.name]} {usage[category.name] === 1 ? "entrada" : "entradas"}
                      </span>
                    )}
                    <span className="category-row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Editar ${category.name}`}
                        onClick={() => startEdit(category)}
                      >
                        <Pencil size={15} />
                      </button>
                      {blockReason !== null ? (
                        <span className="tooltip-wrap" data-tooltip={blockReason}>
                          {trash}
                        </span>
                      ) : (
                        trash
                      )}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {renameConfirm !== null && (
          <div className="modal-overlay" role="presentation">
            <div
              className="modal"
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirmar cambio de nombre"
            >
              <h2>Renombrar categoría</h2>
              <p>
                ¿Renombrar «{renameConfirm.old_name}» a «{renameConfirm.new_name}»?
              </p>
              <p>
                {renameConfirm.affected_entries === 1
                  ? "1 entrada se actualizará."
                  : `${renameConfirm.affected_entries} entradas se actualizarán.`}
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="action-button primary"
                  onClick={() => void confirmRename()}
                >
                  Renombrar
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={() => setRenameConfirm(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteConfirm !== null && (
          <div className="modal-overlay" role="presentation">
            <div
              className="modal"
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirmar eliminación de categoría"
            >
              <h2>Eliminar categoría</h2>
              <p>¿Eliminar la categoría «{deleteConfirm}»?</p>
              <p>
                {usage[deleteConfirm] ?? 0} entradas asociadas. Esta acción no se puede deshacer.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="action-button danger"
                  onClick={() => void confirmDelete()}
                >
                  Eliminar
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={() => setDeleteConfirm(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
