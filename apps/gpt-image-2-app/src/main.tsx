import React from "react";
import { createRoot } from "react-dom/client";
import type { AppScreen } from "./runtime-contract";

const screens: AppScreen[] = [
  { id: "providers", title: "Provider Manager" },
  { id: "generate", title: "Generate Workspace" },
  { id: "edit", title: "Edit Workspace" },
  { id: "history", title: "History and Queue" },
];

function App() {
  return (
    <main>
      <h1>GPT Image 2 App Shell</h1>
      <p>Frontend can consume runtime-contract.ts and contracts/mock-data.json.</p>
      <ul>
        {screens.map((screen) => (
          <li key={screen.id}>{screen.title}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
