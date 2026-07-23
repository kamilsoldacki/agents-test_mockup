import { defineConfig } from "vite";

/**
 * GitHub project pages are served from https://<user>.github.io/<repo>/ — Vite must use that prefix.
 * CI should set VITE_BASE_PATH (see workflow). If it is missing, derive from GITHUB_REPOSITORY on runners.
 */
function resolveBase() {
  const raw = process.env.VITE_BASE_PATH;
  if (raw != null && String(raw).trim() !== "") {
    let b = String(raw).trim();
    if (!b.startsWith("/")) b = `/${b}`;
    if (!b.endsWith("/")) b = `${b}/`;
    return b;
  }

  const repo = process.env.GITHUB_REPOSITORY;
  if (process.env.GITHUB_ACTIONS === "true" && repo && repo.includes("/")) {
    const [owner, name] = repo.split("/");
    if (name === `${owner}.github.io`) return "/";
    return `/${name}/`;
  }

  return "/";
}

export default defineConfig({
  base: resolveBase(),
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3456",
        changeOrigin: true,
      },
    },
  },
});
