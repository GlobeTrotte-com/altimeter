import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The CLI tests change the working directory, which needs a process per
    // test file rather than worker threads.
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["index.ts", "cli.ts"],
      reporter: ["text", "text-summary", "json-summary", "lcov"],
      // Keep coverage from slipping; raise these as tests are added.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
