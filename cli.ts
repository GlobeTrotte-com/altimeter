import { readFileSync } from "fs";
import { exit } from "process";
import { genRun, parseConfig, AltimeterConfigError } from ".";

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error("Please define a config file.");
    return 1;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(args[0], "utf8"));
  } catch (err) {
    console.error(
      "Could not read config file " + args[0] + ": " + (err as Error).message,
    );
    return 1;
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
  } else {
    console.error(err);
  }
  exit(1);
});
