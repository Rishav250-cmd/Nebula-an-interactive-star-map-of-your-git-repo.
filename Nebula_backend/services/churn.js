import { simpleGit } from "simple-git";
import { countChurn } from "../utils/churn.js";

const GIT_TIMEOUT_MS = 30_000;

export async function getChurn(dir, { months = 12 } = {}) {
  try {
    const git = simpleGit({
      baseDir: dir,
      timeout: { block: GIT_TIMEOUT_MS },
    });
    const sinceDate = new Date();
    sinceDate.setMonth(sinceDate.getMonth() - months);
    const since = sinceDate.toISOString().slice(0, 10);
    const shallow = (await git.raw(["rev-parse", "--is-shallow-repository"]))
      .trim()
      .toLowerCase();
    if (shallow === "true") {
      const remote = await git.raw(["remote", "get-url", "origin"]).catch(() => "");
      if (!remote.trim()) return new Map();
      await git.raw([
        "fetch",
        "--quiet",
        `--shallow-since=${since}`,
        "--filter=blob:none",
        "origin",
      ]);
    }

    const output = await git.raw([
      "log",
      `--since=${since}`,
      "--name-only",
      "--pretty=format:",
    ]);
    if (!output.trim()) return new Map();

    return countChurn(output);
  } catch {
    return new Map();
  }
}
