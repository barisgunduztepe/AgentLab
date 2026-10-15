import { getScenarioById } from "./scenarios";
export function getScenarioFakeResponses(id: string) { return getScenarioById(id)?.fakeByKind.single?.primary; }
export function getComparisonFakeResponses(id: string) {
  const responses = getScenarioFakeResponses(id);
  return responses ? { baseline: [...responses], structured: [...responses] } : undefined;
}
