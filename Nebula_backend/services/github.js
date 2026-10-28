const ISSUE_LABELS = [
  "good first issue",
  "good-first-issue",
  "help wanted",
  "beginner",
  "easy",
];
const MAX_ISSUES = 20;
const CACHE_TTL_MS = 10 * 60 * 1000;
const SHORT_CACHE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 8 * 1000;
const issueCache = new Map();

export function parseGitHubRepo(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    const validSegment = /^[A-Za-z0-9_.-]+$/;
    if (!validSegment.test(owner) || !validSegment.test(repo)) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

export async function fetchGoodFirstIssues(
  owner,
  repo,
  { token = process.env.GITHUB_TOKEN, fetchImpl = fetch, now = Date.now } = {},
) {
  const cacheKey = `${String(owner).toLowerCase()}/${String(repo).toLowerCase()}`;
  const currentTime = now();
  const cached = issueCache.get(cacheKey);
  if (cached && cached.expiresAt > currentTime) return cached.result;
  issueCache.delete(cacheKey);

  try {
    const issuesByNumber = new Map();
    for (const label of ISSUE_LABELS) {
      const url = new URL(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      );
      url.searchParams.set("state", "open");
      url.searchParams.set("per_page", "30");
      url.searchParams.set("labels", label);
      const headers = {
        Accept: "application/vnd.github+json",
        "User-Agent": "Nebula-App",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetchWithTimeout(fetchImpl, url, headers);
      if (response.status === 404) {
        return cacheResult(cacheKey, result("not_found"), currentTime);
      }
      if (!response.ok) {
        if (
          (response.status === 403 || response.status === 429) &&
          (getHeader(response, "x-ratelimit-remaining") === "0" ||
            getHeader(response, "retry-after") !== null)
        ) {
          const rawReset = getHeader(response, "x-ratelimit-reset");
          const resetSeconds =
            rawReset === null ? Number.NaN : Number(rawReset);
          const resetAt = Number.isFinite(resetSeconds)
            ? resetSeconds * 1000
            : null;
          return cacheResult(
            cacheKey,
            result("rate_limited", [], resetAt),
            currentTime,
          );
        }
        return cacheResult(cacheKey, result("unavailable"), currentTime);
      }

      const items = await response.json();
      if (!Array.isArray(items))
        return cacheResult(cacheKey, result("unavailable"), currentTime);
      for (const item of items) {
        if (
          !item ||
          item.pull_request ||
          !Number.isInteger(item.number) ||
          issuesByNumber.has(item.number)
        ) {
          continue;
        }
        issuesByNumber.set(item.number, {
          number: item.number,
          title: item.title ?? "",
          url: item.html_url ?? "",
          labels: Array.isArray(item.labels)
            ? item.labels
                .map((entry) =>
                  typeof entry === "string" ? entry : entry?.name,
                )
                .filter((name) => typeof name === "string")
            : [],
          body: typeof item.body === "string" ? item.body.slice(0, 4000) : "",
          comments: item.comments ?? 0,
          createdAt: item.created_at ?? null,
        });
        if (issuesByNumber.size === MAX_ISSUES) break;
      }
      if (issuesByNumber.size === MAX_ISSUES) break;
    }

    const issues = [...issuesByNumber.values()];
    return cacheResult(
      cacheKey,
      result(issues.length ? "ok" : "none", issues),
      currentTime,
    );
  } catch {
    return cacheResult(cacheKey, result("unavailable"), currentTime);
  }
}

async function fetchWithTimeout(fetchImpl, url, headers) {
  const controller = new AbortController();
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("GitHub request timed out"));
      }, REQUEST_TIMEOUT_MS);
    });
    return await Promise.race([
      fetchImpl(url, { headers, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function cacheResult(key, value, currentTime) {
  const ttl =
    value.status === "rate_limited" || value.status === "unavailable"
      ? SHORT_CACHE_TTL_MS
      : CACHE_TTL_MS;
  issueCache.set(key, { result: value, expiresAt: currentTime + ttl });
  return value;
}

function result(status, issues = [], resetAt = null) {
  return { status, issues, resetAt };
}

function getHeader(response, name) {
  const value = response.headers?.get?.(name);
  return value === undefined ? null : value;
}
