import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import "../engine/core.js";
import "../engine/territories.js";
import "../engine/zone-jobs.js";
import "../engine/cache.js";
import "../engine/accessibility.js";
import "../engine/routing-http.js";
import "../engine/routing-osrm.js";
import "../engine/backup.js";
import { DeveloperApp } from "./DeveloperApp";

const root = document.getElementById("root");
if (!root) throw new Error("Не найден корневой элемент приложения.");
createRoot(root).render(
  <StrictMode>
    <DeveloperApp />
  </StrictMode>,
);
