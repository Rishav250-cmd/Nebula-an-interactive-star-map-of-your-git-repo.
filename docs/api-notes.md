# API operations notes

## Keep a free-tier instance awake

Free hosting plans may suspend an idle server. Configure an external uptime monitor or scheduled job to request `GET /api/ping` every 5–10 minutes, subject to the hosting provider's limits. The endpoint returns a small health payload and can confirm that the process is awake; it does not guarantee that the provider will keep a free instance running.

## Analysis cache limits

`MAX_CACHE_REPOS` limits the number of cached repositories (default 30), and `MAX_CACHE_DISK_MB` limits total analysis-cache disk usage (default 250 MB). When either cap is exceeded, the oldest repositories are evicted first. `MAX_CACHE_MB` remains the maximum size of one analysis entry.
