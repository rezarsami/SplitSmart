import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local development, Vite serves the front end on :5173. The serverless
// function in /api needs to run too. The easiest way to develop locally with
// the /api function is to use the Vercel CLI (`vercel dev`), which serves BOTH
// the front end and the /api function together on one port, so the fetch to
// "/api/scan-receipt" just works. See README for the two ways to run.
export default defineConfig({
  plugins: [react()],
});
