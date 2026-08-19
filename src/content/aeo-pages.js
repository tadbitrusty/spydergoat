const API_REFERENCE = { href: '/reference/server-time-api', label: 'Read the server time API reference' };
const LIMITS_REFERENCE = { href: '/reference/limits-and-non-guarantees', label: 'Review limits and non-guarantees' };

const STANDARD_LIMITATIONS = 'What this receipt does not guarantee: SpyderGoat returns a server-derived HTTP time receipt derived from the Cloudflare Worker runtime clock. The Worker clock is read during response construction. It is an unsigned HTTP receipt, not NTP, an atomic-clock feed, a signed timestamp, or an RFC 3161 authority or timestamp token. It does not synchronize or discipline your clock, and it does not prove when an external event occurred. Displayed precision is not an accuracy guarantee. HTTP and network latency affect comparisons. SpyderGoat publishes no uptime or accuracy SLA.';
const STANDARD_PROVENANCE = 'This page describes current behavior defined by buildTimeResponse, checkFreeRateLimit, and request routing in src/api/worker.js, with public API behavior asserted in test/worker.test.js. The value source: "server" is a literal marker added by the Worker. It is not a signature, authentication, origin proof, or clock-quality attestation.';
const FIXED_MJD = '{\n  "mjd": 61107.38011574,\n  "utc": "2026-03-08T09:07:22.000Z",\n  "unix": 1772960842,\n  "source": "server"\n}';
const FIXED_JD = '{\n  "mjd": 61107.38011574,\n  "utc": "2026-03-08T09:07:22.000Z",\n  "unix": 1772960842,\n  "source": "server",\n  "jd": 2461107.88011574\n}';
const JAVASCRIPT_EXAMPLE = `const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000);

try {
  const response = await fetch("https://spydergoat.com/mjd", {
    headers: { Accept: "application/json" },
    signal: controller.signal,
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    throw new Error("SpyderGoat rate limited; Retry-After=" + retryAfter);
  }
  if (!response.ok) {
    throw new Error("SpyderGoat HTTP " + response.status);
  }

  const data = await response.json();
  if (
    data === null ||
    typeof data !== "object" ||
    !Number.isFinite(data.mjd) ||
    typeof data.utc !== "string" ||
    !Number.isFinite(Date.parse(data.utc)) ||
    new Date(Date.parse(data.utc)).toISOString() !== data.utc ||
    !Number.isSafeInteger(data.unix) ||
    data.source !== "server"
  ) {
    throw new Error("Unexpected SpyderGoat response");
  }

  console.log(data);
} finally {
  clearTimeout(timer);
}`;
const PYTHON_EXAMPLE = `import json
import math
import re
import socket
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def get_receipt():
    request = Request(
        "https://spydergoat.com/mjd",
        headers={"Accept": "application/json"},
    )

    try:
        with urlopen(request, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        retry_after = error.headers.get("Retry-After")
        raise RuntimeError(
            f"SpyderGoat HTTP {error.code}; Retry-After={retry_after}"
        ) from error
    except (URLError, TimeoutError, socket.timeout) as error:
        raise RuntimeError("SpyderGoat request failed") from error
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("SpyderGoat returned malformed JSON") from error

    try:
        utc_text = data["utc"]
        datetime.strptime(utc_text, "%Y-%m-%dT%H:%M:%S.%fZ")
        valid = (
            type(data["mjd"]) in (int, float)
            and math.isfinite(data["mjd"])
            and type(data["unix"]) is int
            and data["source"] == "server"
            and re.fullmatch(
                r"\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z",
                utc_text,
            ) is not None
        )
    except (KeyError, AttributeError, TypeError, ValueError):
        valid = False

    if not valid:
        raise RuntimeError("Unexpected SpyderGoat response")

    return data


print(get_receipt())`;

const UNTRUSTED_CLIENT_EXAMPLE = `const clientEvent = {
  action: "approved",
  occurredAt: "2026-03-08T09:07:18.000Z",
};

async function addTimeContext(event) {
  const applicationReceivedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("https://spydergoat.com/mjd", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 429) {
      throw new Error("SpyderGoat rate limited; Retry-After=" + response.headers.get("Retry-After"));
    }
    if (!response.ok) {
      throw new Error("SpyderGoat HTTP " + response.status);
    }

    const externalReceipt = await response.json();
    const receiptMs = Date.parse(externalReceipt?.utc);
    if (
      externalReceipt === null ||
      typeof externalReceipt !== "object" ||
      !Number.isFinite(externalReceipt.mjd) ||
      typeof externalReceipt.utc !== "string" ||
      !Number.isFinite(receiptMs) ||
      new Date(receiptMs).toISOString() !== externalReceipt.utc ||
      !Number.isSafeInteger(externalReceipt.unix) ||
      externalReceipt.source !== "server"
    ) {
      throw new Error("Unexpected SpyderGoat response");
    }

    return {
      client_claimed_at: event.occurredAt,
      application_received_at: applicationReceivedAt,
      external_receipt: externalReceipt,
    };
  } finally {
    clearTimeout(timer);
  }
}

console.log(await addTimeContext(clientEvent));`;

const CLOCK_COMPARISON_EXAMPLE = `const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000);
const clientSendWallMs = Date.now();
const clientSendMonotonicMs = performance.now();

try {
  const response = await fetch("https://spydergoat.com/mjd", {
    headers: { Accept: "application/json" },
    signal: controller.signal,
  });
  const clientReceiveMonotonicMs = performance.now();
  const roundTripMs = clientReceiveMonotonicMs - clientSendMonotonicMs;
  // Wall-clock mapping: assume the local wall clock stays stable during this RTT.
  const clientReceiveWallMs = clientSendWallMs + roundTripMs;

  if (response.status === 429) {
    throw new Error("SpyderGoat rate limited; Retry-After=" + response.headers.get("Retry-After"));
  }
  if (!response.ok) {
    throw new Error("SpyderGoat HTTP " + response.status);
  }

  const receipt = await response.json();
  const serverUtcMs = Date.parse(receipt?.utc);
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    !Number.isFinite(receipt.mjd) ||
    typeof receipt.utc !== "string" ||
    !Number.isFinite(serverUtcMs) ||
    new Date(serverUtcMs).toISOString() !== receipt.utc ||
    !Number.isSafeInteger(receipt.unix) ||
    receipt.source !== "server"
  ) {
    throw new Error("Unexpected SpyderGoat response");
  }

  const localMidpointMs = (clientSendWallMs + clientReceiveWallMs) / 2;
  console.log({
    receiptUtc: receipt.utc,
    localMidpointUtc: new Date(localMidpointMs).toISOString(),
    estimatedOffsetMs: serverUtcMs - localMidpointMs,
    roundTripMs,
  });
} finally {
  clearTimeout(timer);
}`;

function page(route, values) {
  return {
    route,
    canonical: `https://spydergoat.com${route}`,
    schemaType: 'TechArticle',
    ...values,
  };
}

const pages = [
  page('/reference/server-time-api', {
    title: 'Server Time API Reference | SpyderGoat',
    description: 'Request server-derived MJD, UTC, Unix seconds, and optional Julian Date from SpyderGoat, with current fields, headers, rate limits, errors, and non-guarantees.',
    h1: 'SpyderGoat server-time API reference',
    directAnswer: 'GET /mjd returns server-derived MJD, UTC, Unix seconds, and a source marker. GET /jd returns the same fields and adds Julian Date. Both are unsigned HTTP receipts derived from the current Worker clock.',
    sections: [
      {
        heading: 'Endpoints and methods',
        paragraphs: ['The /mjd and /jd routes are exact paths. For example, /mjd/ is not the API route and currently falls through to 404. HEAD is bodyless and quota-neutral; it does not return timestamp payload or time fields.'],
        table: {
          headers: ['Endpoint', 'Supported request', 'Current result'],
          rows: [
            ['/mjd', 'GET', 'JSON containing mjd, utc, unix, and source'],
            ['/jd', 'GET', 'The /mjd fields plus jd'],
            ['/mjd, /jd', 'HEAD', '200 with API headers and no response body; free quota is not consumed'],
            ['/mjd, /jd', 'OPTIONS', '204 with current CORS headers'],
            ['/mjd, /jd', 'Other methods', '405 with Allow: GET, HEAD, OPTIONS'],
          ],
        },
      },
      {
        heading: 'Response fields',
        paragraphs: ['MJD and JD are rounded numerically to eight decimal places. JSON number serialization may omit trailing zeroes, so eight displayed decimal places are not promised on every number. Displayed precision does not establish clock accuracy.'],
        table: {
          headers: ['Field', 'Type', 'Present on', 'Exact current meaning'],
          rows: [
            ['mjd', 'number', '/mjd and /jd', 'now / 86,400,000 + 40,587, rounded to eight decimal places'],
            ['utc', 'string', '/mjd and /jd', 'new Date(now).toISOString() for the Worker clock read during response construction'],
            ['unix', 'integer', '/mjd and /jd', 'Math.floor(now / 1000)'],
            ['source', 'string', '/mjd and /jd', 'Always the literal "server" marker in current responses'],
            ['jd', 'number', '/jd only', 'Unrounded MJD plus 2,400,000.5, then rounded to eight decimal places'],
          ],
        },
      },
      {
        heading: 'Make a request and read the examples',
        paragraphs: ['Actual timestamps change on every successful GET. The examples below were generated for the fixed input time 2026-03-08T09:07:22.000Z using the current buildTimeResponse implementation; they are illustrative response shapes, not a live response.'],
      },
      {
        heading: 'Rate limits and 429 responses',
        paragraphs: [
          'With the rate-limit KV binding configured, the current free path accepts one unauthenticated GET per CF-Connecting-IP value every 30 minutes, shared across /mjd and /jd. This is best-effort Cloudflare KV abuse control, not a globally guaranteed enforcement model.',
          'If CF-Connecting-IP is absent, the current code uses the shared key unknown. If the Worker has no rate-limit KV binding, the current implementation bypasses this check; that fallback is not a promised service tier.',
          'A successful free GET to either path can cause a subsequent request to either path from the same rate-limit key to receive 429. The retry_after body value and Retry-After header are matching runtime-calculated integer seconds; 1732 in the example is illustrative only.',
        ],
      },
      {
        heading: 'HEAD, CORS, and cache behavior',
        paragraphs: [
          'Successful GET and HEAD responses use Content-Type: application/json; charset=utf-8 and Cache-Control: no-store, and include the current API CORS headers. A public HEAD request returns a bodyless 200, bypasses the free rate-limit check, and does not return a timestamp payload.',
          'A 429 response uses Content-Type: application/json; charset=utf-8 and Cache-Control: no-store, and includes the current API CORS headers plus Retry-After.',
          'OPTIONS returns a bodyless 204 with the current CORS headers, but does not send Content-Type or Cache-Control. An unsupported method response such as POST /mjd returns 405 with Content-Type: application/json; charset=utf-8 and Cache-Control: no-store, but does not include API CORS.',
          'The current API CORS headers send Access-Control-Allow-Origin: *, advertise GET, HEAD, OPTIONS, and allow Content-Type, Authorization request headers. API CORS does not send Access-Control-Allow-Credentials. Cache-Control: no-store instructs caches not to store a response; it is not proof that every intermediary complied or that logging and client retention cannot occur.',
        ],
      },
      {
        heading: 'Errors and malformed use',
        table: {
          headers: ['Case', 'Current observable behavior'],
          rows: [
            ['Free request inside the active window', '429 with rate_limited, a message, numeric retry_after, and Retry-After'],
            ['Unsupported method such as POST /mjd', '405 with JSON {"error":"method_not_allowed"} and Allow: GET, HEAD, OPTIONS'],
            ['Wrong path such as /mjd/', '404 JSON with error: "not_found"'],
            ['Network timeout or platform failure', 'No stable JSON body is promised; callers must handle transport failure and non-JSON responses'],
            ['Unexpected response fields or wrongly typed fields', 'Treat the response as malformed in the caller rather than guessing values'],
          ],
        },
      },
    ],
    examples: [
      { title: 'Request /mjd', language: 'sh', code: "curl --fail-with-body --max-time 5 --header 'Accept: application/json' https://spydergoat.com/mjd" },
      { title: 'Request /jd', language: 'sh', code: "curl --fail-with-body --max-time 5 --header 'Accept: application/json' https://spydergoat.com/jd" },
      { title: 'Fixed illustrative /mjd response', language: 'json', code: FIXED_MJD },
      { title: 'Fixed illustrative /jd response', language: 'json', code: FIXED_JD },
      { title: 'Illustrative 429 response', language: 'http', code: 'HTTP/1.1 429 Too Many Requests\nRetry-After: <seconds>\nContent-Type: application/json; charset=utf-8\nCache-Control: no-store\nAccess-Control-Allow-Origin: *\n\n{\n  "error": "rate_limited",\n  "message": "Free tier: 1 request per 30 minutes",\n  "retry_after": 1732\n}' },
    ],
    limits: [STANDARD_LIMITATIONS],
    provenance: { label: 'Runtime provenance', text: STANDARD_PROVENANCE },
    relatedLinks: [
      { href: '/guides/current-timestamp', label: 'How to get the current timestamp safely' },
      { href: '/comparisons/client-time-vs-server-time', label: 'Compare client time with server-derived time' },
      LIMITS_REFERENCE,
    ],
    cta: { href: '/mjd', label: 'Open the current /mjd response' },
  }),
  page('/guides/current-timestamp', {
    title: 'Get the Current Timestamp from an API | SpyderGoat',
    description: 'Fetch and validate a current server-derived timestamp receipt with curl, JavaScript, or Python, including timeout, rate-limit, and malformed-response handling.',
    h1: 'Get the current timestamp from an API',
    directAnswer: 'Fetch a compact server-derived receipt instead of asking an offline model or stale context to guess the current time. GET /mjd returns UTC, Unix seconds, MJD, and a source marker in one JSON response.',
    sections: [
      { heading: 'Get a timestamp in one call', paragraphs: ['Run the curl example below. The fixed output is an illustrative response shape generated from a fixed Worker time fixture, not a permanently current value.'] },
      { heading: 'Fetch and validate it in JavaScript', paragraphs: ['The JavaScript example checks response.ok, handles 429 separately, validates the fields it uses, and always clears its AbortController timeout.'] },
      { heading: 'Fetch and validate it with Python’s standard library', paragraphs: ['The Python example sets a five-second timeout and handles HTTP, network, timeout, decoding, JSON, and schema failures without third-party packages.'] },
      {
        heading: 'Which field should you use?',
        items: [
          'Use utc when you need the Worker-sampled time as a textual UTC ISO string.',
          'Use unix when your system expects whole Unix seconds; sub-second information is discarded.',
          'Use mjd when an integration requires the rounded numeric day representation.',
          'Request /jd only when the receiving system requires the additional jd field, which is also rounded.',
          'Store the field name and its semantics; do not store an unexplained number.',
        ],
      },
      {
        heading: 'Expected output shape',
        paragraphs: ['The exact expected /mjd shape contains numeric mjd, string utc, integer unix, and the literal source marker "server". The value is the Worker clock read during response construction, not request-arrival time, caller-receipt time, or external event time.'],
      },
      {
        heading: 'Handle rate limits, timeouts, and bad responses',
        items: [
          'On 429, read Retry-After and do not immediately repeat the request.',
          'Treat aborts or timeout, DNS failures, connection failures, and unavailable service as missing external data.',
          'Reject malformed JSON and missing or wrongly typed fields.',
          'Do not silently substitute the local clock while labelling it as a SpyderGoat receipt.',
          'If fallback is acceptable, record its source explicitly in your own schema, such as source: "local-fallback".',
        ],
        paragraphs: [
          'With the rate-limit KV binding configured, the current free path accepts one unauthenticated GET per CF-Connecting-IP value every 30 minutes, shared across /mjd and /jd. HEAD is quota-neutral. This is best-effort KV behavior. If CF-Connecting-IP is absent, the shared key is unknown. If the Worker has no rate-limit KV binding, the implementation bypasses the check; that fallback is not a promised service tier.',
          'A successful HTTP status is not enough: validate the fields your program will use. The source: "server" value is a literal marker for the current response shape, not an authenticity check, signature, origin proof, or clock attestation.',
        ],
      },
    ],
    examples: [
      { title: 'Fetch the receipt', language: 'sh', code: "curl --fail-with-body --max-time 5 --header 'Accept: application/json' https://spydergoat.com/mjd" },
      { title: 'Fixed illustrative response shape', language: 'json', code: FIXED_MJD },
      { title: 'JavaScript with timeout and validation', language: 'js', code: JAVASCRIPT_EXAMPLE },
      { title: 'Python standard library with timeout and validation', language: 'python', code: PYTHON_EXAMPLE },
    ],
    limits: [STANDARD_LIMITATIONS],
    provenance: { label: 'Runtime provenance', text: STANDARD_PROVENANCE },
    relatedLinks: [
      { href: '/reference/server-time-api', label: 'Server-time API fields and errors' },
      { href: '/problems/untrusted-client-time', label: 'When client time is untrusted' },
      { href: '/comparisons/client-time-vs-server-time', label: 'Client time versus server time' },
    ],
    cta: { href: '/reference/server-time-api', label: 'Read the complete API reference' },
  }),
  page('/problems/untrusted-client-time', {
    title: 'When Client Time Cannot Be Trusted | SpyderGoat',
    description: 'Separate client-claimed event time, application receipt time, and an optional server-derived HTTP receipt without treating any unsigned timestamp as event proof.',
    h1: 'Use server-derived time when client time is untrusted',
    directAnswer: 'Use a server-derived receipt as an external comparison point when client time can be manipulated or misconfigured. Keep it separate from client-claimed event time, and do not treat it as signed evidence that the event occurred.',
    sections: [
      {
        heading: 'The unsafe pattern',
        paragraphs: [
          'In this threat model, a client-controlled wall clock can be changed, misconfigured, stale, or unavailable. That does not mean every client timestamp is false; it means the current Worker cannot verify the device clock or when the action actually occurred.',
          'The unsafe example stores only what the client clock reported, erasing the distinction between a client claim and independently recorded application context.',
        ],
      },
      {
        heading: 'Keep five time concepts distinct',
        items: [
          'Event time: when the external action actually occurred; the API does not observe it.',
          'Client-claimed time: what the client reports from its own clock.',
          'Application receipt time: when your application records receipt of the client payload.',
          'Response-construction time: when the Worker reads Date.now() while constructing the HTTP response.',
          'Receipt time at the caller: when the caller receives the response after network and processing delay.',
        ],
        paragraphs: ['SpyderGoat does not capture request-arrival time. Its value is a Worker clock read during response construction, not server-arrival time.'],
      },
      {
        heading: 'Keep three time meanings separate',
        table: {
          headers: ['Field', 'Meaning', 'What it does not establish'],
          rows: [
            ['client_claimed_at', 'Client-claimed time reported by the client', 'Correct device time or event proof'],
            ['application_received_at', 'Application receipt time recorded by your application', 'Original event time'],
            ['external_receipt', 'SpyderGoat response fetched during the application flow', 'Signed evidence, request-arrival time, or exact event time'],
          ],
        },
      },
      {
        heading: 'Correct the storage pattern',
        paragraphs: [
          'Validate the canonical response fields and store all three values under separate names. Fetching the receipt during this flow adds an external observation; it does not move or certify an earlier event time.',
          'The free KV-conditional 30-minute limit is shared across /mjd and /jd and makes a fresh receipt unsuitable for rapid or high-frequency event sampling.',
        ],
      },
      {
        heading: 'Threat and failure boundary',
        items: [
          'A receipt can be copied into another record or replayed with a later payload.',
          'Network delay separates the client event, application receipt, response construction, and caller receipt.',
          'Offline clients cannot obtain a fresh HTTP receipt; preserve their local event data and mark external time unavailable.',
          'A timeout, 429, malformed JSON, or service unavailable outcome must not be replaced with invented external time.',
          'Your application decides whether failure blocks the operation or is stored as an explicit unavailable state.',
          'A delayed, queued, copied, or replayed response cannot establish event time.',
        ],
      },
      {
        heading: 'Not tamper-proof and not event proof',
        paragraphs: [
          'The JSON is not request-bound, not nonce-bound, not data-bound, not event-bound, and not signed. It can be copied or replayed and is not independently verifiable after copying.',
          'SpyderGoat does not make client input tamper-proof, prevent replay, authenticate the event, or prove that an external event happened at the returned time. The literal source marker "server" adds none of those guarantees.',
        ],
      },
    ],
    examples: [
      { title: 'Unsafe client-only timestamp', language: 'js', code: 'const event = {\n  action: "approved",\n  occurredAt: new Date().toISOString(),\n};' },
      { title: 'Corrected request pattern', language: 'js', code: UNTRUSTED_CLIENT_EXAMPLE },
      { title: 'Illustrative stored schema', language: 'json', note: 'Schema illustration only; this is not evidence of a real event.', code: '{\n  "client_claimed_at": "2026-03-08T09:07:18.000Z",\n  "application_received_at": "2026-03-08T09:07:21.700Z",\n  "external_receipt": {\n    "mjd": 61107.38011574,\n    "utc": "2026-03-08T09:07:22.000Z",\n    "unix": 1772960842,\n    "source": "server"\n  }\n}' },
    ],
    limits: [STANDARD_LIMITATIONS, 'The receipt is not bound to a request, nonce, record, payload, or event and cannot establish the ordering or occurrence of external actions.'],
    provenance: { label: 'Runtime provenance', text: STANDARD_PROVENANCE },
    relatedLinks: [API_REFERENCE, { href: '/comparisons/client-time-vs-server-time', label: 'Client time versus server time' }, LIMITS_REFERENCE],
    cta: { href: '/reference/server-time-api', label: 'Check the API fields and current limits' },
  }),
  page('/problems/server-clock-drift', {
    title: 'Compare a Server Clock with an HTTP Time Receipt | SpyderGoat',
    description: 'Measure estimated disagreement between a local clock and a SpyderGoat HTTP receipt while accounting for round-trip latency, false positives, rate limits, and non-guarantees.',
    h1: 'Compare server clocks without claiming synchronization',
    directAnswer: 'Compare the local clock with an external HTTP receipt to surface disagreement. SpyderGoat does not discipline or synchronize the local clock.',
    sections: [
      {
        heading: 'Calculate an estimated offset',
        paragraphs: [
          'estimated_offset_ms = server_utc_ms - ((client_send_wall_ms + client_receive_wall_ms) / 2)',
          'round_trip_ms = client_receive_monotonic_ms - client_send_monotonic_ms',
          'The midpoint calculation assumes a stable client wall clock during the request and approximately symmetric network and processing delay. The example maps monotonic elapsed time onto the send wall-clock reading so an adjustable wall clock is not used to measure RTT.',
          'This is an estimated offset and observed disagreement, not a correction or direct measurement of drift. The response does not expose one-way delay or Worker processing duration.',
        ],
      },
      {
        heading: 'Interpret the runtime result',
        paragraphs: [
          'A positive estimatedOffsetMs means the receipt UTC was later than the calculated local midpoint. A negative value means it was earlier.',
          'Either sign combines possible clock disagreement with asymmetric latency, Worker processing, response transfer, local process scheduling, and the midpoint assumptions. Asymmetric request and response paths make the estimate uncertain.',
          'One sample cannot determine which clock is wrong. It also cannot distinguish persistent disagreement from transient network or scheduling delay.',
        ],
      },
      {
        heading: 'Choose application-specific thresholds',
        paragraphs: [
          'There is no universal safe threshold. Choose an application-specific threshold from the system requirement and keep each estimated offset beside its raw RTT or round-trip time.',
          'Repeated samples can reveal consistency. Lower-RTT observations may reduce network noise, but do not prove either clock accurate; retain repeated samples and raw RTT values rather than hiding them behind an average.',
          'The current free KV-conditional limit does not permit rapid sampling: one successful unauthenticated GET per CF-Connecting-IP value per 30 minutes is shared across /mjd and /jd when the binding is configured. Respect 429 and Retry-After.',
        ],
      },
      {
        heading: 'Compare, do not synchronize',
        paragraphs: [
          'NTP is a clock-synchronization protocol; SpyderGoat is an HTTP comparison point. This script reports a comparison. It does not set the local clock, discipline frequency, build a clock model, or implement an NTP client.',
          'SpyderGoat publishes no accuracy SLA, and no accuracy SLA exists for either side merely because this comparison was run. It also publishes no uptime, latency, or maximum-error guarantee.',
        ],
      },
    ],
    examples: [
      { title: 'Working JavaScript comparison', language: 'js', code: CLOCK_COMPARISON_EXAMPLE },
      { title: 'Expected runtime output shape', language: 'json', note: 'All values shown as placeholders must come from the executed request; no numerical offset is fabricated.', code: '{\n  "receiptUtc": "<ISO string measured at runtime>",\n  "localMidpointUtc": "<ISO string measured at runtime>",\n  "estimatedOffsetMs": "<number measured at runtime>",\n  "roundTripMs": "<non-negative number measured at runtime>"\n}' },
    ],
    sources: [
      { href: 'https://www.rfc-editor.org/rfc/rfc5905.txt', label: 'RFC 5905 — Network Time Protocol Version 4 clock-synchronization protocol' },
    ],
    limits: [STANDARD_LIMITATIONS, 'Midpoint estimates cannot remove unknown asymmetry, Worker processing time, response transfer, or local scheduling effects.'],
    provenance: { label: 'Runtime provenance', text: STANDARD_PROVENANCE },
    relatedLinks: [API_REFERENCE, { href: '/guides/current-timestamp', label: 'Get a current timestamp with failure handling' }, { href: '/comparisons/client-time-vs-server-time', label: 'Choose the correct clock mechanism' }],
    cta: { href: '/reference/server-time-api', label: 'Review the receipt fields before comparing clocks' },
  }),
  page('/comparisons/client-time-vs-server-time', {
    title: 'Client Time vs Server Time: Choose the Right Mechanism | SpyderGoat',
    description: 'Compare client wall clocks, monotonic timing, application logs, external HTTP receipts, NTP synchronization, and RFC 3161 timestamp tokens.',
    h1: 'Client time versus server time',
    directAnswer: 'Client display time, monotonic duration measurement, application-server time, an external HTTP receipt, clock synchronization, and signed datum timestamping are different jobs. Choose the mechanism from the requirement; SpyderGoat fits only the external HTTP receipt role.',
    sections: [
      {
        heading: 'Choose by job',
        paragraphs: ['The recommendation column is deliberately not product-first. Five of these six mechanisms are not SpyderGoat, and each has a distinct job.'],
        table: {
          headers: ['Mechanism', 'Recommended mechanism', 'Best for', 'Required limitation', 'SpyderGoat fit'],
          rows: [
            ['Client wall clock', 'Client wall clock', 'Local date and time display with an explicit timezone', 'User or device controlled; can be adjusted or jump', 'No; optional comparison only'],
            ['Monotonic clock', 'Monotonic clock', 'Elapsed duration and timeout measurement inside one runtime', 'No civil UTC timestamp', 'No'],
            ['Application server clock/log', 'Application server clock/log', 'Application receipt timestamps and operational logs', 'Same clock and trust domain; not external event proof', 'Usually no'],
            ['SpyderGoat HTTP receipt', 'SpyderGoat HTTP receipt', 'Lightweight external clock comparison', 'Latency, unsigned, no accuracy SLA, and no synchronization', 'Yes, only for this bounded role'],
            ['NTP', 'NTP', 'Clock synchronization and discipline', 'Separate protocol, deployment, configuration, and security assumptions', 'No'],
            ['RFC 3161 timestamp token', 'RFC 3161 timestamp token', 'Signed datum timestamping that binds a digest to a TSA assertion', 'TSA trust, certificate, policy, validation, and event-semantic limits', 'No'],
          ],
        },
      },
      {
        heading: 'Decision examples',
        items: [
          'Local display: use the client wall clock and timezone when local presentation is the requirement; an HTTP dependency is unnecessary solely to format a clock.',
          'Elapsed duration: use a monotonic clock such as performance.now() rather than subtracting wall-clock receipts.',
          'Application receipt: store when your own application accepted the request and label it application_received_at.',
          'External clock comparison: fetch /mjd, retain request timing, and report estimated disagreement with RTT.',
          'Signed datum timestamping: use an RFC 3161-capable TSA workflow when a signed token binding a submitted digest to asserted time is required.',
        ],
      },
      {
        heading: 'RFC 3161 is not real-world event proof',
        paragraphs: [
          'RFC 3161 describes a time-stamping service in which a Time-Stamp Authority issues a signed token concerning a submitted datum or digest under the TSA, certificate, policy, and validation assumptions.',
          'An RFC 3161 token can provide evidence about that datum and asserted time under those assumptions. RFC 3161 does not by itself prove that the real-world event described by the data occurred.',
        ],
      },
      {
        heading: 'Where the HTTP receipt fits',
        paragraphs: [
          'SpyderGoat samples Date.now() while the Worker constructs a response and returns one server-derived observation as UTC, Unix seconds, and MJD. The source value "server" is only a literal marker.',
          'It is not a signature, origin or authentication statement, clock discipline, monotonic timer, RFC 3161 token, or event proof. Network latency and asymmetry remain part of cross-system comparison.',
        ],
      },
    ],
    examples: [{ title: 'Try the bounded HTTP mechanism', language: 'sh', code: 'curl --fail-with-body --max-time 5 https://spydergoat.com/mjd' }],
    sources: [
      { href: 'https://www.w3.org/TR/hr-time-3', label: 'W3C High Resolution Time Level 3 — monotonic duration timing and adjustable wall-clock distinctions' },
      { href: 'https://www.rfc-editor.org/rfc/rfc5905.txt', label: 'RFC 5905 — Network Time Protocol Version 4 clock-synchronization protocol' },
      { href: 'https://www.rfc-editor.org/rfc/rfc3161.txt', label: 'RFC 3161 — Internet X.509 Public Key Infrastructure Time-Stamp Protocol' },
    ],
    limits: [STANDARD_LIMITATIONS, 'Choose a mechanism by its actual trust domain and requirement; no one mechanism wins every time-related scenario.'],
    provenance: { label: 'Runtime provenance', text: 'The SpyderGoat row is grounded in current Worker code and tests. The primary sources below support only the stated roles of monotonic timing, NTP clock synchronization, and RFC 3161 datum timestamping.' },
    relatedLinks: [{ href: '/problems/untrusted-client-time', label: 'When client time is untrusted' }, { href: '/problems/server-clock-drift', label: 'Compare a server clock without synchronizing it' }, API_REFERENCE],
    cta: { href: '/problems/untrusted-client-time', label: 'See when untrusted client time needs separation' },
  }),
  page('/reference/limits-and-non-guarantees', {
    title: 'SpyderGoat Limits and Non-Guarantees',
    description: 'Understand SpyderGoat precision, accuracy, latency, availability, rate-limit, synchronization, signature, binding, cache, and event-time boundaries.',
    h1: 'SpyderGoat limits and non-guarantees',
    directAnswer: 'SpyderGoat provides an unsigned Cloudflare Worker-clock receipt with documented field formats and no accuracy SLA. It is an external HTTP comparison point, not clock synchronization, a signed RFC 3161 token, or proof that an event occurred.',
    sections: [
      {
        heading: 'What the API actually returns',
        paragraphs: [
          'The Worker calls Date.now() during response construction, derives MJD, UTC, and Unix seconds, and adds the literal source marker "server". /jd adds Julian Date. The marker is not a signature, origin proof, authentication statement, or clock-quality attestation.',
          'The timestamp is the Worker clock read during response construction. It is not request-arrival time, not caller-receipt time, and not external-event time. The Worker does not expose server processing duration or one-way network delay.',
        ],
      },
      {
        heading: 'Precision is not accuracy',
        paragraphs: [
          'utc exposes milliseconds through the ISO string. unix exposes whole, floored seconds. MJD and JD are rounded numeric values to eight decimal places. These output formats and their precision do not establish clock accuracy.',
          'Eight-decimal MJD and JD provide a fine displayed increment, but the underlying input is a millisecond integer and trailing decimal zeroes may be omitted by JSON number serialization. Do not turn the formatting into a maximum clock-error claim.',
        ],
      },
      {
        heading: 'Receipt time is not event time',
        paragraphs: [
          'The API does not know when an unrelated event began, occurred, was sent, reached your application, or was stored. Event time, client-claimed time, application receipt time, response-construction time, and caller receipt time must remain separately labelled.',
          'A client can say an event happened at X and request SpyderGoat later. An event can be queued for minutes before the API call. Neither sequence allows the later response to select the event time.',
        ],
      },
      {
        heading: 'Unsigned and not bound to caller data',
        paragraphs: [
          'The response is unsigned and can be copied or replayed. It is not request-bound, not nonce-bound, not data-bound, and not event-bound. It has no submitted-data hash, certificate chain, event identifier, or cryptographic binding.',
          'It is not an RFC 3161 timestamp token. JSON copied into another record does not become signed evidence, and a response replayed with another action does not inherit event semantics.',
        ],
      },
      {
        heading: 'HTTP comparison is not NTP',
        paragraphs: ['NTP disciplines clocks through a clock-synchronization protocol; this HTTP API does not set, synchronize, or discipline the caller clock. It returns a response for comparison only.'],
      },
      {
        heading: 'Cache, latency, availability, and limiter boundaries',
        paragraphs: [
          'Cache-Control: no-store is a cache-control instruction, not proof that every intermediary complied and not proof that clients, logs, or copied records discarded the response.',
          'Network delay can be asymmetric. Request travel, Worker handling, response travel, and local scheduling separate response construction from caller receipt. One sample cannot remove those effects.',
          'With the KV binding configured, free rate limiting is best-effort abuse control shared across /mjd and /jd: one unauthenticated GET per CF-Connecting-IP value every 30 minutes. A missing binding bypasses the check, and a missing IP uses the shared unknown key; neither fallback is a promised tier.',
          'Availability and latency vary. A timeout, malformed response, platform failure, service unavailable outcome, or 429 must remain an explicit caller failure state. SpyderGoat publishes no uptime SLA, no latency SLA, no accuracy SLA, and no maximum-error bound.',
        ],
      },
      {
        heading: 'Concrete counterexamples',
        items: [
          'A client says an event happened at X, then requests SpyderGoat later; the later receipt does not establish X.',
          'An event is queued for minutes before the API call; response construction is not queue or event time.',
          'JSON is copied into another record; the receipt is not bound to that record.',
          'A response is replayed with a different payload; the API supplies no replay prevention.',
          'Network delay is asymmetric; RTT midpoint estimation cannot reveal either one-way delay.',
          'The service is unavailable; the caller has no external receipt and must not invent one.',
          'Two clocks disagree; the API alone does not establish which is correct.',
        ],
      },
      {
        heading: 'What the API cannot prove',
        items: [
          'That a client clock was correct.',
          'That an external event occurred.',
          'That an event occurred at the returned utc value.',
          'That a copied receipt belongs to a particular request, record, datum, or event.',
          'That a receipt was not replayed.',
          'That the caller received the response without delay.',
          'That two events occurred in causal order.',
          'That the caller clock became synchronized.',
          'That the Worker clock met an unstated accuracy or maximum-error bound.',
          'That the service will meet an unstated uptime or latency target.',
        ],
      },
    ],
    examples: [
      { title: 'Fixed illustrative /mjd response', language: 'json', note: 'Illustrative shape generated from a fixed input; not a live response or accuracy evidence.', code: FIXED_MJD },
      { title: 'Different timestamps answer different questions', language: 'json', note: 'Schema illustration only; no value is selected as the true event time.', code: '{\n  "client_claimed_at": "2026-03-08T09:00:00.000Z",\n  "application_received_at": "2026-03-08T09:07:21.700Z",\n  "external_receipt_utc": "2026-03-08T09:07:22.000Z"\n}' },
    ],
    sources: [
      { href: 'https://www.rfc-editor.org/rfc/rfc5905.txt', label: 'RFC 5905 — Network Time Protocol Version 4 clock-synchronization protocol' },
      { href: 'https://www.rfc-editor.org/rfc/rfc3161.txt', label: 'RFC 3161 — Internet X.509 Public Key Infrastructure Time-Stamp Protocol' },
    ],
    limits: [STANDARD_LIMITATIONS, 'The API is not a monotonic clock, a clock-discipline service, a signed proof, a request/data/event binding mechanism, or an availability dependency with an SLA.'],
    provenance: { label: 'Runtime provenance', text: 'Current response fields come from buildTimeResponse(); current free-limit behavior comes from checkFreeRateLimit() and API routing in src/api/worker.js. Public HEAD, CORS, response-field, method, and rate-limit assertions are present in test/worker.test.js. These repository sources establish current SpyderGoat behavior; they do not establish independent Cloudflare clock accuracy.' },
    relatedLinks: [API_REFERENCE, { href: '/problems/untrusted-client-time', label: 'When client time is untrusted' }, { href: '/comparisons/client-time-vs-server-time', label: 'Client time versus server time' }],
    cta: { href: '/reference/server-time-api', label: 'Read the API behavior these limits qualify' },
  }),
];

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return Object.freeze(value);
}

export const AEO_PAGES = deepFreeze(pages);
export const AEO_PAGES_BY_ROUTE = deepFreeze(Object.fromEntries(AEO_PAGES.map(value => [value.route, value])));
export const AEO_CONTENT_PATHS = deepFreeze(AEO_PAGES.map(value => value.route));
