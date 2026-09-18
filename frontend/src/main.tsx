import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { applyTheme, readStoredTheme } from "./theme";
import "./styles.css";

// 与 index.html 的首屏内联脚本同一个动作，重复执行无副作用，
// 保证「内联脚本被剥离」时主题依然生效。
applyTheme(readStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

