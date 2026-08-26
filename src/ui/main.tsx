import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Application entry: mounts the Spanish UI shell (login/creation screens,
// entry cards, forms and confirmations — Phase 4).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);