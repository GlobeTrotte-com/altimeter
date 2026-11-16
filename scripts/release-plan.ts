// Works out the weekly release: whether anything merged since the last tag
// is worth releasing, which version number to bump, and the release notes.
//
// Run by .github/workflows/release.yml with Node's built-in TypeScript
// support (`node scripts/release-plan.ts`), so it only uses erasable syntax.

import { execFileSync } from "child_process";
import { appendFileSync } from "fs";
import { fileURLToPath } from "url";

export type Bump = "major" | "minor" | "patch";
export type BumpInput = Bump | "auto";

export interface Commit {
  sha: string;
  author: string;
  subject: string;
  files: string[];
  /** package.json before and after the commit, when the commit changed it. */
  packageJson?: { before?: string; after?: string };
}

export interface ReleasePlan {
  release: boolean;
  /** Why there is nothing to release, when `release` is false. */
  reason?: string;
  bump?: Bump;
  version?: string;
  notes?: string;
}

type Level = "minor" | "patch" | undefined;

const DEPENDABOT = "dependabot[bot]";

// Dependabot titles dev tooling updates `chore(deps-dev): ...` (and used
// `build(deps-dev): ...` before). Those don't change what users install.
const DEV_DEPENDENCY = /\(deps-dev\)/;

// Files that don't change the published package or how it behaves.
const DEV_ONLY = [
  /^\.[^/]+/, // .github/, .gitignore and other dotfiles at the root
  /^test\//,
  /^scripts\//,
  /\.test\.ts$/,
  /^vitest\.config\.ts$/,
  /^eslint\.config\.js$/,
  /^CHANGELOG\.md$/,
  /^release-please-config\.json$/, // release tooling, removed after 0.1.0
  // npm doesn't publish the lockfile; dependency changes show in package.json.
  /^package-lock\.json$/,
];

// Docs and build config: worth shipping, but not new behaviour.
const PATCH_ONLY = [
  /^README\.md$/,
  /^LICENSE$/,
  /^doc\//,
  /^tsconfig(\.[^/]*)?\.json$/,
];

// package.json fields that change what users install or import. Changing any
// of them counts like a code change; other fields (version, description,
// keywords, scripts ...) count like docs and build config.
const PACKAGE_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundleDependencies",
  "main",
  "module",
  "types",
  "exports",
  "bin",
  "files",
  "engines",
  "type",
];

// package.json fields that only affect development.
const DEV_FIELDS = ["devDependencies", "overrides"];

export function isDevOnly(path: string): boolean {
  return DEV_ONLY.some((pattern) => pattern.test(path));
}

export function isPatchOnly(path: string): boolean {
  return PATCH_ONLY.some((pattern) => pattern.test(path));
}

function parse(json: string | undefined): Record<string, unknown> {
  return json === undefined ? {} : JSON.parse(json);
}

/** How a change to package.json affects the next release. */
export function classifyPackageJson(before?: string, after?: string): Level {
  const old = parse(before);
  const next = parse(after);
  const changed = [...new Set([...Object.keys(old), ...Object.keys(next)])]
    .filter((key) => JSON.stringify(old[key]) !== JSON.stringify(next[key]));
  if (before === undefined || changed.some((k) => PACKAGE_FIELDS.includes(k))) {
    return "minor";
  }
  return changed.some((k) => !DEV_FIELDS.includes(k)) ? "patch" : undefined;
}

function max(a: Level, b: Level): Level {
  return a === "minor" || b === "minor" ? "minor" : (a ?? b);
}

/**
 * How a merged commit affects the next release:
 * - Dependabot: runtime dependency updates are a patch; dev tooling updates
 *   don't release.
 * - Anyone else: code and package changes (exports, dependencies ...) are a
 *   minor bump; docs, build config and package.json metadata only are a
 *   patch.
 * - Changes to CI, tests or dev tooling alone don't release.
 */
export function classify(commit: Commit): Level {
  const files = commit.files.filter((f) => !isDevOnly(f));
  if (files.length === 0) {
    return undefined;
  }
  if (commit.author === DEPENDABOT) {
    return DEV_DEPENDENCY.test(commit.subject) ? undefined : "patch";
  }
  let level: Level;
  for (const file of files) {
    if (file === "package.json") {
      const { before, after } = commit.packageJson ?? {};
      level = max(level, classifyPackageJson(before, after));
    } else {
      level = max(level, isPatchOnly(file) ? "patch" : "minor");
    }
  }
  return level;
}

export function nextVersion(current: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (match === null) {
    throw new Error("Not a release version: " + current);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function section(title: string, commits: Commit[]): string[] {
  if (commits.length === 0) {
    return [];
  }
  return [
    "## " + title,
    "",
    ...commits.map((c) => `- ${c.subject} (${c.sha.slice(0, 7)})`),
    "",
  ];
}

/**
 * Plans the release after `lastVersion` from the commits merged since then,
 * oldest first. A bump other than "auto" forces a release of that size.
 */
export function planRelease(
  lastVersion: string,
  commits: Commit[],
  bumpInput: BumpInput = "auto",
): ReleasePlan {
  const releasing = commits.filter((c) => classify(c) !== undefined);
  const changes = releasing.filter((c) => c.author !== DEPENDABOT);
  const dependencies = releasing.filter((c) => c.author === DEPENDABOT);
  const level = releasing.map(classify).reduce(max, undefined);

  let bump: Bump;
  if (bumpInput !== "auto") {
    bump = bumpInput;
  } else if (level !== undefined) {
    bump = level;
  } else {
    return {
      release: false,
      reason:
        commits.length === 0
          ? "Nothing merged since v" + lastVersion + "."
          : "Only CI, test or dev tooling changes since v" + lastVersion + ".",
    };
  }

  const version = nextVersion(lastVersion, bump);
  const lines = [
    ...section("Changes", changes),
    ...section("Dependency updates", dependencies),
  ];
  if (lines.length === 0) {
    lines.push("No user-facing changes.", "");
  }
  lines.push(
    `**Full diff:** https://github.com/GlobeTrotte-com/altimeter/compare/v${lastVersion}...v${version}`,
  );
  return { release: true, bump, version, notes: lines.join("\n") };
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Reads the commits on the first-parent history since `tag`, oldest first. */
export function readCommits(tag: string): Commit[] {
  const log = git(
    "log",
    "--first-parent",
    "--reverse",
    "--format=%H%x1f%an%x1f%s",
    tag + "..HEAD",
  );
  if (log === "") {
    return [];
  }
  return log.split("\n").map((line) => {
    const [sha, author, subject] = line.split("\x1f");
    const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", sha)
      .split("\n")
      .filter((f) => f !== "");
    const commit: Commit = { sha, author, subject, files };
    if (files.includes("package.json")) {
      commit.packageJson = {
        before: show(sha + "^:package.json"),
        after: show(sha + ":package.json"),
      };
    }
    return commit;
  });
}

/** Reads a file at a revision, or undefined when it doesn't exist there. */
function show(spec: string): string | undefined {
  try {
    return execFileSync("git", ["show", spec], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function main(): void {
  const bumpInput = (process.env.BUMP || "auto") as BumpInput;
  if (!["auto", "major", "minor", "patch"].includes(bumpInput)) {
    throw new Error("BUMP must be auto, major, minor or patch");
  }
  const tag = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*");
  const plan = planRelease(tag.slice(1), readCommits(tag), bumpInput);

  const summary = plan.release
    ? `### Releasing v${plan.version} (${plan.bump})\n\n${plan.notes}\n`
    : `### No release\n\n${plan.reason}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  if (process.env.GITHUB_OUTPUT) {
    const delimiter = "NOTES_" + Date.now();
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `release=${plan.release}`,
        `version=${plan.version ?? ""}`,
        `sha=${git("rev-parse", "HEAD")}`,
        `notes<<${delimiter}`,
        plan.notes ?? "",
        delimiter,
        "",
      ].join("\n"),
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
