// Spanish UI component — the login screen (vault-ui "Locked-state warning",
// vault-session "Bounded login"): the irreversible-loss warning is a quiet
// note below the password input and the backoff countdown gates the submit.
// Presentational: receives the server-reported error/notice, the remaining
// backoff seconds and the unlock callback; never talks to the backend.
import { useState } from "react";
import type { FormEvent } from "react";
import { BackoffNotice } from "../BackoffNotice";

export interface LoginScreenProps {
  error: string | null;
  notice: string | null;
  backoff: number | null;
  onExpireBackoff: () => void;
  onUnlock: (password: string) => void;
}

/** Master-password login form with the bounded-attempt backoff countdown. */
export function LoginScreen({ error, notice, backoff, onExpireBackoff, onUnlock }: LoginScreenProps) {
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onUnlock(password);
  }

  return (
    <div className="screen">
      <h2>Desbloquear bóveda</h2>
      <form onSubmit={handleSubmit}>
        <label htmlFor="master-password">
          Contraseña maestra
          <input
            id="master-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="notice">{notice}</p>}
        {backoff !== null && (
          <BackoffNotice seconds={backoff} onExpire={onExpireBackoff} />
        )}
        <button type="submit" className="primary-button" disabled={backoff !== null}>
          Desbloquear
        </button>
      </form>
      <p className="warning quiet" role="alert">
        <strong>Advertencia: pérdida irreversible</strong>
        Si olvidas la contraseña maestra, perderás el acceso a la bóveda de forma permanente.
        No existe ningún mecanismo de recuperación.
      </p>
    </div>
  );
}
