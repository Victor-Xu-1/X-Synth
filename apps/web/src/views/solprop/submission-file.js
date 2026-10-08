import * as Papa from "papaparse";

export function readSubmissionFile(file, signal) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error);
      else resolve(value);
    }
    function abort() {
      reader.abort();
      finish(signal.reason || new DOMException("", "AbortError"));
    }
    reader.onload = (event) => finish(null, event.target.result);
    reader.onerror = () => finish(reader.error || new Error());
    reader.onabort = () => finish(signal.reason || new DOMException("", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else {
      try { reader.readAsText(file); }
      catch (error) { finish(error); }
    }
  });
}

export function parseSubmissionFile(file, text) {
  if (file.name.endsWith(".csv")) {
    const result = Papa.parse(text, { header: true, skipEmptyLines: true, transform: (value) => value === "" ? null : value });
    if (result.errors.length) throw new Error(result.errors[0].message);
    return result.data;
  }
  try { return JSON.parse(text); }
  catch { throw new Error("JSON 文件格式无效"); }
}
