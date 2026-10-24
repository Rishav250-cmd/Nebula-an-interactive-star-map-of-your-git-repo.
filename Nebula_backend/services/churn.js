import { simpleGit } from "simple-git";

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

    const churn = new Map();
    let commitPaths = new Set();

    function countCommitPaths() {
      for (const filePath of commitPaths) {
        churn.set(filePath, (churn.get(filePath) ?? 0) + 1);
      }
      commitPaths = new Set();
    }

    for (const line of output.split(/\r?\n/)) {
      const filePath = line.replace(/\r$/, "");
      if (!filePath.trim()) {
        countCommitPaths();
      } else {
        commitPaths.add(filePath);
      }
    }
    countCommitPaths();

    return churn;
  } catch {
    return new Map();
  }
}
