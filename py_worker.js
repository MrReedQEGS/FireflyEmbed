// py_worker.js  (type: module)
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.mjs";

let pyodide = null;

// For async input bridging
let pendingInputResolve = null;

// Tag all outgoing messages with the current runId so the UI can ignore stale output
let activeRunId = 0;

function post(type, data = {}) {
  self.postMessage({ type, runId: activeRunId, ...data });
}

async function ensurePyodide() {
  if (pyodide) return;

  post("status", { text: "Loading Python…" });
  pyodide = await loadPyodide();

  // stdout/stderr -> main thread
  pyodide.setStdout({ batched: (s) => post("stdout", { text: s }) });
  pyodide.setStderr({ batched: (s) => post("stderr", { text: s }) });

  // Replace input() with async input that asks the UI
  pyodide.globals.set("__worker_console_input__", (prompt) => {
    post("input_request", { prompt: String(prompt ?? "") });
    return new Promise((resolve) => {
      pendingInputResolve = resolve;
    });
  });

  await pyodide.runPythonAsync(`
import builtins
async def _input(prompt=""):
    return await __worker_console_input__(str(prompt))
builtins.input = _input
  `);

  // ready is not tied to a run; activeRunId will be 0 here
  post("ready");
}

function wrapUserCode(src) {
  // Rewrite input( ... ) -> await input( ... ) safely (avoids foo.input(...) and identifiers)
  const t = src.replace(/(^|[^\w.])input\s*\(/g, "$1await input(");
  const i = t.split("\n").map((l) => "    " + l);
  return ["async def __main__():", ...i, "", "await __main__()"].join("\n");
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};

  try {
    if (msg.type === "init") {
      await ensurePyodide();
      return;
    }

    if (msg.type === "run") {
      await ensurePyodide();

      // Set the runId for this execution (sent by the UI)
      activeRunId = Number(msg.runId ?? 0);

      post("status", { text: "Running…" });

      const code = wrapUserCode(msg.code ?? "");
      await pyodide.runPythonAsync(code);

      post("done");
      return;
    }

    if (msg.type === "input_response") {
      if (pendingInputResolve) {
        pendingInputResolve(String(msg.text ?? ""));
        pendingInputResolve = null;
      }
      return;
    }
  } catch (e) {
    post("error", { text: String(e) });
  }
};
