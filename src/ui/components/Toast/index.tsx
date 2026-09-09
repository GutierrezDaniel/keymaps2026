// Spanish UI component — transient success/error feedback banner that
// auto-dismisses (vault-backup / vault-import feedback). All user-visible
// copy is neutral professional Spanish. Presentational: the App owns the
// toast state and its single auto-clear timer; this component owns only its
// own dismiss timer and the manual close button — which keeps it testable
// headless.
import { useEffect } from "react";
import { X } from "lucide-react";

/** How long a toast stays visible before auto-dismissing. */
export const TOAST_DURATION_MS = 3500;

export interface ToastProps {
  kind: "success" | "error";
  message: string;
  onDismiss: () => void;
}

/** Transient feedback banner: success reads as a polite status, error as an
 *  assertive alert. Auto-dismisses after [`TOAST_DURATION_MS`]; the × button
 *  dismisses manually. */
export function Toast({ kind, message, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss, message]);

  return (
    <div
      className={`toast toast-${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      <span className="toast-message">{message}</span>
      <button
        type="button"
        className="icon-button toast-dismiss"
        aria-label="Cerrar notificación"
        onClick={onDismiss}
      >
        <X size={15} />
      </button>
    </div>
  );
}
