import { describe, expect, it } from "vitest";
import {
  classify,
  classifyPackageJson,
  Commit,
  isDevOnly,
  isPatchOnly,
  nextVersion,
  planRelease,
} from "./release-plan";

const commit = (
  subject: string,
  files: string[],
  author = "BH",
  sha = "0123456789abcdef",
): Commit => ({ sha, author, subject, files });

const dependabot = (subject: string, files = ["package.json"]) =>
  commit(subject, files, "dependabot[bot]");

describe("isDevOnly", () => {
  it.each([
    ".github/workflows/ci.yml",
    "test/server.ts",
    "scripts/release-plan.ts",
    "cli.test.ts",
    "vitest.config.ts",
    "eslint.config.js",
    ".gitignore",
    ".release-please-manifest.json",
    "CHANGELOG.md",
    "package-lock.json",
    "release-please-config.json",
  ])("treats %s as dev only", (path) => {
    expect(isDevOnly(path)).toBe(true);
  });

  it.each(["index.ts", "cli.ts", "bin/cli.js", "package.json", "README.md"])(
    "treats %s as part of the package",
    (path) => {
      expect(isDevOnly(path)).toBe(false);
    },
  );
});

describe("isPatchOnly", () => {
  it.each([
    "README.md",
    "LICENSE",
    "doc/config.json",
    "tsconfig.json",
    "tsconfig.build.json",
  ])("treats %s as docs or build config", (path) => {
    expect(isPatchOnly(path)).toBe(true);
  });

  it.each(["index.ts", "cli.ts", "bin/cli.js", "package.json"])(
    "treats %s as code",
    (path) => {
      expect(isPatchOnly(path)).toBe(false);
    },
  );
});

const pkg = (fields: Record<string, unknown>) =>
  JSON.stringify({ name: "@globetrotte/altimeter", version: "0.0.0", ...fields });

describe("classifyPackageJson", () => {
  it("makes changes to what users install or import a minor bump", () => {
    const before = pkg({ dependencies: { "playwright-core": "^1.65.1" } });
    for (const fields of [
      { dependencies: { "playwright-core": "^1.66.0" } },
      { dependencies: {}, peerDependencies: { "playwright-core": "*" } },
      { dependencies: { "playwright-core": "^1.65.1" }, main: "dist/x.js" },
      { dependencies: { "playwright-core": "^1.65.1" }, bin: { a: "a.js" } },
      { dependencies: { "playwright-core": "^1.65.1" }, engines: { node: ">=24" } },
    ]) {
      expect(classifyPackageJson(before, pkg(fields))).toBe("minor");
    }
  });

  it("makes a new package.json a minor bump", () => {
    expect(classifyPackageJson(undefined, pkg({}))).toBe("minor");
  });

  it("makes metadata and script changes a patch", () => {
    expect(
      classifyPackageJson(pkg({ keywords: ["a"] }), pkg({ keywords: ["a", "b"] })),
    ).toBe("patch");
    expect(
      classifyPackageJson(
        pkg({ scripts: { test: "vitest" } }),
        pkg({ scripts: { test: "vitest run" }, version: "0.0.0-development" }),
      ),
    ).toBe("patch");
  });

  it("ignores dev dependency and override changes", () => {
    expect(
      classifyPackageJson(
        pkg({ devDependencies: { vitest: "^4" } }),
        pkg({ devDependencies: { vitest: "^5" }, overrides: { minimatch: "^11" } }),
      ),
    ).toBeUndefined();
    expect(classifyPackageJson(pkg({}), pkg({}))).toBeUndefined();
  });
});

describe("classify", () => {
  it("makes runtime dependency updates from Dependabot a patch", () => {
    expect(classify(dependabot("fix(deps): bump playwright-core"))).toBe(
      "patch",
    );
    expect(
      classify(
        dependabot("build(deps): bump playwright-core", [
          "package.json",
          "package-lock.json",
        ]),
      ),
    ).toBe("patch");
  });

  it("ignores Dependabot updates to dev tooling and actions", () => {
    expect(classify(dependabot("chore(deps-dev): bump vitest"))).toBeUndefined();
    expect(classify(dependabot("build(deps-dev): bump eslint"))).toBeUndefined();
    expect(
      classify(dependabot("ci(deps): bump actions/checkout", [".github/x.yml"])),
    ).toBeUndefined();
    expect(
      classify(dependabot("build(deps): bump actions/setup-node", [".github/x.yml"])),
    ).toBeUndefined();
    expect(
      classify(dependabot("build(deps): bump minimatch", ["package-lock.json"])),
    ).toBeUndefined();
  });

  it("makes code changes a minor bump", () => {
    expect(classify(commit("Add --full-page", ["index.ts", "cli.test.ts"]))).toBe(
      "minor",
    );
    expect(classify(commit("Docs and code", ["README.md", "cli.ts"]))).toBe(
      "minor",
    );
  });

  it("makes docs and build config changes a patch", () => {
    expect(classify(commit("Fix README typo", ["README.md"]))).toBe("patch");
    expect(
      classify(commit("Tighten build", ["tsconfig.build.json", "doc/config.json"])),
    ).toBe("patch");
  });

  it("checks which package.json fields changed", () => {
    const metadata = {
      ...commit("Weekly releases", ["package.json", "README.md", "scripts/x.ts"]),
      packageJson: {
        before: pkg({ version: "0.1.0", scripts: {} }),
        after: pkg({ version: "0.0.0-development", scripts: { x: "y" } }),
      },
    };
    expect(classify(metadata)).toBe("patch");

    const dependency = {
      ...commit("Add sharp", ["package.json", "package-lock.json"]),
      packageJson: {
        before: pkg({ dependencies: {} }),
        after: pkg({ dependencies: { sharp: "^1" } }),
      },
    };
    expect(classify(dependency)).toBe("minor");

    const devTooling = {
      ...commit("Bump vitest", ["package.json", "package-lock.json"]),
      packageJson: {
        before: pkg({ devDependencies: { vitest: "^4" } }),
        after: pkg({ devDependencies: { vitest: "^5" } }),
      },
    };
    expect(classify(devTooling)).toBeUndefined();

    // Without the file contents, assume the worst.
    expect(classify(commit("Unknown", ["package.json"]))).toBe("minor");
  });

  it("ignores changes to CI, tests and dev tooling only", () => {
    expect(
      classify(commit("More tests", ["index.test.ts", "test/server.ts"])),
    ).toBeUndefined();
    expect(classify(commit("Empty", []))).toBeUndefined();
  });
});

describe("nextVersion", () => {
  it("bumps each part and resets the lower ones", () => {
    expect(nextVersion("0.1.3", "patch")).toBe("0.1.4");
    expect(nextVersion("0.1.3", "minor")).toBe("0.2.0");
    expect(nextVersion("0.1.3", "major")).toBe("1.0.0");
  });

  it("rejects versions it can't bump", () => {
    expect(() => nextVersion("1.0.0-beta.1", "patch")).toThrow(
      "Not a release version",
    );
  });
});

describe("planRelease", () => {
  it("skips the week when nothing merged", () => {
    expect(planRelease("0.1.0", [])).toEqual({
      release: false,
      reason: "Nothing merged since v0.1.0.",
    });
  });

  it("skips the week when only dev changes merged", () => {
    const plan = planRelease("0.1.0", [
      dependabot("chore(deps-dev): bump vitest"),
      commit("ci: tweak", [".github/workflows/ci.yml"]),
    ]);
    expect(plan.release).toBe(false);
    expect(plan.reason).toMatch(/Only CI, test or dev tooling/);
  });

  it("bumps the patch number for Dependabot runtime updates only", () => {
    const plan = planRelease("0.1.0", [
      dependabot("fix(deps): bump playwright-core from 1.65.1 to 1.66.0 (#50)"),
      dependabot("chore(deps-dev): bump vitest (#51)"),
    ]);
    expect(plan).toMatchObject({ release: true, bump: "patch", version: "0.1.1" });
    expect(plan.notes).toContain("## Dependency updates");
    expect(plan.notes).toContain("bump playwright-core from 1.65.1 to 1.66.0 (#50)");
    expect(plan.notes).not.toContain("vitest");
    expect(plan.notes).not.toContain("## Changes");
  });

  it("bumps the patch number for docs and build config changes", () => {
    const plan = planRelease("0.1.0", [
      commit("Clarify the README (#46)", ["README.md"]),
      dependabot("fix(deps): bump playwright-core (#47)"),
    ]);
    expect(plan).toMatchObject({ release: true, bump: "patch", version: "0.1.1" });
    expect(plan.notes).toContain("## Changes\n\n- Clarify the README (#46)");
    expect(plan.notes).toContain("## Dependency updates");
  });

  it("bumps the minor number when code changed", () => {
    const plan = planRelease("0.1.4", [
      dependabot("fix(deps): bump playwright-core (#60)"),
      commit("Add a --full-page flag (#61)", ["index.ts", "cli.ts"]),
    ]);
    expect(plan).toMatchObject({ release: true, bump: "minor", version: "0.2.0" });
    expect(plan.notes).toBe(
      [
        "## Changes",
        "",
        "- Add a --full-page flag (#61) (0123456)",
        "",
        "## Dependency updates",
        "",
        "- fix(deps): bump playwright-core (#60) (0123456)",
        "",
        "**Full diff:** https://github.com/GlobeTrotte-com/altimeter/compare/v0.1.4...v0.2.0",
      ].join("\n"),
    );
  });

  it("releases with a forced bump even when nothing would release", () => {
    expect(planRelease("0.9.2", [], "major")).toMatchObject({
      release: true,
      bump: "major",
      version: "1.0.0",
    });
    expect(planRelease("0.9.2", [], "patch").notes).toMatch(
      /^No user-facing changes\./,
    );
  });
});
