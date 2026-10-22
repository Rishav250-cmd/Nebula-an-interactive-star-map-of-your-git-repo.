export class GraphError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "GraphError";
    this.statusCode = statusCode;
  }
}

export function parseGitHubRepoUrl(repoUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(repoUrl);
  } catch {
    throw new GraphError(400, "repoUrl must be a valid public GitHub repository URL.");
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "github.com" ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new GraphError(400, "repoUrl must be an HTTPS URL on github.com.");
  }

  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
  if (pathParts.length !== 2) {
    throw new GraphError(400, "repoUrl must point to a repository, such as https://github.com/owner/repo.");
  }

  const [owner, rawRepository] = pathParts;
  const repository = rawRepository.replace(/\.git$/i, "");
  const validSegment = /^[A-Za-z0-9_.-]+$/;

  if (!validSegment.test(owner) || !validSegment.test(repository)) {
    throw new GraphError(400, "repoUrl contains an invalid owner or repository name.");
  }

  return { owner, repository };
}
