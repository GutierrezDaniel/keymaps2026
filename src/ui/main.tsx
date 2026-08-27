import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/libre-caslon-text/400.css";
import "@fontsource/libre-caslon-text/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import App from "./App";

// Application entry: mounts the Spanish UI shell (login/creation screens,
// entry cards, forms and confirmations — Phase 4).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);