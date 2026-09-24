import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

const origin = git(["remote", "get-url", "origin"]);
if (origin !== "https://github.com/dave-schmidt-dev/todojo.git")
  throw new Error(
    "The configured origin does not match the expected public repository.",
  );
if (git(["status", "--porcelain", "--untracked-files=normal"]))
  throw new Error("The repository is not clean.");
if (git(["ls-files", "--", ".data", ".logs", "dist", "HISTORY.md", "TASKS.md"]))
  throw new Error("Local runtime or operational files are tracked.");
console.log(
  "Clean tree, expected public origin, and ignored runtime paths verified.",
);
