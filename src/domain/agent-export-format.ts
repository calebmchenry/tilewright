/** Public agent interchange contract; independent of the editable-project schema.
 * See docs/agent-export-format.md; agent-export.ts implements capture and encoding.
 */
export interface AgentBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export type AgentColor =
  | {
      readonly kind: "raw";
      readonly rgba: string;
      readonly meaning: null;
    }
  | {
      readonly kind: "registered";
      readonly registryId: string;
      readonly rgba: string;
      readonly meaning: string;
    };

export type AgentRun = readonly [
  x: number,
  y: number,
  length: number,
  colorIndex: number,
];

export interface AgentMapV1 {
  readonly format: "tilewright-agent-map";
  readonly version: 1;
  readonly bounds: AgentBounds;
  readonly colors: readonly AgentColor[];
  readonly layers: readonly {
    readonly id: string;
    readonly name: string;
    readonly runs: readonly AgentRun[];
  }[];
  readonly areas: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly tier: "detail" | "locality" | "region";
    readonly bounds: AgentBounds;
  }[];
}
