// Minimal Claude API client for the Assistant tab. Venise has no bundler, so this talks to the
// Messages API directly with fetch + SSE streaming rather than the Anthropic SDK.
//
// The API key is kept in localStorage and sent straight from the browser using Anthropic's
// direct-browser-access header. That's reasonable for a personal local tool, but the key is
// visible to anything running in this app — use a personal key, and put it behind a proxy before
// sharing Venise with anyone.
(() => {
  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const API_VERSION = "2023-06-01";
  const KEY_STORE = "venise.claude.key";

  const MODELS = [
    { id: "claude-opus-5", label: "Opus 5 — most capable" },
    { id: "claude-sonnet-5", label: "Sonnet 5 — balanced" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5 — fastest" },
  ];

  const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
  const setKey = k => { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch {} };

  // Streams a reply. `messages` is the Anthropic messages array. Callbacks: onText(delta),
  // onDone({stop}), onError(message). Returns an abort() function.
  function ask({ messages, model, system, onText, onDone, onError }) {
    const key = getKey();
    if (!key) { onError("No API key set. Add one below to start."); return () => {}; }

    const controller = new AbortController();
    (async () => {
      let res;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": API_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: model || MODELS[0].id,
            max_tokens: 8000,
            stream: true,
            system: system || undefined,
            messages,
          }),
        });
      } catch (err) {
        if (err.name !== "AbortError") onError("Couldn't reach the Claude API: " + err.message);
        return;
      }

      if (!res.ok || !res.body) {
        let detail = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j.error && j.error.message) detail = j.error.message; } catch {}
        if (res.status === 401) detail = "The API key was rejected (401). Check it below.";
        return onError(detail);
      }

      // Parse the SSE stream: events are separated by blank lines; we only need the JSON in `data:`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", stop = null;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, sep); buf = buf.slice(sep + 2);
            const line = chunk.split("\n").find(l => l.startsWith("data:"));
            if (!line) continue;
            let ev;
            try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
            if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") onText(ev.delta.text);
            else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
            else if (ev.type === "error") return onError((ev.error && ev.error.message) || "Streaming error");
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") onError("The connection dropped: " + err.message);
        return;
      }
      onDone({ stop });
    })();

    return () => controller.abort();
  }

  window.VeniseClaude = { ask, getKey, setKey, MODELS };
})();
