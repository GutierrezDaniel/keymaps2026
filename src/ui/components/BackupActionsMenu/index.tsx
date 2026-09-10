// Spanish UI component — the unlocked header's Download trigger opens a
// dropdown with the export/import backup actions (user correction,
// post-verify). All user-visible copy is neutral professional Spanish.
// Presentational: owns only its open state; the App wires the callbacks —
// which keeps it testable headless. Overlay dismissal (outside click, Escape,
// unmount cleanup) is the shared `useDismissable`.
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useDismissable } from "../../helpers/useDismissable";

export interface BackupActionsMenuProps {
  onExport: () => void;
  onImport: () => void;
}

/** Download trigger + dropdown for the vault backup actions. Opens on trigger
 *  click, closes on outside click, Escape, or after selecting an item. */
export function BackupActionsMenu({ onExport, onImport }: BackupActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useDismissable(open, rootRef, () => setOpen(false));

  function closeAfter(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="backup-actions" ref={rootRef}>
      <button
        type="button"
        className="icon-button"
        aria-label="Acciones de respaldo"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Download size={18} />
      </button>
      {open && (
        <div className="backup-actions-menu" role="menu" aria-label="Acciones de respaldo">
          <button
            type="button"
            role="menuitem"
            className="backup-actions-item"
            onClick={() => closeAfter(onExport)}
          >
            <Download size={15} aria-hidden="true" />
            Exportar respaldo
          </button>
          <button
            type="button"
            role="menuitem"
            className="backup-actions-item"
            onClick={() => closeAfter(onImport)}
          >
            <Upload size={15} aria-hidden="true" />
            Importar respaldo
          </button>
        </div>
      )}
    </div>
  );
}
