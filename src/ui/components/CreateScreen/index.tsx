// Spanish UI component — the vault-creation screen (vault-ui "Vault creation
// warning"): irreversible-loss warning before master-password confirmation.
// Presentational: receives the server-reported error and the create callback,
// and never talks to the backend directly — which keeps it testable headless.
import { useState } from "react";
import type { FormEvent } from "react";

export interface CreateScreenProps {
  error: string | null;
  onCreated: (password: string) => void;
}

/** Vault-creation form: validates the password pair locally, then reports
 *  the confirmed master password upward. */
export function CreateScreen({ error, onCreated }: CreateScreenProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password === "") {
      setLocalError("La contraseña maestra es obligatoria.");
      return;
    }
    if (password !== confirmation) {
      setLocalError("Las contraseñas no coinciden.");
      return;
    }
    setLocalError(null);
    onCreated(password);
  }

  return (
    <div className="screen">
      <h2>Crear bóveda</h2>
      <p className="warning" role="alert">
        <strong>Advertencia: pérdida irreversible</strong>
        Si pierdes la contraseña maestra, no hay forma de recuperar la bóveda. Esta acción es
        irreversible y no existe ningún mecanismo de recuperación.
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="new-master-password">
          Nueva contraseña maestra
          <input
            id="new-master-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label htmlFor="confirm-master-password">
          Confirmar contraseña maestra
          <input
            id="confirm-master-password"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {(localError ?? error) && (
          <p className="field-error" role="alert">
            {localError ?? error}
          </p>
        )}
        <button type="submit" className="primary-button">
          Crear bóveda
        </button>
      </form>
    </div>
  );
}
