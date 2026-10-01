import type { ModelResponse } from "../agent/model-provider";

export interface HandoffFakeFixtures {
  analyst: readonly ModelResponse[];
  finalizer: readonly ModelResponse[];
}

const HANDOFF_FAKE_FIXTURES: HandoffFakeFixtures = {
  analyst: [
    {
      type: "text",
      text: "A thermostat measures room temperature, compares it with the set point, and activates heating or cooling to reduce the difference.",
    },
  ],
  finalizer: [
    {
      type: "text",
      text: "A thermostat keeps a room near its target by measuring the air temperature and comparing it with the set point. When the room is too cold or hot, it turns heating or cooling on, then switches it off as the target is reached.",
    },
  ],
};

export function getHandoffFakeFixtures(): HandoffFakeFixtures {
  return HANDOFF_FAKE_FIXTURES;
}
