import { describe, it, expect } from "vitest";
import {
  AltimeterConfig,
  AltimeterDestination,
  BrowserTypes,
  joinURL,
  normalizeDir,
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
    expect(config.height).toBe(600);
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
