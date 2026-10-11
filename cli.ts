import { existsSync, readFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import { exit } from "process";
import { parseArgs } from "util";
import { genRun, parseConfig, AltimeterConfig, AltimeterConfigError } from ".";

const DEFAULT_CONFIG = "altimeter.config.json";

const USAGE = `Usage: altimeter [config.json | url] [options]

Takes preview screenshots of the pages listed in a config file, or of a single
URL. Without arguments, ${DEFAULT_CONFIG} in the current directory is used.

Options (override the config file):
  --dir <path>            Output directory
  --width <px>            Viewport width
  --height <px>           Viewport height
  --format <jpeg|png>     Image format
  --quality <0-100>       JPEG quality
  --scale <n>             Device scale factor, eg. 2 for retina images
  --color-scheme <light|dark|no-preference>
  --browser <chromium|firefox|webkit>
  --wait-until <load|domcontentloaded|networkidle|commit>
  --wait-for <selector>   Wait for an element to be visible
  --delay <ms>            Extra wait before the screenshot
  --selector <selector>   Capture only this element
  -h, --help              Show this help`;

// CLI flag -> config key, and whether the value is numeric.
const FLAGS: Record<string, [string, boolean]> = {
  dir: ["dir", false],
  width: ["width", true],
  height: ["height", true],
  format: ["format", false],
  quality: ["quality", true],
  scale: ["deviceScaleFactor", true],
  "color-scheme": ["colorScheme", false],
  browser: ["browser", false],
  "wait-until": ["waitUntil", false],
  "wait-for": ["waitForSelector", false],
  delay: ["delay", true],
  selector: ["selector", false],
};

function isURL(arg: string): boolean {
  return /^https?:\/\//i.test(arg);
}

function readConfig(path: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const dir = raw.dir ?? new AltimeterConfig().dir;
    if (typeof dir === "string") {
      // Output paths in a config file are relative to the file itself, so the
      // result does not depend on where altimeter is run from.
      raw.dir = relative(process.cwd(), resolve(dirname(path), dir));
    }
  }
  return raw;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      ...Object.fromEntries(
        Object.keys(FLAGS).map((flag) => [flag, { type: "string" as const }]),
      ),
    },
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length > 1) {
    console.error(USAGE);
    return 1;
  }

  const target = positionals[0];
  let raw: Record<string, unknown>;
  if (target !== undefined && isURL(target)) {
    raw = { baseURL: target };
  } else {
    const path = target ?? DEFAULT_CONFIG;
    if (target === undefined && !existsSync(path)) {
      console.error(
        "No " + DEFAULT_CONFIG + " found. Pass a config file or a URL.\n",
      );
      console.error(USAGE);
      return 1;
    }
    try {
      raw = readConfig(path);
    } catch (err) {
      console.error(
        "Could not read config file " + path + ": " + (err as Error).message,
      );
      return 1;
    }
  }

  for (const [flag, [key, numeric]] of Object.entries(FLAGS)) {
    const value = (values as Record<string, string | undefined>)[flag];
    if (value !== undefined && typeof raw === "object" && raw !== null) {
      raw[key] = numeric ? Number(value) : value;
    }
  }

  const config = parseConfig(raw);
  const results = await genRun(config);
  const failed = results.filter((r) => r.error !== undefined).length;
  if (failed > 0) {
    console.error(failed + " of " + results.length + " screenshot(s) failed.");
    return 1;
  }
  return 0;
}

main().then(exit, (err) => {
  if (err instanceof AltimeterConfigError) {
    console.error(err.message);
  } else if (
    err instanceof Error &&
    "code" in err &&
    /^ERR_PARSE_ARGS/.test(String(err.code))
  ) {
    console.error(err.message + "\n\n" + USAGE);
  } else {
    console.error(err);
  }
  exit(1);
});
