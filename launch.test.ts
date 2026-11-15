import { beforeEach, describe, expect, it, vi } from "vitest";

// Stand-ins for Playwright and child_process, so the launch / install logic
// and the screenshot flow can be checked without a real browser.
const mocks = vi.hoisted(() => {
  const page = {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    waitForTimeout: vi.fn(),
    screenshot: vi.fn(),
    locator: vi.fn(),
  };
  const elementScreenshot = vi.fn();
  page.locator.mockReturnValue({
    first: () => ({ screenshot: elementScreenshot }),
  });
  const context = {
    setDefaultTimeout: vi.fn(),
    newPage: vi.fn(async () => page),
    close: vi.fn(),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(),
  };
  const launcher = () => ({ launch: vi.fn() });
  return {
    page,
    elementScreenshot,
    context,
    browser,
    chromium: launcher(),
    firefox: launcher(),
    webkit: launcher(),
    spawnSync: vi.fn(),
  };
});

vi.mock("playwright-core", () => ({
  chromium: mocks.chromium,
  firefox: mocks.firefox,
  webkit: mocks.webkit,
}));
vi.mock("child_process", () => ({ spawnSync: mocks.spawnSync }));

import { AltimeterConfig, AltimeterConfigError, genRun } from "./index";

const missing = new Error("browserType.launch: Executable doesn't exist at x");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const type of [mocks.chromium, mocks.firefox, mocks.webkit]) {
    type.launch.mockResolvedValue(mocks.browser);
  }
  mocks.page.goto.mockResolvedValue({ status: () => 200 });
  mocks.spawnSync.mockReturnValue({ status: 0 });
});

describe("genRun config handling", () => {
  it("validates plain objects before launching a browser", async () => {
    await expect(genRun({ width: -1 } as never)).rejects.toBeInstanceOf(
      AltimeterConfigError,
    );
    expect(mocks.chromium.launch).not.toHaveBeenCalled();
  });

  it("requires baseURL on a config instance", async () => {
    await expect(genRun(new AltimeterConfig())).rejects.toThrow(
      "`baseURL` is required",
    );
  });
});

describe("launching the browser", () => {
  it("installs the Chromium headless shell when it is missing", async () => {
    mocks.chromium.launch.mockRejectedValueOnce(missing);

    const results = await genRun({ baseURL: "https://example.com" });

    expect(results).toEqual([
      { name: "base", url: "https://example.com", path: "altimeter/base.jpg" },
    ]);
    expect(mocks.chromium.launch).toHaveBeenCalledTimes(2);
    const [, args] = mocks.spawnSync.mock.calls[0];
    expect(args.slice(1)).toEqual(["install", "chromium", "--only-shell"]);
    expect(mocks.browser.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["firefox", mocks.firefox],
    ["webkit", mocks.webkit],
  ] as const)("installs the full %s build", async (name, type) => {
    type.launch.mockRejectedValueOnce(missing);

    await genRun({ baseURL: "https://example.com", browser: name as never });

    const [, args] = mocks.spawnSync.mock.calls[0];
    expect(args.slice(1)).toEqual(["install", name]);
  });

  it("reports a failed install", async () => {
    mocks.chromium.launch.mockRejectedValueOnce(missing);
    mocks.spawnSync.mockReturnValue({ status: 1 });

    await expect(genRun({ baseURL: "https://example.com" })).rejects.toThrow(
      "Failed to install chromium",
    );
  });

  it("does not install anything when using an existing browser", async () => {
    mocks.chromium.launch.mockRejectedValueOnce(missing);

    await expect(
      genRun({ baseURL: "https://example.com", channel: "chrome" }),
    ).rejects.toBe(missing);
    expect(mocks.spawnSync).not.toHaveBeenCalled();
    expect(mocks.chromium.launch).toHaveBeenCalledWith({
      channel: "chrome",
      executablePath: undefined,
    });
  });

  it("rethrows other launch errors", async () => {
    const crash = new Error("crashed");
    mocks.chromium.launch.mockRejectedValueOnce(crash);

    await expect(genRun({ baseURL: "https://example.com" })).rejects.toBe(
      crash,
    );
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
});

describe("taking screenshots", () => {
  it("passes page options to the browser context and screenshot", async () => {
    await genRun({
      baseURL: "https://example.com",
      dir: "out",
      width: 800,
      height: 400,
      deviceScaleFactor: 2,
      quality: 80,
      timeout: 1000,
      userAgent: "ua",
      headers: { "X-Test": "1" },
      httpCredentials: { username: "u", password: "p" },
      hideSelectors: ["#cookies"],
    });

    expect(mocks.browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: { width: 800, height: 400 },
        deviceScaleFactor: 2,
        userAgent: "ua",
        extraHTTPHeaders: { "X-Test": "1" },
        httpCredentials: { username: "u", password: "p" },
      }),
    );
    expect(mocks.context.setDefaultTimeout).toHaveBeenCalledWith(1000);
    expect(mocks.page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "jpeg",
        quality: 80,
        path: "out/base.jpg",
        style: "#cookies { visibility: hidden !important; }",
        clip: { x: 0, y: 0, width: 800, height: 400 },
      }),
    );
    expect(mocks.context.close).toHaveBeenCalledOnce();
  });

  it("captures an element, waits and drops quality for PNG", async () => {
    const [result] = await genRun({
      baseURL: "https://example.com",
      format: "png",
      quality: 80,
      selector: "#card",
      waitForSelector: "#ready",
      delay: 50,
    });

    expect(result.path).toBe("altimeter/base.png");
    expect(mocks.page.waitForSelector).toHaveBeenCalledWith("#ready", {
      state: "visible",
    });
    expect(mocks.page.waitForTimeout).toHaveBeenCalledWith(50);
    expect(mocks.page.locator).toHaveBeenCalledWith("#card");
    expect(mocks.elementScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({ type: "png", quality: undefined }),
    );
    expect(mocks.page.screenshot).not.toHaveBeenCalled();
  });

  it("accepts navigations without a response", async () => {
    mocks.page.goto.mockResolvedValue(null);

    const [result] = await genRun({ baseURL: "https://example.com" });

    expect(result.error).toBeUndefined();
  });

  it("records failures per page and keeps going", async () => {
    mocks.page.goto
      .mockResolvedValueOnce({ status: () => 500 })
      .mockRejectedValueOnce("boom");

    const results = await genRun({
      baseURL: "https://example.com",
      destURLs: ["a", "b", "c"],
      concurrency: 1,
    });

    expect(results.map((r) => r.error?.message)).toEqual([
      "Page responded with HTTP 500",
      "boom",
      undefined,
    ]);
    expect(mocks.context.close).toHaveBeenCalledTimes(3);
    expect(mocks.browser.close).toHaveBeenCalledOnce();
  });

  it("still closes the browser when the context cannot be created", async () => {
    mocks.browser.newContext.mockRejectedValueOnce(new Error("no context"));

    const [result] = await genRun({ baseURL: "https://example.com" });

    expect(result.error?.message).toBe("no context");
    expect(mocks.browser.close).toHaveBeenCalledOnce();
  });
});
