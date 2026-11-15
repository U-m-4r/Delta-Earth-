# Story image-loading repair

The local story server was healthy, but its browser-origin rule allowed 127.0.0.1:5173 and blocked localhost:5173. This was reproduced with real browser fetches before the fix. The backend now accepts both names on the configured local frontend port. Unrelated origins remain blocked.

The frontend's local backend address is now retained in the ignored Frontend/.env.local file, so restarting Vite does not silently fall back to the older service on port 8787. The current story server uses port 8788.

The image loader retries brief network/server failures with bounded retries, validates image responses and preserves the last complete acquisition on permanent failure. Missing files still report an error rather than pretending to display a new date.

Comparison controller/cache cleanup now recreates usable controllers after lifecycle replay. Timeline cleanup clears revoked object-URL references and invalidates superseded requests. This also covers the shared Visualization frame lifecycle.

Verified through real Chrome: all 18 active SK frame downloads match their SHA-256 hashes; all five active SK stories work at both localhost and 127.0.0.1; repeated backwards/rapid date selections, repeated baseline comparison, live displayed object URLs, background-tab idle/resume, automatic recovery from an injected HTTP 503 and strict lifecycle comparison all passed. The detailed report is retained at .local-run/story-loading-fix/resilience-results.json and copied to this directory.

The previous NASA token session on port 8787 was not changed. No satellite data was downloaded again for this repair. Refresh an already-open page once to use the updated frontend.
