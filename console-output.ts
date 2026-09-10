// SPDX-License-Identifier: MPL-2.0
/** Collect nearby byte fragments without spending a model round on each one.
 * A quiet timeout keeps one pending read for the next call; it does not close
 * the remote console or dispatch a second concurrent read. */
export class ConsoleOutput {
  private pending?: Promise<{ bytes: Uint8Array | null } | { error: unknown }>;
  private decoder = new TextDecoder();
  private eof = false;
  constructor(
    private read: (signal: AbortSignal) => Promise<Uint8Array | null>,
  ) {}
  async collect(signal: AbortSignal, initialWait = 10000, quietWait = 150) {
    let output = "",
      chunks = 0;
    const started = performance.now();
    while (
      !this.eof &&
      output.length < 64000 &&
      (chunks === 0 || performance.now() - started < 1000)
    ) {
      signal.throwIfAborted();
      this.pending ??= this.read(signal).then(
        (bytes) => ({ bytes }),
        (error) => ({ error }),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: () => void = () => {};
      const wait = new Promise<null>((resolve, reject) => {
        timer = setTimeout(
          () => resolve(null),
          chunks ? quietWait : initialWait,
        );
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
      let item;
      try {
        item = await Promise.race([this.pending, wait]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
      if (!item) break;
      this.pending = undefined;
      if ("error" in item) throw item.error;
      chunks++;
      this.eof = item.bytes === null;
      output += item.bytes
        ? this.decoder.decode(item.bytes, { stream: true })
        : this.decoder.decode();
    }
    return { output, eof: this.eof, waiting: !output && !this.eof };
  }
}
