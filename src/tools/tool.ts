type ParameterSchema = {
  type: "string" | "number" | "integer" | "boolean";
  description?: string;
  enum?: readonly (string | number | boolean)[];
};

/** Deliberately limited JSON Schema subset shared by every adapter. */
export interface ToolParametersSchema {
  type: "object";
  properties: Record<string, ParameterSchema>;
  required: readonly string[];
  additionalProperties: false;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
}

export interface Tool {
  definition: ToolDefinition;
  validateInput(input: unknown): boolean;
  execute(input: import("../agent/model-completion").JsonObject, options: { signal?: AbortSignal }): Promise<string>;
}
