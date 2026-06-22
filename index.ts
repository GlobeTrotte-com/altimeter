import { Browser, chromium, firefox, webkit } from "playwright-core";

export enum BrowserTypes {
  Chromium = "chromium",
  Firefox = "firefox",
  Webkit = "webkit",
}

export class AltimeterConfig {
  public browser: BrowserTypes = BrowserTypes.Chromium;
  public baseURL?: string;
  public destURLs: AltimeterDestination[] = [];
  public dir = "altimeter";
  public width = 1200;
  public height = 600;
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

export async function genRun(config: AltimeterConfig): Promise<void> {
  let browser: Browser;
  switch (config.browser) {
    case BrowserTypes.Chromium:
      browser = await chromium.launch();
      break;
    case BrowserTypes.Firefox:
      browser = await firefox.launch();
      break;
    case BrowserTypes.Webkit:
      browser = await webkit.launch();
      break;
  }

  if (config.destURLs.length < 1) {
    await genScreenShot(config, browser, "base", "");
    await browser.close();
    return;
  }

  await Promise.all(
    config.destURLs.map(async (destination) => {
      return await genScreenShot(
        config,
        browser,
        destination.name,
        destination.url,
      );
    }),
  );
  await browser.close();
  return;
}

async function genScreenShot(
  config: AltimeterConfig,
  browser: Browser,
  name: string,
  path: string,
): Promise<void> {
  if (config.baseURL === undefined) {
    console.error("`baseURL` cannot be `undefined`.");
    process.exit(1);
  }
  const baseURL = config.baseURL;

  const env = await browser.newContext({
    baseURL: baseURL,
    screen: { width: config.width, height: config.height },
    viewport: {
      width: config.width,
      height: config.height,
    },
    isMobile: false,
  });
  const page = await env.newPage();
  await page.goto(joinURL(baseURL, path));
  await page.waitForLoadState("networkidle");

  const dir = normalizeDir(config.dir);

  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    type: "jpeg",
    path: dir + name + ".jpg",
    clip: {
      x: 0,
      y: 0,
      width: config.width,
      height: config.height,
    },
  });

  console.log("Generated " + dir + name + ".jpg");
}
