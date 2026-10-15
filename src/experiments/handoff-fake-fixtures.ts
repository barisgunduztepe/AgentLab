import { getScenarioById } from "./scenarios";
export function getHandoffFakeFixtures() {
  const plan = getScenarioById("analyst-finalizer-handoff")!.fakeByKind.handoff;
  return { analyst: plan.analyst, finalizer: plan.finalizer };
}
