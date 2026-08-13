import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createTwinApiClient } from "./api/client";
import { App } from "./app/App";
import { AppProviders } from "./app/providers";
import "./styles.css";

const api = createTwinApiClient({ baseUrl: import.meta.env.VITE_TWIN_API_URL ?? "" });
const root = document.getElementById("root");
if (!root) throw new Error("Studio Web root element was not found.");

createRoot(root).render(
  <StrictMode>
    <AppProviders api={api}>
      <App api={api} />
    </AppProviders>
  </StrictMode>,
);
