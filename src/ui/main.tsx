import React from "react";
import ReactDOM from "react-dom/client";

// Placeholder mount point only. The Spanish UI components (login/locked screens,
// entry cards, forms, confirmations) are implemented in Phase 4. This file just
// establishes the React root so the scaffold builds and `npm run tauri dev` can
// start the webview.
function App() {
  return <main>Keymaps2026</main>;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
