import { buildRepositoryGraph } from "../src/graph.js";

export function buildGraph(repoUrl, repositoryDir, options) {
  return buildRepositoryGraph(repoUrl, repositoryDir, options);
}
