// Spanish UI component — vault-ui secret-field copy control: an icon button
// that flashes "Copiado" feedback for 1.5 seconds after the copy callback
// runs, then restores the original label. All user-visible copy is neutral
// professional Spanish. Presentational: it receives the label and the copy
// callback, and never talks to the backend directly — which keeps it testable
// headless.
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copy control as an icon with transient "Copiado" feedback. */
export function CopyButton({ label, onCopy }: { label: string; onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function handleClick() {
    onCopy();
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      className={`icon-button copy-button${copied ? " copied" : ""}`}
      aria-label={copied ? "Copiado" : label}
      onClick={handleClick}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
