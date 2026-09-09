// Spanish UI component — vault-ui "Deletion confirmation": the confirmation
// step shown before an entry is removed. All user-visible copy is neutral
// professional Spanish. Presentational: it receives the entry and the confirm
// / cancel callbacks, and never talks to the backend directly — which keeps
// it testable headless.
import type { EntrySummary } from "../../api";

export interface DeleteConfirmProps {
  entry: EntrySummary;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Spanish confirmation step shown before an entry is removed. */
export function DeleteConfirm({ entry, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-label="Confirmar eliminación">
        <h2>Eliminar entrada</h2>
        <p>¿Eliminar la entrada «{entry.site}»?</p>
        <p className="warning">Esta acción no se puede deshacer.</p>
        <div className="modal-actions">
          <button type="button" className="action-button danger" onClick={onConfirm}>
            Eliminar
          </button>
          <button type="button" className="action-button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
