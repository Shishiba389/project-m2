/**
 * console.assert prints and carries on: it never touches the exit code. Every
 * demo() in this project was built on it, so `npm run check` could report
 * success with failing assertions — and did, until this was added.
 *
 * Wrap a self-check in `begin()` / `finish()` and a failure fails the process.
 */
export function begin() {
  let failures = 0;
  const original = console.assert;
  console.assert = (condition?: boolean, ...rest: unknown[]) => {
    if (!condition) failures += 1;
    original(condition, ...rest);
  };
  return function finish(label: string) {
    console.assert = original;
    if (failures > 0) {
      console.error(`${label}: ${failures} assertion${failures === 1 ? "" : "s"} failed`);
      if (typeof process !== "undefined") process.exitCode = 1;
      return false;
    }
    console.log(`${label}: all checks passed`);
    return true;
  };
}
