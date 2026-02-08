// py_worker.js
// Runs Python (Pyodide) in a Web Worker and emits turtle drawing commands
// Animation + rendering is handled entirely by the main thread (HTML)

import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.mjs";

let pyodide = null;
let pendingInputResolve = null;

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

/* ---------- Helpers ---------- */

// Convert Pyodide proxies into plain JS objects
function toPlain(x) {
  if (x && typeof x === "object" && typeof x.toJs === "function") {
    return toPlain(x.toJs({ dict_converter: Object.fromEntries }));
  }
  if (x instanceof Map) return Object.fromEntries(x.entries());
  if (Array.isArray(x)) return x.map(toPlain);
  if (x && typeof x === "object") {
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = toPlain(v);
    return o;
  }
  return x;
}

/* ---------- Pyodide setup ---------- */

async function ensurePyodide() {
  if (pyodide) return;

  post("status", { text: "Loading Python…" });
  pyodide = await loadPyodide();

  pyodide.setStdout({ batched: s => post("stdout", { text: s }) });
  pyodide.setStderr({ batched: s => post("stderr", { text: s }) });

  /* async input() */
  pyodide.globals.set("__worker_console_input__", (prompt) => {
    post("input_request", { prompt: String(prompt ?? "") });
    return new Promise(resolve => { pendingInputResolve = resolve; });
  });

  /* canvas bridge */
  pyodide.globals.set("__canvas_cmd__", (obj) => {
    post("canvas_cmd", { cmd: toPlain(obj) });
  });

  await pyodide.runPythonAsync(`
import builtins

async def _input(prompt=""):
    return await __worker_console_input__(str(prompt))

builtins.input = _input
  `);

  /* ---------- Install browser turtle ---------- */
  await pyodide.runPythonAsync(`
import math, sys, types

def _emit(**kwargs):
    __canvas_cmd__(kwargs)

class _WebTurtle:
    def __init__(self):
        self.x = 0.0
        self.y = 0.0
        self.heading = 0.0  # degrees, 0 = east
        self._pendown = True
        self._pencolor = "#00ff66"
        self._pensize = 2.0
        self._speed = 10
        self._visible = True

        _emit(type="turtle",
              x=self.x, y=self.y,
              heading=self.heading,
              visible=self._visible,
              pencolor=self._pencolor)

    def _state(self):
        _emit(type="turtle",
              x=self.x, y=self.y,
              heading=self.heading,
              visible=self._visible,
              pencolor=self._pencolor)

    def speed(self, s=None):
        if s is None:
            return self._speed
        try:
            s = int(s)
        except:
            s = 10
        if s < 0: s = 0
        if s > 10: s = 10
        self._speed = s

    def forward(self, d):
        d = float(d)
        rad = math.radians(self.heading)
        nx = self.x + math.cos(rad) * d
        ny = self.y + math.sin(rad) * d

        if self._pendown:
            _emit(type="line",
                  x1=self.x, y1=self.y,
                  x2=nx, y2=ny,
                  color=self._pencolor,
                  width=self._pensize,
                  speed=self._speed)

        self.x, self.y = nx, ny
        self._state()

    def backward(self, d):
        self.forward(-d)

    def left(self, a):
        self.heading = (self.heading + float(a)) % 360
        self._state()

    def right(self, a):
        self.heading = (self.heading - float(a)) % 360
        self._state()

    def penup(self):
        self._pendown = False

    def pendown(self):
        self._pendown = True

    def goto(self, x, y):
        x = float(x); y = float(y)
        if self._pendown:
            _emit(type="line",
                  x1=self.x, y1=self.y,
                  x2=x, y2=y,
                  color=self._pencolor,
                  width=self._pensize,
                  speed=self._speed)
        self.x, self.y = x, y
        self._state()

    setpos = goto
    setposition = goto

    def home(self):
        self.goto(0, 0)
        self.heading = 0
        self._state()

    def pencolor(self, c=None):
        if c is None:
            return self._pencolor
        self._pencolor = str(c)
        self._state()

    def pensize(self, s):
        self._pensize = float(s)

    def hideturtle(self):
        self._visible = False
        self._state()

    def showturtle(self):
        self._visible = True
        self._state()

    def clear(self):
        _emit(type="clear")

    def bgcolor(self, c):
        _emit(type="bg", color=str(c))


# Module-level functions like real turtle
_t = _WebTurtle()

mod = types.SimpleNamespace(
    forward=_t.forward,
    backward=_t.backward,
    left=_t.left,
    right=_t.right,
    penup=_t.penup,
    pendown=_t.pendown,
    goto=_t.goto,
    setpos=_t.setpos,
    setposition=_t.setposition,
    home=_t.home,
    speed=_t.speed,
    pencolor=_t.pencolor,
    pensize=_t.pensize,
    hideturtle=_t.hideturtle,
    showturtle=_t.showturtle,
    clear=_t.clear,
    bgcolor=_t.bgcolor,
)

sys.modules["turtle"] = mod
  `);

  post("ready");
}

/* ---------- Worker message handling ---------- */

self.onmessage = async (ev) => {
  const msg = ev.data || {};

  if (msg.type === "init") {
    await ensurePyodide();
    return;
  }

  if (msg.type === "input_response") {
    pendingInputResolve?.(String(msg.text ?? ""));
    pendingInputResolve = null;
    return;
  }

  if (msg.type === "run") {
    try {
      await ensurePyodide();
      await pyodide.runPythonAsync(msg.code);
      post("done");
    } catch (e) {
      post("error", { text: String(e) });
    }
  }
};
