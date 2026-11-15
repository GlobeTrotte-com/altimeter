import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { genRun } from "./index";
import {
  JPEG_MAGIC,
  PNG_MAGIC,
  pngSize,
  startServer,
  TestServer,
} from "./test/server";

// These tests drive a real headless Chromium. CI installs it before running
// them; locally they run when CI=1 is set (eg. after
// `npx playwright-core install chromium --only-shell`).
describe.skipIf(!process.env.CI)("genRun in a real browser", () => {
  let server: TestServer;
  let dir: string;

  beforeAll(async () => {
    server = await startServer();
    dir = mkdtempSync(join(tmpdir(), "altimeter-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("captures every destination with derived names", async () => {
    const results = await genRun({
      baseURL: server.url,
      dir: join(dir, "jpeg"),
      destURLs: ["", "docs/intro.html"],
    });

    expect(results.map((r) => r.error)).toEqual([undefined, undefined]);
    expect(results.map((r) => r.name)).toEqual(["base", "docs-intro"]);
    expect(results[1].url).toBe(server.url + "/docs/intro.html");
    for (const result of results) {
      expect(result.path).toMatch(/\.jpg$/);
      const data = readFileSync(result.path as string);
      expect(data.subarray(0, 3)).toEqual(JPEG_MAGIC);
    }
  });

  it("writes PNGs at the viewport size times the scale factor", async () => {
    const [result] = await genRun({
      baseURL: server.url,
      dir: join(dir, "png"),
      format: "png",
      width: 400,
      height: 300,
      deviceScaleFactor: 2,
    });

    expect(result.error).toBeUndefined();
    const data = readFileSync(result.path as string);
    expect(data.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(pngSize(data)).toEqual({ width: 800, height: 600 });
  });

  it("captures only the selected element", async () => {
    const [result] = await genRun({
      baseURL: server.url,
      dir: join(dir, "selector"),
      format: "png",
      selector: "#card",
    });

    expect(result.error).toBeUndefined();
    expect(pngSize(readFileSync(result.path as string))).toEqual({
      width: 120,
      height: 80,
    });
  });

  it("applies per-destination overrides and custom names", async () => {
    const results = await genRun({
      baseURL: server.url,
      dir: join(dir, "overrides"),
      width: 640,
      height: 480,
      destURLs: [
        "",
        { name: "small", url: "", format: "png", width: 200, height: 100 },
      ],
    });

    expect(results[0].path).toMatch(/base\.jpg$/);
    expect(results[1].path).toMatch(/small\.png$/);
    expect(pngSize(readFileSync(results[1].path as string))).toEqual({
      width: 200,
      height: 100,
    });
  });

  it("reports HTTP errors per page without failing the others", async () => {
    const results = await genRun({
      baseURL: server.url,
      dir: join(dir, "errors"),
      destURLs: ["", "missing.html"],
    });

    expect(results[0].error).toBeUndefined();
    expect(results[1].path).toBeUndefined();
    expect(results[1].error?.message).toBe("Page responded with HTTP 404");
  });

  it("waits for a selector, a delay and hides elements", async () => {
    const [result] = await genRun({
      baseURL: server.url,
      dir: join(dir, "wait"),
      destURLs: ["late.html"],
      waitForSelector: "#ready",
      delay: 10,
      hideSelectors: ["#banner"],
      css: "body { margin: 0; }",
    });

    expect(result.error).toBeUndefined();
  });

  it("fails a page whose selector never appears", async () => {
    const [result] = await genRun({
      baseURL: server.url,
      dir: join(dir, "timeout"),
      waitForSelector: "#never",
      timeout: 500,
    });

    expect(result.error?.message).toMatch(/Timeout/);
  });

  it("sends credentials, headers and the user agent", async () => {
    const results = await genRun({
      baseURL: server.url,
      dir: join(dir, "auth"),
      destURLs: ["private.html"],
      httpCredentials: { username: "user", password: "pass" },
      headers: { "X-Altimeter-Test": "yes" },
      userAgent: "altimeter-test",
      colorScheme: "dark",
    });

    expect(results[0].error).toBeUndefined();
    const request = server.requests
      .filter((r) => r.path === "/private.html")
      .at(-1);
    expect(request?.headers["x-altimeter-test"]).toBe("yes");
    expect(request?.headers["user-agent"]).toBe("altimeter-test");
  });

  it("fails pages behind basic auth without credentials", async () => {
    const [result] = await genRun({
      baseURL: server.url,
      dir: join(dir, "noauth"),
      destURLs: ["private.html"],
    });

    expect(result.error?.message).toBe("Page responded with HTTP 401");
  });
});
