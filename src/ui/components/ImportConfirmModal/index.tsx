// Spanish UI component — import replacement confirmation (vault-ui "Import
// replacement confirmation"). All user-visible copy is neutral professional
// Spanish. Presentational: the App owns the import command calls, which keeps
// it testable headless.

export interface ImportConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/** Spanish confirmation shown before a validated backup replaces the active
 *  vault. The copy states the replacement explicitly and offers Cancel and
 *  Confirm actions (vault-import "Validate before replacement"). */
export function ImportConfirmModal({ onConfirm, onCancel }: ImportConfirmProps) {
  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirmar importación"
      >
        <h2>Importar respaldo</h2>
        <p>Se reemplazará la bóveda actual por el respaldo seleccionado.</p>
        <p className="warning">Esta acción no se puede deshacer.</p>
        <div className="modal-actions">
          <button type="button" className="action-button danger" onClick={onConfirm}>
            Importar
          </button>
          <button type="button" className="action-button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
