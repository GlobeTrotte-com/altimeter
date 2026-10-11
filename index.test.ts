import { describe, it, expect } from "vitest";
import {
  AltimeterConfig,
  AltimeterConfigError,
  AltimeterDestination,
  BrowserTypes,
  destinationName,
  joinURL,
  mapWithConcurrency,
  normalizeDir,
  parseConfig,
  screenshotStyle,
} from "./index";

describe("joinURL", () => {
  it("inserts a slash between base and path when missing", () => {
    expect(joinURL("https://gitnav.xyz", "docs/page.html")).toBe(
      "https://gitnav.xyz/docs/page.html",
    );
  });

  it("does not double up the slash when base already ends with one", () => {
    expect(joinURL("https://gitnav.xyz/", "docs/page.html")).toBe(
      "https://gitnav.xyz/docs/page.html",
    );
  });

  it("returns the base unchanged when path is empty", () => {
    expect(joinURL("https://gitnav.xyz", "")).toBe("https://gitnav.xyz");
  });

  it("returns the path unchanged when base is empty", () => {
    expect(joinURL("", "docs/page.html")).toBe("docs/page.html");
  });
});

describe("normalizeDir", () => {
  it("appends a trailing slash when missing", () => {
    expect(normalizeDir("doc/preview")).toBe("doc/preview/");
  });

  it("leaves an existing trailing slash intact", () => {
    expect(normalizeDir("doc/preview/")).toBe("doc/preview/");
  });

  it("leaves an empty string untouched", () => {
    expect(normalizeDir("")).toBe("");
  });
});

describe("AltimeterConfig", () => {
  it("provides sensible defaults", () => {
    const config = new AltimeterConfig();
    expect(config.browser).toBe(BrowserTypes.Chromium);
    expect(config.baseURL).toBeUndefined();
    expect(config.destURLs).toEqual([]);
    expect(config.dir).toBe("altimeter");
    expect(config.width).toBe(1200);
    expect(config.height).toBe(630);
    expect(config.deviceScaleFactor).toBe(1);
    expect(config.format).toBe("jpeg");
    expect(config.quality).toBeUndefined();
    expect(config.colorScheme).toBe("light");
    expect(config.reducedMotion).toBe("reduce");
    expect(config.hideSelectors).toEqual([]);
    expect(config.waitUntil).toBe("load");
    expect(config.waitForSelector).toBeUndefined();
    expect(config.delay).toBe(0);
    expect(config.timeout).toBe(30000);
    expect(config.concurrency).toBe(4);
  });
});

describe("AltimeterDestination", () => {
  it("stores name and url", () => {
    const dest = new AltimeterDestination(
      "drag_and_drop_rebase",
      "docs/drag-and-drop-rebase.html",
    );
    expect(dest.name).toBe("drag_and_drop_rebase");
    expect(dest.url).toBe("docs/drag-and-drop-rebase.html");
  });
});

describe("parseConfig", () => {
  const problemsOf = (raw: unknown): string[] => {
    try {
      parseConfig(raw, () => {});
    } catch (err) {
      expect(err).toBeInstanceOf(AltimeterConfigError);
      return (err as AltimeterConfigError).problems;
    }
    throw new Error("expected parseConfig to throw");
  };

  it("merges the given values over the defaults", () => {
    const config = parseConfig({
      baseURL: "https://gitnav.xyz",
      dir: "doc/preview",
      waitUntil: "networkidle",
    });
    expect(config).toBeInstanceOf(AltimeterConfig);
    expect(config.baseURL).toBe("https://gitnav.xyz");
    expect(config.dir).toBe("doc/preview");
    expect(config.waitUntil).toBe("networkidle");
    expect(config.width).toBe(1200);
  });

  it("rejects non-object configs", () => {
    expect(problemsOf([])).toEqual(["config must be a JSON object"]);
    expect(problemsOf(null)).toEqual(["config must be a JSON object"]);
  });

  it("requires baseURL", () => {
    expect(problemsOf({})).toEqual(["`baseURL` is required"]);
  });

  it("requires baseURL to be an absolute URL", () => {
    expect(problemsOf({ baseURL: "gitnav.xyz" })).toEqual([
      '`baseURL` must be an absolute URL (eg. "https://example.com")',
    ]);
  });

  it("reports every invalid field at once", () => {
    expect(
      problemsOf({
        baseURL: "https://gitnav.xyz",
        browser: "chrome",
        width: 0,
        delay: -1,
        waitUntil: "idle",
      }),
    ).toEqual([
      '`browser` must be one of "chromium", "firefox", "webkit"',
      "`width` must be a positive integer",
      "`delay` must be a non-negative number",
      '`waitUntil` must be one of "load", "domcontentloaded", "networkidle", "commit"',
    ]);
  });

  it("validates destURLs entries", () => {
    expect(
      problemsOf({
        baseURL: "https://gitnav.xyz",
        destURLs: [
          { name: "a", url: "a.html" },
          { name: "a", url: "b.html" },
          "docs/c.html",
          { url: "docs/c" },
          { name: "", url: "e.html" },
          { name: "f" },
          42,
          { url: "g.html", width: -1, format: "gif" },
        ],
      }),
    ).toEqual([
      "`destURLs[1]` would be saved as `a`, which is already used; give it a unique `name`",
      "`destURLs[3]` would be saved as `docs-c`, which is already used; give it a unique `name`",
      "`destURLs[4].name` must be a non-empty string",
      "`destURLs[5].url` must be a string",
      "`destURLs[6]` must be a string or an object",
      "`destURLs[7].width` must be a positive integer",
      '`destURLs[7].format` must be one of "jpeg", "png"',
    ]);
  });

  it("warns about unknown keys and suggests close matches", () => {
    const warnings: string[] = [];
    parseConfig(
      { baseURL: "https://gitnav.xyz", Width: 800, colour: "red" },
      (w) => warnings.push(w),
    );
    expect(warnings).toEqual([
      "Unknown config key `Width`, did you mean `width`?",
      "Unknown config key `colour`.",
    ]);
  });

  it("warns about keys that cannot be set per destination", () => {
    const warnings: string[] = [];
    parseConfig(
      {
        baseURL: "https://gitnav.xyz",
        destURLs: [{ url: "a.html", browser: "firefox" }],
      },
      (w) => warnings.push(w),
    );
    expect(warnings).toEqual(["Unknown config key `destURLs[0].browser`."]);
  });

  it("validates the new page options", () => {
    expect(
      problemsOf({
        baseURL: "https://gitnav.xyz",
        quality: 101,
        deviceScaleFactor: 0,
        hideSelectors: ".banner",
        headers: { "X-Token": 1 },
        httpCredentials: { username: "me" },
      }),
    ).toEqual([
      "`quality` must be an integer from 0 to 100",
      "`deviceScaleFactor` must be a positive number",
      "`hideSelectors` must be an array of non-empty strings",
      "`headers` must be an object with string values",
      "`httpCredentials` must be an object with string `username` and `password`",
    ]);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves order and never exceeds the limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, n));
      inFlight--;
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
    expect(maxInFlight).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
  });
});

describe("destinationName", () => {
  it.each([
    ["", "base"],
    ["/", "base"],
    ["index.html", "base"],
    ["docs/drag-and-drop-rebase.html", "docs-drag-and-drop-rebase"],
    ["docs/", "docs"],
    ["docs/index.html", "docs"],
    ["/blog/post?id=1#top", "blog-post"],
    ["about.htm", "about"],
    ["snake_case", "snake_case"],
  ])("derives %j -> %j", (url, name) => {
    expect(destinationName(url)).toBe(name);
  });
});

describe("screenshotStyle", () => {
  it("returns undefined when there is nothing to apply", () => {
    expect(screenshotStyle({ hideSelectors: [] })).toBeUndefined();
    expect(screenshotStyle({ hideSelectors: [], css: "" })).toBeUndefined();
  });

  it("hides selectors and appends custom css", () => {
    expect(
      screenshotStyle({
        hideSelectors: ["#cookies", ".chat"],
        css: "body { margin: 0; }",
      }),
    ).toBe(
      "#cookies, .chat { visibility: hidden !important; }\nbody { margin: 0; }",
    );
  });
});
