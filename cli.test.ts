import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const genRun = vi.hoisted(() => vi.fn());
vi.mock("./index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./index")>()),
  genRun,
}));

import { AltimeterConfig, AltimeterConfigError } from "./index";
import { main, reportError, run } from "./cli";

let cwd: string;
let work: string;
let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

const output = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");
const lastConfig = (): AltimeterConfig => genRun.mock.calls.at(-1)?.[0];

beforeAll(() => {
  cwd = process.cwd();
  work = mkdtempSync(join(tmpdir(), "altimeter-cli-"));
  process.chdir(work);
});

afterAll(() => {
  process.chdir(cwd);
  rmSync(work, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  genRun.mockReset();
  genRun.mockResolvedValue([{ name: "base", url: "", path: "x.jpg" }]);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("main", () => {
  it("prints the usage with --help", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(output(log)).toMatch(/^Usage: altimeter/);
    expect(genRun).not.toHaveBeenCalled();
  });

  it("rejects more than one positional argument", async () => {
    expect(await main(["a.json", "b.json"])).toBe(1);
    expect(output(error)).toMatch(/Usage: altimeter/);
  });

  it("asks for a config or URL when there is no default config", async () => {
    expect(await main([])).toBe(1);
    expect(output(error)).toMatch(/No altimeter\.config\.json found/);
  });

  it("captures a single URL and applies flags over the defaults", async () => {
    expect(
      await main([
        "https://example.com",
        "--width",
        "800",
        "--scale",
        "2",
        "--format",
        "png",
        "--dir",
        "shots",
      ]),
    ).toBe(0);

    const config = lastConfig();
    expect(config).toBeInstanceOf(AltimeterConfig);
    expect(config.baseURL).toBe("https://example.com");
    expect(config.width).toBe(800);
    expect(config.deviceScaleFactor).toBe(2);
    expect(config.format).toBe("png");
    expect(config.dir).toBe("shots");
  });

  it("reads altimeter.config.json from the working directory", async () => {
    writeFileSync(
      "altimeter.config.json",
      JSON.stringify({ baseURL: "https://example.com" }),
    );
    try {
      expect(await main([])).toBe(0);
      expect(lastConfig().dir).toBe("altimeter");
    } finally {
      rmSync("altimeter.config.json");
    }
  });

  it("resolves dir relative to the config file", async () => {
    mkdirSync("site", { recursive: true });
    writeFileSync(
      join("site", "preview.json"),
      JSON.stringify({ baseURL: "https://example.com", dir: "img" }),
    );

    expect(await main([join("site", "preview.json")])).toBe(0);
    expect(lastConfig().dir).toBe(join("site", "img"));
  });

  it("reports a config file that cannot be read", async () => {
    writeFileSync("broken.json", "{ not json");

    expect(await main(["broken.json"])).toBe(1);
    expect(output(error)).toMatch(/Could not read config file broken\.json/);
  });

  it("leaves non-object configs to the validator", async () => {
    writeFileSync("list.json", "[]");

    await expect(main(["list.json"])).rejects.toBeInstanceOf(
      AltimeterConfigError,
    );
  });

  it("exits non-zero when any screenshot fails", async () => {
    genRun.mockResolvedValue([
      { name: "a", url: "", path: "a.jpg" },
      { name: "b", url: "", error: new Error("nope") },
    ]);

    expect(await main(["https://example.com"])).toBe(1);
    expect(output(error)).toMatch(/1 of 2 screenshot\(s\) failed\./);
  });
});

describe("reportError", () => {
  it("prints config errors without a stack trace", () => {
    expect(reportError(new AltimeterConfigError(["`width` bad"]))).toBe(1);
    expect(output(error)).toBe("Invalid config:\n  - `width` bad");
  });

  it("adds the usage to argument errors", () => {
    const err = Object.assign(new Error("Unknown option '--x'"), {
      code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
    });
    expect(reportError(err)).toBe(1);
    expect(output(error)).toMatch(/^Unknown option '--x'\n\nUsage:/);
  });

  it("prints anything else as is", () => {
    const err = new Error("boom");
    expect(reportError(err)).toBe(1);
    expect(error).toHaveBeenCalledWith(err);
  });
});

describe("run", () => {
  it("exits with the code from main", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    await run(["--help"]);
    expect(exit).toHaveBeenCalledWith(0);

    await run(["--nope"]);
    expect(exit).toHaveBeenLastCalledWith(1);
    expect(output(error)).toMatch(/Unknown option '--nope'/);
  });
});
