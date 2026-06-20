import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";

// Register the token getter here — earliest possible execution point —
// so every generated-client request carries Authorization: Bearer <token>
// regardless of React module import order.
setAuthTokenGetter(() => localStorage.getItem("midanic_token"));

const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
if (apiUrl) {
  setBaseUrl(apiUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
