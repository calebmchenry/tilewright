import { cellKey, type Cell, type TileValue } from "./values.ts";

/** Storage tuning only; unrelated to the 64-tile visual lattice or wire formats. */
export const STORAGE_PARTITION_SIZE = 32;
const PARTITION_CELLS = STORAGE_PARTITION_SIZE ** 2;
const DENSE_THRESHOLD = 128;
const SPARSE_THRESHOLD = 64;

/** Private numeric encoding. Zero is empty; occupied paint has a nonzero token. */
export class TilePalette {
  #entries = new Map<number, { value: TileValue; references: number }>();
  #tokens = new Map<string, number>();
  #next = 1;

  get size(): number {
    return this.#entries.size;
  }
  value(token: number): Cell {
    return token === 0 ? null : this.#entries.get(token)!.value;
  }

  retain(value: Cell): number {
    if (value === null) return 0;
    const key = cellKey(value);
    let token = this.#tokens.get(key);
    if (token === undefined) {
      if (this.#entries.size === 0xffffffff)
        throw new RangeError("Tile palette capacity exceeded.");
      // A cyclic allocator needs no ever-growing list of deleted colors/tokens.
      // On wrap, skip still-live tokens; numeric tokens never escape the model.
      while (this.#entries.has(this.#next)) this.#advance();
      token = this.#next;
      this.#advance();
      this.#entries.set(token, { value, references: 0 });
      this.#tokens.set(key, token);
    }
    this.retainToken(token);
    return token;
  }

  retainToken(token: number): void {
    if (token !== 0) this.#entries.get(token)!.references++;
  }

  release(token: number): void {
    if (token === 0) return;
    const entry = this.#entries.get(token)!;
    if (--entry.references !== 0) return;
    this.#entries.delete(token);
    this.#tokens.delete(cellKey(entry.value));
    if (this.#entries.size === 0) this.#next = 1;
  }

  #advance(): void {
    this.#next = this.#next === 0xffffffff ? 1 : this.#next + 1;
  }
}

export class TilePartition {
  readonly x: number;
  readonly y: number;
  #cells: Map<number, number> | Uint32Array = new Map();
  #size = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  get size(): number {
    return this.#size;
  }
  get dense(): boolean {
    return this.#cells instanceof Uint32Array;
  }
  get bufferBytes(): number {
    return this.#cells instanceof Uint32Array ? this.#cells.byteLength : 0;
  }
  get(index: number): number {
    return this.#cells instanceof Uint32Array
      ? this.#cells[index]
      : (this.#cells.get(index) ?? 0);
  }

  /** Internal bounded row scan; choose representation once, resolve no paint. */
  *runs(
    start: number,
    end: number,
  ): Generator<{ offset: number; length: number; token: number }> {
    const cells = this.#cells;
    if (cells instanceof Uint32Array) {
      for (let offset = start; offset < end;) {
        const token = cells[offset];
        let next = offset + 1;
        while (next < end && cells[next] === token) next++;
        if (token) yield { offset, length: next - offset, token };
        offset = next;
      }
    } else {
      for (let offset = start; offset < end;) {
        const token = cells.get(offset) ?? 0;
        let next = offset + 1;
        while (next < end && (cells.get(next) ?? 0) === token) next++;
        if (token) yield { offset, length: next - offset, token };
        offset = next;
      }
    }
  }

  set(index: number, token: number): void {
    const previous = this.get(index);
    if (previous === token) return;
    this.#size += Number(token !== 0) - Number(previous !== 0);
    if (this.#cells instanceof Uint32Array) {
      this.#cells[index] = token;
      if (this.#size <= SPARSE_THRESHOLD) {
        const sparse = new Map<number, number>();
        this.#cells.forEach((value, offset) => {
          if (value) sparse.set(offset, value);
        });
        this.#cells = sparse;
      }
    } else {
      if (token === 0) this.#cells.delete(index);
      else this.#cells.set(index, token);
      if (this.#size >= DENSE_THRESHOLD) {
        const dense = new Uint32Array(PARTITION_CELLS);
        for (const [offset, value] of this.#cells) dense[offset] = value;
        this.#cells = dense;
      }
    }
  }
}
