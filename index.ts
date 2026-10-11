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

export class AltimeterConfig {
  public browser: BrowserTypes = BrowserTypes.Chromium;
  /** Browser distribution channel, eg. `"chrome"` to use an installed Chrome. */
  public channel?: string;
  /** Path to a browser executable to use instead of the Playwright build. */
  public executablePath?: string;
  public baseURL?: string;
  public destURLs: AltimeterDestination[] = [];
  public dir = "altimeter";
  public width = 1200;
  public height = 600;
  /** Load state to wait for after navigating. */
  public waitUntil: WaitUntil = "load";
  /** Selector that must be visible before the screenshot is taken. */
  public waitForSelector?: string;
  /** Extra milliseconds to wait before the screenshot is taken. */
  public delay = 0;
  /** Navigation / wait timeout in milliseconds (`0` disables it). */
  public timeout = 30000;
  /** Maximum number of pages captured at the same time. */
  public concurrency = 4;
}

export class AltimeterDestination {
  public name: string;
  public url: string;

  constructor(name: string, url: string) {
    this.name = name;
    this.url = url;
  }
}

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

const WAIT_UNTIL_VALUES: WaitUntil[] = [
  "load",
  "domcontentloaded",
  "networkidle",
  "commit",
];

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
const isNonNegativeNumber: Check = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? undefined
    : "must be a non-negative number";
const isOneOf =
  (values: readonly string[]): Check =>
  (v) =>
    values.includes(v as string)
      ? undefined
      : "must be one of " + values.map((x) => JSON.stringify(x)).join(", ");
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

const CHECKS: Record<keyof AltimeterConfig, Check> = {
  browser: isOneOf(Object.values(BrowserTypes)),
  channel: isNonEmptyString,
  executablePath: isNonEmptyString,
  baseURL: isURL,
  destURLs: () => undefined, // validated separately below
  dir: isString,
  width: isPositiveInt,
  height: isPositiveInt,
  waitUntil: isOneOf(WAIT_UNTIL_VALUES),
  waitForSelector: isNonEmptyString,
  delay: isNonNegativeNumber,
  timeout: isNonNegativeNumber,
  concurrency: isPositiveInt,
};

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
  const known = Object.keys(CHECKS);
  const problems: string[] = [];

  for (const key of Object.keys(input)) {
    if (!known.includes(key)) {
      const match = known.find((k) => k.toLowerCase() === key.toLowerCase());
      warn(
        "Unknown config key `" +
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
    const err = CHECKS[key as keyof AltimeterConfig](value);
    if (err !== undefined) {
      problems.push("`" + key + "` " + err);
    }
  }

  if (input.baseURL === undefined) {
    problems.push("`baseURL` is required");
  }
  problems.push(...checkDestinations(input.destURLs));

  if (problems.length > 0) {
    throw new AltimeterConfigError(problems);
  }

  const config = new AltimeterConfig();
  for (const key of known) {
    if (input[key] !== undefined) {
      Object.assign(config, { [key]: input[key] });
    }
  }
  return config;
}

function checkDestinations(destURLs: unknown): string[] {
  if (destURLs === undefined) {
    return [];
  }
  if (!Array.isArray(destURLs)) {
    return ["`destURLs` must be an array"];
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  destURLs.forEach((dest, i) => {
    const where = "`destURLs[" + i + "]`";
    if (typeof dest !== "object" || dest === null) {
      problems.push(where + " must be an object with `name` and `url`");
      return;
    }
    const { name, url } = dest as Record<string, unknown>;
    if (typeof name !== "string" || name.length === 0) {
      problems.push(where + ".name must be a non-empty string");
    } else if (seen.has(name)) {
      problems.push(where + ".name `" + name + "` is used more than once");
    } else {
      seen.add(name);
    }
    if (typeof url !== "string") {
      problems.push(where + ".url must be a string");
    }
  });
  return problems;
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

/**
 * Captures every configured destination. Failures are reported per page
 * instead of aborting the whole run; check `error` on the returned results.
 */
export async function genRun(
  config: AltimeterConfig,
): Promise<AltimeterResult[]> {
  if (config.baseURL === undefined) {
    throw new AltimeterConfigError(["`baseURL` is required"]);
  }
  const baseURL = config.baseURL;

  const destinations =
    config.destURLs.length > 0
      ? config.destURLs
      : [new AltimeterDestination("base", "")];

  const browser = await launchBrowser(config);
  try {
    return await mapWithConcurrency(
      destinations,
      config.concurrency,
      async (destination) => {
        const url = joinURL(baseURL, destination.url);
        try {
          const path = await genScreenShot(
            config,
            browser,
            destination.name,
            url,
          );
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

async function genScreenShot(
  config: AltimeterConfig,
  browser: Browser,
  name: string,
  url: string,
): Promise<string> {
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      screen: { width: config.width, height: config.height },
      viewport: {
        width: config.width,
        height: config.height,
      },
      isMobile: false,
    });
    context.setDefaultTimeout(config.timeout);
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: config.waitUntil });
    if (response !== null && response.status() >= 400) {
      throw new Error("Page responded with HTTP " + response.status());
    }
    if (config.waitForSelector !== undefined) {
      await page.waitForSelector(config.waitForSelector, { state: "visible" });
    }
    if (config.delay > 0) {
      await page.waitForTimeout(config.delay);
    }

    const path = normalizeDir(config.dir) + name + ".jpg";
    await page.screenshot({
      animations: "disabled",
      fullPage: false,
      type: "jpeg",
      path,
      clip: {
        x: 0,
        y: 0,
        width: config.width,
        height: config.height,
      },
    });
    return path;
  } finally {
    await context?.close();
  }
}
