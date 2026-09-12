// SPDX-License-Identifier: MPL-2.0
/** Review-only notation. Never send this formatted string to the console. */
export function visibleConsoleInput(text: string): string {
  if (!text) return "[No input]";
  return text.replace(/[\x00-\x20\x7f]/g, (char) => {
    const code = char.charCodeAt(0);
    if (char === " " && text.trim()) return char;
    const names: Record<number, string> = {
      0: "NUL",
      8: "Backspace",
      9: "Tab",
      10: "LF / newline",
      13: "Enter / CR",
      27: "Escape",
      32: "Space",
      127: "Delete",
    };
    const name = names[code] ?? `Ctrl+${String.fromCharCode(code + 64)}`;
    return `[${name}]${code === 10 ? "\n" : ""}`;
  });
}

export function toolResult(name: string, raw: string): string {
  if (name !== "console_read") return raw;
  try {
    const result = JSON.parse(raw);
    if (typeof result.output !== "string") return raw;
    const output = result.output.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return `${output || "[No output received]"}${result.waiting ? "\n[Waiting for output]" : ""}${result.eof ? "\n[Console closed]" : ""}`;
  } catch {
    return raw;
  }
}

function cells(line: string): string[] {
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const result: string[] = [];
  let cell = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && value[i + 1] === "|") {
      cell += "|";
      ++i;
    } else if (value[i] === "|") {
      result.push(cell.trim());
      cell = "";
    } else cell += value[i];
  }
  result.push(cell.trim());
  return result;
}
export function markdownTable(lines: string[], start: number) {
  if (!lines[start]?.includes("|") || !lines[start + 1]?.includes("|"))
    return null;
  const header = cells(lines[start]);
  const separator = cells(lines[start + 1]);
  if (
    header.length < 2 ||
    separator.length !== header.length ||
    !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  )
    return null;
  const rows: string[][] = [];
  let end = start + 2;
  while (end < lines.length && lines[end].includes("|")) {
    const row = cells(lines[end]);
    if (row.length !== header.length) break;
    rows.push(row);
    ++end;
  }
  return { header, rows, end };
}
