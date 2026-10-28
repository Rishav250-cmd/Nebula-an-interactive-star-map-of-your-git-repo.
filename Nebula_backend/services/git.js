import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { simpleGit } from "simple-git";

const execFile = promisify(execFileCallback);

export async function getRemoteHeadSha(url) {
  try {
    const { stdout } = await execFile("git", ["ls-remote", url, "HEAD"], {
      timeout: 8_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    const sha = stdout.trim().split(/\s+/)[0];
    return /^[a-f\d]{40,64}$/i.test(sha ?? "") ? sha : null;
  } catch (error) {
    console.warn("Could not check remote repository SHA");
    return null;
  }
}

export async function getHeadSha(directory) {
  return (await simpleGit(directory).revparse(["HEAD"])).trim();
}
