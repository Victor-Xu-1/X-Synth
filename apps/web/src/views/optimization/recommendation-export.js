import { saveAs } from "file-saver";

export function hasRecommendationCsv(result) {
  return result?.engine === "BayBE" && result.empirically_confirmed === false &&
    Array.isArray(result.recommendations) && result.recommendations.length > 0 &&
    typeof result.csv_content === "string" && result.csv_content.trim().length > 0;
}

export function exportRecommendationCsv(result, filename = "next-experiments.csv") {
  if (!hasRecommendationCsv(result)) return;
  saveAs(new Blob([result.csv_content], { type: "text/csv;charset=utf-8" }), filename);
}
