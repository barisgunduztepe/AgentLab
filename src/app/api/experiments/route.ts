import { handleExperimentPost } from "./experiment-post-handler";
import { publicCatalog } from "../../../experiments/catalog";

export const POST = handleExperimentPost;
export function GET(request: Request) {
  const version = new URL(request.url).searchParams.get("comparisonVersion");
  if (version !== null && version !== "2") return Response.json({ error: "Unsupported comparisonVersion." }, { status: 400 });
  return Response.json(publicCatalog(version === "2" ? 2 : 1));
}
