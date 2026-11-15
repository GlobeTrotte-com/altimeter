import { describe, expect, it } from "vitest";
import {
  classify,
  Commit,
  isDevOnly,
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

describe("classify", () => {
  it("makes runtime dependency updates from Dependabot a patch", () => {
    expect(classify(dependabot("fix(deps): bump playwright-core"))).toBe(
      "patch",
    );
    expect(
      classify(dependabot("build(deps): bump playwright-core", ["package-lock.json"])),
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
  });

  it("makes any other change to the package a minor bump", () => {
    expect(classify(commit("Add --full-page", ["index.ts", "cli.test.ts"]))).toBe(
      "minor",
    );
    expect(classify(commit("Fix README typo", ["README.md"]))).toBe("minor");
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

  it("bumps the minor number when anything else merged", () => {
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
