import { spawnSync } from "child_process";
import { dirname, join } from "path";
import {
  Browser,
  BrowserContext,
  BrowserType,
  chromium,
  firefox,
  webkit,
} from "playwright-core";

export enum BrowserTypes {
  Chromium = "chromium",
  Firefox = "firefox",
  Webkit = "webkit",
}

export type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";
export type ImageFormat = "jpeg" | "png";
export type ColorScheme = "light" | "dark" | "no-preference";
export type ReducedMotion = "reduce" | "no-preference";

/** Options that can be set for the whole run or overridden per destination. */
export class AltimeterPageOptions {
  public width = 1200;
  public height = 630;
  /** Pixel density of the image, eg. `2` for a 2400x1260 image at 1200x630. */
  public deviceScaleFactor = 1;
  public format: ImageFormat = "jpeg";
  /** JPEG quality from 0 to 100. Ignored for PNG. */
  public quality?: number;
  /** Load state to wait for after navigating. */
  public waitUntil: WaitUntil = "load";
  /** Selector that must be visible before the screenshot is taken. */
  public waitForSelector?: string;
  /** Extra milliseconds to wait before the screenshot is taken. */
  public delay = 0;
  /** Capture only the first element matching this selector. */
  public selector?: string;
  /** Extra CSS applied while the screenshot is taken. */
  public css?: string;
  /** Elements hidden while the screenshot is taken, eg. cookie banners. */
  public hideSelectors: string[] = [];
  public colorScheme: ColorScheme = "light";
  public reducedMotion: ReducedMotion = "reduce";
  /** Extra HTTP headers sent with every request. */
  public headers?: Record<string, string>;
  public userAgent?: string;
}

export class AltimeterConfig extends AltimeterPageOptions {
  public browser: BrowserTypes = BrowserTypes.Chromium;
  /** Browser distribution channel, eg. `"chrome"` to use an installed Chrome. */
  public channel?: string;
  /** Path to a browser executable to use instead of the Playwright build. */
  public executablePath?: string;
  public baseURL?: string;
  public destURLs: AltimeterDestinationInput[] = [];
  public dir = "altimeter";
  /** Navigation / wait timeout in milliseconds (`0` disables it). */
  public timeout = 30000;
  /** Maximum number of pages captured at the same time. */
  public concurrency = 4;
  /** Credentials for HTTP authentication, eg. on a staging site. */
  public httpCredentials?: { username: string; password: string };
}

export class AltimeterDestination {
  public name: string;
  public url: string;

  constructor(name: string, url: string) {
    this.name = name;
    this.url = url;
  }
}

/**
 * A destination as written in a config: either a path, or an object with the
 * path, an optional image name (derived from the path when omitted) and any
 * page options to override for this destination.
 */
export type AltimeterDestinationInput =
  | string
  | ({ name?: string; url: string } & Partial<AltimeterPageOptions>);

/** Config accepted by `genRun`; anything left out falls back to the defaults. */
export type AltimeterOptions = Partial<AltimeterConfig>;

export interface AltimeterResult {
  name: string;
  url: string;
  /** Path of the generated image, set when the capture succeeded. */
  path?: string;
  /** Set when the capture failed. */
  error?: Error;
}

export class AltimeterConfigError extends Error {
  public problems: string[];

  constructor(problems: string[]) {
    super("Invalid config:\n" + problems.map((p) => "  - " + p).join("\n"));
    this.name = "AltimeterConfigError";
    this.problems = problems;
  }
}

type Check = (value: unknown) => string | undefined;

const isString: Check = (v) =>
  typeof v === "string" ? undefined : "must be a string";
const isNonEmptyString: Check = (v) =>
  typeof v === "string" && v.length > 0
    ? undefined
    : "must be a non-empty string";
const isPositiveInt: Check = (v) =>
  Number.isInteger(v) && (v as number) > 0
    ? undefined
    : "must be a positive integer";
const isPositiveNumber: Check = (v) =>
  typeof v === "number" && Number.isFinite(v) && v > 0
    ? undefined
    : "must be a positive number";
const isNonNegativeNumber: Check = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? undefined
    : "must be a non-negative number";
const isQuality: Check = (v) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100
    ? undefined
    : "must be an integer from 0 to 100";
const isOneOf =
  (values: readonly string[]): Check =>
  (v) =>
    values.includes(v as string)
      ? undefined
      : "must be one of " + values.map((x) => JSON.stringify(x)).join(", ");
const isStringArray: Check = (v) =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0)
    ? undefined
    : "must be an array of non-empty strings";
const isStringRecord: Check = (v) =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === "string")
    ? undefined
    : "must be an object with string values";
const isCredentials: Check = (v) => {
  const { username, password } = (v ?? {}) as Record<string, unknown>;
  return typeof username === "string" && typeof password === "string"
    ? undefined
    : "must be an object with string `username` and `password`";
};
const isURL: Check = (v) => {
  const err = isNonEmptyString(v);
  if (err !== undefined) {
    return err;
  }
  try {
    new URL(v as string);
    return undefined;
  } catch {
    return 'must be an absolute URL (eg. "https://example.com")';
  }
};

const PAGE_CHECKS: Record<keyof AltimeterPageOptions, Check> = {
  width: isPositiveInt,
  height: isPositiveInt,
  deviceScaleFactor: isPositiveNumber,
  format: isOneOf(["jpeg", "png"]),
  quality: isQuality,
  waitUntil: isOneOf(["load", "domcontentloaded", "networkidle", "commit"]),
  waitForSelector: isNonEmptyString,
  delay: isNonNegativeNumber,
  selector: isNonEmptyString,
  css: isString,
  hideSelectors: isStringArray,
  colorScheme: isOneOf(["light", "dark", "no-preference"]),
  reducedMotion: isOneOf(["reduce", "no-preference"]),
  headers: isStringRecord,
  userAgent: isNonEmptyString,
};

const CHECKS: Record<keyof AltimeterConfig, Check> = {
  ...PAGE_CHECKS,
  browser: isOneOf(Object.values(BrowserTypes)),
  channel: isNonEmptyString,
  executablePath: isNonEmptyString,
  baseURL: isURL,
  destURLs: () => undefined, // validated separately below
  dir: isString,
  timeout: isNonNegativeNumber,
  concurrency: isPositiveInt,
  httpCredentials: isCredentials,
};

/**
 * Runs `checks` over the keys of `input`, returning a problem for each invalid
 * value and passing unknown keys to `warn`.
 */
function checkKeys(
  input: Record<string, unknown>,
  checks: Record<string, Check>,
  where: string,
  warn: (message: string) => void,
): string[] {
  const known = Object.keys(checks);
  const problems: string[] = [];
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) {
      const match = known.find((k) => k.toLowerCase() === key.toLowerCase());
      warn(
        "Unknown config key `" +
          where +
          key +
          "`" +
          (match !== undefined ? ", did you mean `" + match + "`?" : "."),
      );
      continue;
    }
    const value = input[key];
    if (value === undefined) {
      continue;
    }
    const err = checks[key](value);
    if (err !== undefined) {
      problems.push("`" + where + key + "` " + err);
    }
  }
  return problems;
}

/**
 * Validates a raw (eg. JSON-parsed) config and merges it over the defaults.
 * Throws `AltimeterConfigError` listing every problem found. Unknown keys are
 * not fatal; they are reported through `warn`.
 */
export function parseConfig(
  raw: unknown,
  warn: (message: string) => void = console.warn,
): AltimeterConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new AltimeterConfigError(["config must be a JSON object"]);
  }
  const input = raw as Record<string, unknown>;
  const problems = checkKeys(input, CHECKS, "", warn);

  if (input.baseURL === undefined) {
    problems.push("`baseURL` is required");
  }
  problems.push(...checkDestinations(input.destURLs, warn));

  if (problems.length > 0) {
    throw new AltimeterConfigError(problems);
  }

  const config = new AltimeterConfig();
  for (const key of Object.keys(CHECKS)) {
    if (input[key] !== undefined) {
      Object.assign(config, { [key]: input[key] });
    }
  }
  return config;
}

function checkDestinations(
  destURLs: unknown,
  warn: (message: string) => void,
): string[] {
  if (destURLs === undefined) {
    return [];
  }
  if (!Array.isArray(destURLs)) {
    return ["`destURLs` must be an array"];
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  destURLs.forEach((dest, i) => {
    const where = "destURLs[" + i + "]";
    if (typeof dest === "string") {
      dest = { url: dest };
    } else if (typeof dest !== "object" || dest === null) {
      problems.push("`" + where + "` must be a string or an object");
      return;
    }
    const { name, url, ...options } = dest as Record<string, unknown>;
    if (typeof url !== "string") {
      problems.push("`" + where + ".url` must be a string");
      return;
    }
    if (name !== undefined && (typeof name !== "string" || name === "")) {
      problems.push("`" + where + ".name` must be a non-empty string");
      return;
    }
    const resolved = name ?? destinationName(url);
    if (seen.has(resolved)) {
      problems.push(
        "`" +
          where +
          "` would be saved as `" +
          resolved +
          "`, which is already used; give it a unique `name`",
      );
    }
    seen.add(resolved);
    problems.push(...checkKeys(options, PAGE_CHECKS, where + ".", warn));
  });
  return problems;
}

/**
 * Derives an image name from a destination path, eg. `"docs/intro.html"`
 * becomes `"docs-intro"` and `""` becomes `"base"`.
 */
export function destinationName(url: string): string {
  const name = url
    .replace(/[?#].*$/, "")
    .replace(/\.html?$/i, "")
    .replace(/(^|\/)index$/i, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name.length > 0 ? name : "base";
}

/**
 * Joins a base URL and a path, inserting a single "/" separator only when
 * both sides are non-empty and the base does not already end with one.
 */
export function joinURL(baseURL: string, path: string): string {
  if (baseURL.length > 0 && path.length > 0 && !baseURL.endsWith("/")) {
    return baseURL + "/" + path;
  }
  return baseURL + path;
}

/**
 * Ensures a directory string ends with a trailing "/" so file names can be
 * appended directly. Empty strings are left untouched.
 */
export function normalizeDir(dir: string): string {
  if (dir.length > 0 && !dir.endsWith("/")) {
    return dir + "/";
  }
  return dir;
}

/**
 * Runs `task` over `items` with at most `limit` tasks in flight, preserving
 * the order of the results.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker),
  );
  return results;
}

function browserTypeFor(browser: BrowserTypes): BrowserType {
  switch (browser) {
    case BrowserTypes.Chromium:
      return chromium;
    case BrowserTypes.Firefox:
      return firefox;
    case BrowserTypes.Webkit:
      return webkit;
  }
}

/**
 * Launches the configured browser. When the Playwright build of the browser
 * has not been downloaded yet, it is installed once and the launch retried,
 * so consumers no longer pay for a browser download at `npm install` time.
 */
async function launchBrowser(config: AltimeterConfig): Promise<Browser> {
  const browserType = browserTypeFor(config.browser);
  const options = {
    channel: config.channel,
    executablePath: config.executablePath,
  };
  try {
    return await browserType.launch(options);
  } catch (err) {
    const usesOwnBrowser =
      config.channel !== undefined || config.executablePath !== undefined;
    if (usesOwnBrowser || !isMissingBrowserError(err)) {
      throw err;
    }
  }
  installBrowser(config.browser);
  return await browserType.launch(options);
}

function isMissingBrowserError(err: unknown): boolean {
  return (
    err instanceof Error && err.message.includes("Executable doesn't exist")
  );
}

function installBrowser(browser: BrowserTypes): void {
  console.log("Installing " + browser + " for Playwright...");
  // Use the CLI that ships with the pinned playwright-core so the downloaded
  // browser always matches the library version.
  const cli = join(
    dirname(require.resolve("playwright-core/package.json")),
    "cli.js",
  );
  const args = [cli, "install", browser];
  if (browser === BrowserTypes.Chromium) {
    // Screenshots always run headless, so the full browser is not needed.
    args.push("--only-shell");
  }
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(
      "Failed to install " +
        browser +
        ". Try running `npx playwright-core install " +
        browser +
        "` manually.",
    );
  }
}

interface ResolvedDestination {
  name: string;
  url: string;
  options: AltimeterPageOptions;
}

function resolveDestinations(config: AltimeterConfig): ResolvedDestination[] {
  const pageKeys = Object.keys(PAGE_CHECKS) as (keyof AltimeterPageOptions)[];
  const base: AltimeterPageOptions = Object.assign(
    new AltimeterPageOptions(),
    Object.fromEntries(pageKeys.map((key) => [key, config[key]])),
  );
  const inputs: AltimeterDestinationInput[] =
    config.destURLs.length > 0 ? config.destURLs : [""];
  return inputs.map((input) => {
    const { name, url, ...overrides } =
      typeof input === "string" ? { url: input } : input;
    const defined = Object.entries(overrides).filter(
      ([, value]) => value !== undefined,
    );
    return {
      name: name ?? destinationName(url),
      url,
      options: { ...base, ...Object.fromEntries(defined) },
    };
  });
}

/**
 * Captures every configured destination. Plain objects are validated with
 * `parseConfig` and merged over the defaults. Failures are reported per page
 * instead of aborting the whole run; check `error` on the returned results.
 */
export async function genRun(
  input: AltimeterConfig | AltimeterOptions,
): Promise<AltimeterResult[]> {
  const config = input instanceof AltimeterConfig ? input : parseConfig(input);
  if (config.baseURL === undefined) {
    throw new AltimeterConfigError(["`baseURL` is required"]);
  }
  const baseURL = config.baseURL;
  const destinations = resolveDestinations(config);

  const browser = await launchBrowser(config);
  try {
    return await mapWithConcurrency(
      destinations,
      config.concurrency,
      async (destination) => {
        const url = joinURL(baseURL, destination.url);
        try {
          const path = await genScreenShot(config, browser, destination, url);
          console.log("Generated " + path);
          return { name: destination.name, url, path };
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(
            "Failed to generate " +
              destination.name +
              " (" +
              url +
              "): " +
              error.message,
          );
          return { name: destination.name, url, error };
        }
      },
    );
  } finally {
    await browser.close();
  }
}

/** Builds the stylesheet applied while a screenshot is taken. */
export function screenshotStyle(
  options: Pick<AltimeterPageOptions, "css" | "hideSelectors">,
): string | undefined {
  const rules: string[] = [];
  if (options.hideSelectors.length > 0) {
    rules.push(
      options.hideSelectors.join(", ") + " { visibility: hidden !important; }",
    );
  }
  if (options.css !== undefined && options.css.length > 0) {
    rules.push(options.css);
  }
  return rules.length > 0 ? rules.join("\n") : undefined;
}

async function genScreenShot(
  config: AltimeterConfig,
  browser: Browser,
  destination: ResolvedDestination,
  url: string,
): Promise<string> {
  const options = destination.options;
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      screen: { width: options.width, height: options.height },
      viewport: {
        width: options.width,
        height: options.height,
      },
      deviceScaleFactor: options.deviceScaleFactor,
      colorScheme: options.colorScheme,
      reducedMotion: options.reducedMotion,
      extraHTTPHeaders: options.headers,
      userAgent: options.userAgent,
      httpCredentials: config.httpCredentials,
      isMobile: false,
    });
    context.setDefaultTimeout(config.timeout);
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: options.waitUntil });
    if (response !== null && response.status() >= 400) {
      throw new Error("Page responded with HTTP " + response.status());
    }
    if (options.waitForSelector !== undefined) {
      await page.waitForSelector(options.waitForSelector, {
        state: "visible",
      });
    }
    if (options.delay > 0) {
      await page.waitForTimeout(options.delay);
    }

    const extension = options.format === "png" ? ".png" : ".jpg";
    const path = normalizeDir(config.dir) + destination.name + extension;
    const screenshotOptions = {
      animations: "disabled" as const,
      type: options.format,
      quality: options.format === "jpeg" ? options.quality : undefined,
      style: screenshotStyle(options),
      path,
    };
    if (options.selector !== undefined) {
      await page
        .locator(options.selector)
        .first()
        .screenshot(screenshotOptions);
    } else {
      await page.screenshot({
        ...screenshotOptions,
        fullPage: false,
        clip: {
          x: 0,
          y: 0,
          width: options.width,
          height: options.height,
        },
      });
    }
    return path;
  } finally {
    await context?.close();
  }
}
