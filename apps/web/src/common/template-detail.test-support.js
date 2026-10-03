import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

// Every response comes from the real authenticated router and installed SQLite.
export function templateContractApi() {
  const root = resolve(process.cwd(), "../..");
  const virtualPython = resolve(root, ".venv/bin/python");
  const python =
    process.env.X_SYNTH_TEST_PYTHON ||
    (existsSync(virtualPython) ? virtualPython : "python3");
  const child = spawn(
    python,
    ["tests/unit/test_template_library_api.py", "--contract-rpc"],
    {
      cwd: root,
      env: { ...process.env, PYTHONPATH: root },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const pending = new Map(),
    requests = [];
  let id = 0,
    stderr = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-8192);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const response = JSON.parse(line),
      entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.status < 400) entry.resolve(response.body);
    else entry.reject(new Error(JSON.stringify(response.body)));
  });
  const fail = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code) => {
    if (code)
      fail(new Error(`Template contract process exited ${code}: ${stderr}`));
  });
  const request = (method, path, payload) =>
    new Promise((yes, no) => {
      const command = { id: ++id, method, path, ...payload };
      requests.push(command);
      const timer = setTimeout(() => {
        pending.delete(command.id);
        no(new Error("Template contract timeout"));
      }, 15000);
      pending.set(command.id, { resolve: yes, reject: no, timer });
      child.stdin.write(JSON.stringify(command) + "\n");
    });
  return {
    requests,
    get: (path, params) => request("GET", path, { params }),
    post: (path, body) => request("POST", path, { body }),
    stop: () =>
      new Promise((yes) => {
        child.once("close", () => {
          lines.close();
          yes();
        });
        child.stdin.end();
      }),
  };
}

export function holdContractResponses(api, match) {
  const held = [];
  const request = async (method, path, data) => {
    const operation = api[method](path, data);
    if (!match(method, path, data)) return operation;
    let release;
    const wait = new Promise((yes) => {
      release = yes;
    });
    const item = { release, ready: false };
    held.push(item);
    const response = await operation.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    item.ready = true;
    await wait;
    if (response.error) throw response.error;
    return response.value;
  };
  return {
    held,
    get: (path, data) => request("get", path, data),
    post: (path, data) => request("post", path, data),
  };
}
