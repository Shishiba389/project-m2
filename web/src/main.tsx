import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MinimaWorkspace } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MinimaWorkspace />
  </StrictMode>,
);
