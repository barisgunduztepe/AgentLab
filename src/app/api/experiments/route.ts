import { handleExperimentPost } from "./experiment-post-handler";
import { publicCatalog } from "../../../experiments/catalog";

export const POST = handleExperimentPost;
export function GET() { return Response.json(publicCatalog()); }
