/** Authoring colors are opaque 8-bit sRGB, in the model's RGBA format. */
declare const paintColor: unique symbol;
export type PaintColor = string & { readonly [paintColor]: true };
export type Rgb = readonly [number, number, number];
export type ColorInput = string | Rgb;

/** No rounding, clamping, CSS parsing, or transparent-to-empty conversion. */
export function normalizePaintColor(input: ColorInput): PaintColor | null {
  if (typeof input === "string") {
    const hex = input.trim().toLowerCase();
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(hex))
      return null;
    let digits = hex.slice(1);
    if (digits.length <= 4)
      digits = [...digits].map((digit) => digit.repeat(2)).join("");
    if (digits.length === 6) digits += "ff";
    return digits.endsWith("ff") ? (`#${digits}` as PaintColor) : null;
  }
  if (
    !Array.isArray(input) ||
    input.length !== 3 ||
    ![input[0], input[1], input[2]].every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    )
  )
    return null;
  return `#${input.map((value) => value.toString(16).padStart(2, "0")).join("")}ff` as PaintColor;
}

export function rgbChannels(color: PaintColor): Rgb {
  const channel = (offset: number) =>
    parseInt(color.slice(offset, offset + 2), 16);
  return [channel(1), channel(3), channel(5)];
}

/** Form fields accept decimal whole channels; blank is never interpreted as zero. */
export function parseRgbFields(fields: readonly string[]): PaintColor | null {
  if (
    fields.length !== 3 ||
    ![fields[0], fields[1], fields[2]].every(
      (field) => typeof field === "string" && /^\d{1,3}$/.test(field.trim()),
    )
  )
    return null;
  return normalizePaintColor([
    Number(fields[0]),
    Number(fields[1]),
    Number(fields[2]),
  ]);
}
