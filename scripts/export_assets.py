"""Export web assets for the LiDAR deployment demo.

This script converts the trained scikit-learn DecisionTreeClassifier to plain
JSON and builds a small real-frame playback stream from the ROI .npy files.
The web app then runs fully in the browser, which keeps the Vercel deployment
simple and avoids a Python/scikit-learn server runtime.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".pydeps"))
sys.path.insert(0, str(ROOT / "CODIGO"))

import joblib
import numpy as np
import pandas as pd

from pipeline_inference import AlertBuffer, frame_to_feature_vector


APP_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = APP_DIR / "data"
MODEL_PATH = ROOT / "MODELO_DESPLEGADO" / "modelo_decision_tree.joblib"
METADATA_PATH = ROOT / "MODELO_DESPLEGADO" / "modelo_decision_tree.json"
MANIFEST_PATH = (
    ROOT
    / "RESULTADOS DE LA GRABACION CON EL LIDAR"
    / "roi_procesado"
    / "manifest_roi.csv"
)


def round_number(value: float, ndigits: int = 6) -> float:
    return round(float(value), ndigits)


def export_model() -> dict:
    model = joblib.load(MODEL_PATH)
    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    tree = model.tree_
    model_json = {
        "algorithm": metadata["algorithm"],
        "feature_cols": metadata["feature_cols"],
        "support_radius_m": metadata["support_radius_m"],
        "classes": [int(c) for c in model.classes_.tolist()],
        "label_names": {"0": "libre", "1": "ocupado"},
        "children_left": [int(x) for x in tree.children_left.tolist()],
        "children_right": [int(x) for x in tree.children_right.tolist()],
        "feature": [int(x) for x in tree.feature.tolist()],
        "threshold": [float(x) for x in tree.threshold.tolist()],
        "value": tree.value.squeeze(axis=1).tolist(),
        "reference_metrics": metadata["loso_reference_metrics"],
        "metadata": metadata,
    }
    return model_json


def downsample_points(points: np.ndarray, max_points: int = 170) -> list[list[float]]:
    if len(points) == 0:
        return []
    if len(points) > max_points:
        idx = np.linspace(0, len(points) - 1, max_points).astype(int)
        points = points[idx]
    return [
        [round_number(x, 3), round_number(y, 3), round_number(z, 3)]
        for x, y, z in points
    ]


def load_scene(manifest: pd.DataFrame, scene: str) -> list[dict]:
    rows = manifest[manifest.scene == scene].sort_values("frame_idx")
    records: list[dict] = []
    buffer = AlertBuffer(window=5, threshold=3)
    model = joblib.load(MODEL_PATH)
    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        feature_cols = json.load(f)["feature_cols"]

    for row in rows.itertuples(index=False):
        points = np.load(ROOT / row.roi_file)
        vector = frame_to_feature_vector(points)
        if vector is None:
            pred = 1
            probabilities = [0.0, 1.0]
            features = None
        else:
            pred = int(model.predict(vector.reshape(1, -1))[0])
            probabilities = model.predict_proba(vector.reshape(1, -1))[0].tolist()
            features = {
                name: round_number(value, 8)
                for name, value in zip(feature_cols, vector)
            }

        alert = bool(buffer.update(pred))
        records.append(
            {
                "scene": str(row.scene),
                "frame_idx": int(row.frame_idx),
                "true_label": int(row.label),
                "true_label_name": str(row.label_name),
                "prediction": pred,
                "prediction_name": "ocupado" if pred == 1 else "libre",
                "probabilities": [round_number(p, 6) for p in probabilities],
                "alert": alert,
                "n_total_points": int(row.n_total_points),
                "n_corridor_points": int(row.n_corridor_points),
                "n_critical_points": int(row.n_critical_points),
                "critical_ratio": round_number(row.critical_ratio, 8),
                "features": features,
                "points": downsample_points(points),
            }
        )
    return records


def export_streams() -> dict:
    manifest = pd.read_csv(MANIFEST_PATH)
    scene_order = ["libre_01", "ocupado_06"]
    stream_records: list[dict] = []
    for scene in scene_order:
        stream_records.extend(load_scene(manifest, scene))

    return {
        "title": "Simulacion diferida: libre_01 -> ocupado_06",
        "fps": 10,
        "alert_window": 5,
        "alert_threshold": 3,
        "scene_order": scene_order,
        "frames": stream_records,
        "summary": {
            "total_frames": len(stream_records),
            "free_frames": sum(1 for frame in stream_records if frame["true_label"] == 0),
            "occupied_frames": sum(1 for frame in stream_records if frame["true_label"] == 1),
            "source": "CODIGO/03_despliegue_modelo.ipynb",
        },
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(DATA_DIR / "model.json", "w", encoding="utf-8") as f:
        json.dump(export_model(), f, indent=2, ensure_ascii=False)
    with open(DATA_DIR / "demo_stream.json", "w", encoding="utf-8") as f:
        json.dump(export_streams(), f, ensure_ascii=False)
    print("Exported", DATA_DIR / "model.json")
    print("Exported", DATA_DIR / "demo_stream.json")


if __name__ == "__main__":
    main()
