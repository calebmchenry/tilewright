import { PROJECT_MAX_DEPTH, ProjectDecodingError } from "./project-format.ts";

/** Private codec parser. Yields at bounded character intervals, rejects duplicate
 * decoded keys and checks integer spelling/range BEFORE conversion to Number.
 * Null-prototype records keep names such as __proto__ inert until schema checks.
 */
export function* parseProjectJson(text: string): Generator<void, unknown> {
  let cursor = 0;
  let nextYield = 32_768;
  const fail = (path: string, message: string): never => {
    throw new ProjectDecodingError(
      "parse",
      path,
      `${message} (character ${cursor + 1}).`,
    );
  };
  function* checkpoint(): Generator<void> {
    if (cursor >= nextYield) {
      nextYield = cursor + 32_768;
      yield;
    }
  }
  function* whitespace(): Generator<void> {
    yield* checkpoint();
    while (" \t\r\n".includes(text[cursor] ?? "\0")) {
      cursor++;
      yield* checkpoint();
    }
  }
  function* string(path: string): Generator<void, string> {
    if (text[cursor++] !== '"') fail(path, "Expected a quoted string");
    const parts: string[] = [];
    let start = cursor;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === '"') {
        parts.push(text.slice(start, cursor++));
        return parts.join("");
      }
      if (text.charCodeAt(cursor) < 32)
        fail(path, "Unescaped control character in string");
      if (char === "\\") {
        parts.push(text.slice(start, cursor++));
        const escape = text[cursor++];
        if (escape === "u") {
          const hex = text.slice(cursor, cursor + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex))
            fail(path, "Invalid Unicode escape");
          parts.push(String.fromCharCode(Number.parseInt(hex, 16)));
          cursor += 4;
        } else {
          const index = '"\\/bfnrt'.indexOf(escape ?? "\0");
          if (index < 0) fail(path, "Invalid string escape");
          parts.push(['"', "\\", "/", "\b", "\f", "\n", "\r", "\t"][index]);
        }
        start = cursor;
      } else cursor++;
      if (cursor >= nextYield) {
        // Bound retained pieces for long plain text, preserving UTF-16 exactly.
        parts.push(text.slice(start, cursor));
        start = cursor;
        yield* checkpoint();
      }
    }
    return fail(path, "Unterminated string");
  }
  function* value(path: string, depth: number): Generator<void, unknown> {
    yield* whitespace();
    const char = text[cursor];
    if (char === "{" || char === "[") {
      if (depth > PROJECT_MAX_DEPTH)
        throw new ProjectDecodingError(
          "capacity",
          path,
          "JSON nesting exceeds 8 levels.",
        );
      cursor++;
      const isArray = char === "[";
      const close = isArray ? "]" : "}";
      const items: unknown[] = [];
      const record: Record<string, unknown> = Object.create(null);
      yield* whitespace();
      if (text[cursor] === close) {
        cursor++;
        return isArray ? items : record;
      }
      while (true) {
        if (isArray)
          items.push(yield* value(`${path}[${items.length}]`, depth + 1));
        else {
          const key = yield* string(path);
          const child = path === "project" ? key : `${path}.${key}`;
          if (Object.hasOwn(record, key)) fail(child, "Duplicate JSON member");
          yield* whitespace();
          if (text[cursor++] !== ":")
            fail(child, "Expected ':' after member name");
          record[key] = yield* value(child, depth + 1);
        }
        yield* whitespace();
        const separator = text[cursor++];
        if (separator === close) return isArray ? items : record;
        if (separator !== ",") fail(path, `Expected ',' or '${close}'`);
        yield* whitespace();
      }
    }
    if (char === '"') return yield* string(path);
    if (char === "-" || (char >= "0" && char <= "9")) {
      const start = cursor;
      if (char === "-") cursor++;
      const digitsStart = cursor;
      while (text[cursor] >= "0" && text[cursor] <= "9") {
        cursor++;
        yield* checkpoint();
      }
      const digits = text.slice(digitsStart, cursor);
      if (!digits.length || (digits.length > 1 && digits[0] === "0"))
        fail(path, "Expected an integer without leading zeros");
      if (text[cursor] === "." || text[cursor] === "e" || text[cursor] === "E")
        fail(
          path,
          "Numbers must use integer spelling without fractions or exponents",
        );
      if (
        digits.length > 16 ||
        (digits.length === 16 && digits > "9007199254740991")
      )
        fail(path, "Integer exceeds the exact safe range");
      return Number(text.slice(start, cursor));
    }
    for (const [literal, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(literal, cursor)) {
        cursor += literal.length;
        return result;
      }
    }
    return fail(path, "Expected a JSON value");
  }
  const result = yield* value("project", 1);
  yield* whitespace();
  if (cursor !== text.length)
    fail("project", "Unexpected data after root value");
  return result;
}
