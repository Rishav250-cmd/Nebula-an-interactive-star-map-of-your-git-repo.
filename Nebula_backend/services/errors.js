const ERROR_CATALOG = Object.freeze({
  INVALID_URL: [400, "Invalid GitHub URL", "Provide a public GitHub repository URL."],
  REPO_NOT_FOUND: [404, "Repository not found, or it is private", "Only public GitHub repositories are supported"],
  EMPTY_REPO: [422, "This repository has no commits yet", "Choose a repository with at least one commit."],
  NO_SUPPORTED_FILES: [422, "No JavaScript or TypeScript files found", "The repository must contain supported source files."],
  REPO_TOO_LARGE: [413, "Repository exceeds the configured size limit", "Try a smaller repository or upload a zip of a single folder"],
  CLONE_TIMEOUT: [504, "Repository clone timed out", "Try again later or use a smaller repository."],
  CLONE_FAILED: [502, "Could not clone repository", "Try again later."],
  RATE_LIMITED: [429, "GitHub API rate limit exceeded", "Try again after the rate limit resets."],
  BUSY: [503, "Nebula is busy", "Try again shortly."],
  UNKNOWN_ID: [404, "Unknown repository id", "Analyze the repository before requesting this resource."],
  JOB_TIMEOUT: [504, "Analysis job exceeded the 3 minute timeout.", "Try a smaller repository."],
  BAD_UPLOAD: [400, "Could not process uploaded repository.", "Upload a valid ZIP file."],
  UPLOAD_TOO_LARGE: [413, "ZIP upload exceeds the 50 MB limit.", "Upload a smaller ZIP file."],
  INTERNAL: [500, "An internal error occurred", "Try again later."],
  UNKNOWN_ROUTE: [404, "API endpoint not found", "Check the API route and try again."],
  INVALID_QUERY: [400, "Invalid request parameters", "Check the request parameters and try again."],
  FILE_NOT_FOUND: [404, "File not found", "Check the file path and try again."],
  FILE_TOO_LARGE: [413, "File is too large to display", "Choose a smaller file."],
  UNSUPPORTED_FILE: [415, "Binary files cannot be displayed", "Choose a text source file."],
  ANALYSIS_NOT_READY: [409, "Analysis is not built yet. Call /api/graph/:id first.", "Wait for analysis to finish, then retry."],
});

export class NebulaError extends Error {
  constructor(code, { message, hint, details = null, retryAfter, cause } = {}) {
    const [status, defaultMessage, defaultHint] = ERROR_CATALOG[code] ?? ERROR_CATALOG.INTERNAL;
    super(message ?? defaultMessage, cause === undefined ? undefined : { cause });
    this.name = "NebulaError";
    this.code = ERROR_CATALOG[code] ? code : "INTERNAL";
    this.status = status;
    this.hint = hint ?? defaultHint;
    this.details = details;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

export function errorMiddleware({ logger = console.error } = {}) {
  return (error, _request, response, _next) => {
    const nebulaError = error instanceof NebulaError
      ? error
      : new NebulaError("INTERNAL");
    const safeError = redactSecrets(error);
    logger("Nebula request failed:", safeError);

    if (response.headersSent) return response.end();
    if (nebulaError.code === "RATE_LIMITED" || nebulaError.code === "BUSY") {
      const retryAfter = Number(nebulaError.retryAfter ?? nebulaError.details?.retryAfter ?? 60);
      response.set("Retry-After", String(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60));
    }
    return response.status(nebulaError.status).json({
      error: {
        code: nebulaError.code,
        message: nebulaError.message,
      },
    });
  };
}

export function installProcessErrorHandlers({ logger = console.error } = {}) {
  const log = (label, error) => logger(label, redactSecrets(error));
  process.on("unhandledRejection", (reason) => log("Unhandled promise rejection:", reason));
  process.on("uncaughtException", (error) => log("Uncaught exception:", error));
}

function redactSecrets(error) {
  const stackFor = (value, depth = 0) => {
    if (!(value instanceof Error) || depth > 4) return String(value ?? "");
    const own = value.stack ?? `${value.name}: ${value.message}`;
    return value.cause === undefined ? own : `${own}\nCaused by: ${stackFor(value.cause, depth + 1)}`;
  };
  const text = stackFor(error);
  const token = process.env.GITHUB_TOKEN;
  let safe = text.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[REDACTED]");
  if (token) safe = safe.split(token).join("[REDACTED]");
  return safe;
}
