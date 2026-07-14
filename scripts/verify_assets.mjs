import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const model = JSON.parse(readFileSync(join(root, "data", "model.json"), "utf8"));
const stream = JSON.parse(readFileSync(join(root, "data", "demo_stream.json"), "utf8"));

function predict(features) {
  let node = 0;
  while (model.children_left[node] !== -1) {
    const key = model.feature_cols[model.feature[node]];
    node = features[key] <= model.threshold[node]
      ? model.children_left[node]
      : model.children_right[node];
  }
  const values = model.value[node];
  return values[1] >= values[0] ? 1 : 0;
}

let mismatches = 0;
let free = 0;
let occupied = 0;
for (const frame of stream.frames) {
  const predicted = predict(frame.features);
  if (predicted !== frame.prediction) mismatches += 1;
  if (predicted === 0) free += 1;
  else occupied += 1;
}

if (mismatches > 0) {
  throw new Error(`Prediction mismatches: ${mismatches}`);
}

console.log(JSON.stringify({
  frames: stream.frames.length,
  free_predictions: free,
  occupied_predictions: occupied,
  mismatches,
}, null, 2));
