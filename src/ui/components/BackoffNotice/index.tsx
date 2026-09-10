// Spanish UI component — the login backoff countdown (vault-session
// "Bounded login attempts"). All user-visible copy is neutral professional
// Spanish. Presentational: receives the remaining seconds and the expire
// callback, and never talks to the backend directly — which keeps it
// testable headless.
import { useEffect, useState } from "react";

export interface BackoffNoticeProps {
  seconds: number;
  /** Called when the countdown reaches zero. */
  onExpire: () => void;
}

/** Counts down the Rust backoff delay with a Spanish message. */
export function BackoffNotice({ seconds, onExpire }: BackoffNoticeProps) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => setRemaining((current) => current - 1), 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  useEffect(() => {
    if (remaining === 0) onExpire();
  }, [remaining, onExpire]);

  return (
    <p className="backoff" role="alert">
      Demasiados intentos fallidos. Intenta de nuevo en {remaining} segundos.
    </p>
  );
}
