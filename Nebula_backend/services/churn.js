import { simpleGit } from "simple-git";
import { countChurn } from "../utils/churn.js";

const GIT_TIMEOUT_MS = 30_000;

export async function getChurn(dir, { months = 12 } = {}) {
  try {
    const git = simpleGit({
      baseDir: dir,
      timeout: { block: GIT_TIMEOUT_MS },
    });
    const shallow = (await git.raw(["rev-parse", "--is-shallow-repository"]))
      .trim()
      .toLowerCase();
    if (shallow === "true") return new Map();

    const output = await git.raw([
      "log",
      `--since=${months}.months`,
      "--name-only",
      "--pretty=format:",
    ]);
    if (!output.trim()) return new Map();

    return countChurn(output);
  } catch {
    return new Map();
  }
}
