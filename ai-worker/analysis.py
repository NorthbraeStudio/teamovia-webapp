import os
import pathlib
import re
import shutil
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import modal

# Resolve the .env.local path relative to this file (ai-worker/../.env.local)
_ENV_PATH = str(pathlib.Path(__file__).parent.parent / ".env.local")

# ---------------------------------------------------------------------------
# App definition
# ---------------------------------------------------------------------------
# modal.Secret.from_dotenv reads your .env.local at deploy time and injects
# every variable into the function environment — no Modal Secrets UI needed.
# ---------------------------------------------------------------------------

app = modal.App("teamovia-yolo11-analysis")

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install(
        "libgl1",
        "libglib2.0-0",
        "ffmpeg",
    )
    .pip_install(
        "yt-dlp>=2025.10.14",
        "ultralytics==8.0.215",
        "lapx>=0.5.2",
        "supabase>=2.15.0",
        "pydantic>=2.0",
        "fastapi",
        "numpy>=1.26.0",
        "scikit-learn>=1.4.0",
    )
)

BATCH_SIZE = 50  # write tactical_events in batches to reduce Supabase round-trips
DEFAULT_FPS = 25.0
SNAPSHOT_SECONDS = 6.0
ANOMALY_DROP_THRESHOLD = 10.0
UNIT_DISLOCATION_STDDEV_THRESHOLD = 3.0
FORMATION_SAMPLE_SECONDS = 30
PREFLIGHT_MAX_SAMPLES = 24
PREFLIGHT_FRAME_STRIDE = 12


@app.function(
    image=image,
    # Reads .env.local from the project root when you run `modal deploy`.
    # This injects NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
    # MODAL_API_KEY into the container environment without needing the Secrets UI.
    secrets=[modal.Secret.from_dotenv(_ENV_PATH)],
    gpu="T4",
    timeout=7200,  # 2 hours — enough for a full 90-min match + download
)
@modal.fastapi_endpoint(method="POST")
def analyse_match(body: Dict[str, Any]) -> Dict[str, Any]:
    import fastapi
    import numpy as np
    import torch
    from sklearn.cluster import KMeans
    from supabase import create_client
    from ultralytics import YOLO
    import yt_dlp

    # PyTorch 2.6+ defaults torch.load(weights_only=True), which breaks
    # older Ultralytics checkpoints. We only load trusted upstream weights.
    original_torch_load = torch.load

    def torch_load_compat(*args: Any, **kwargs: Any):
        kwargs.setdefault("weights_only", False)
        return original_torch_load(*args, **kwargs)

    torch.load = torch_load_compat

    def clean_secret(value: Any) -> Optional[str]:
        if not isinstance(value, str):
            return None
        trimmed = value.strip().strip('"').strip("'").strip()
        return trimmed or None

    def hex_to_rgb(value: Optional[str], fallback: tuple[int, int, int]) -> tuple[int, int, int]:
        if not value:
            return fallback
        normalized = value.strip().lstrip("#")
        if len(normalized) != 6:
            return fallback
        try:
            return (
                int(normalized[0:2], 16),
                int(normalized[2:4], 16),
                int(normalized[4:6], 16),
            )
        except ValueError:
            return fallback

    def colour_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
        return float(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5)

    def get_jersey_rgb(
        frame_image: Any,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
    ) -> tuple[int, int, int]:
        if frame_image is None:
            return (127, 127, 127)

        height, width = frame_image.shape[:2]
        left = max(0, min(width - 1, int(round(x1))))
        right = max(0, min(width, int(round(x2))))
        top = max(0, min(height - 1, int(round(y1))))
        bottom = max(0, min(height, int(round(y2))))

        if right <= left or bottom <= top:
            return (127, 127, 127)

        box_height = bottom - top
        box_width = right - left

        # Focus on chest/torso patch to reduce grass/background noise.
        jersey_top = top + int(0.15 * box_height)
        jersey_bottom = top + int(0.55 * box_height)
        jersey_left = left + int(0.2 * box_width)
        jersey_right = right - int(0.2 * box_width)

        jersey_top = max(top, min(bottom - 1, jersey_top))
        jersey_bottom = max(jersey_top + 1, min(bottom, jersey_bottom))
        jersey_left = max(left, min(right - 1, jersey_left))
        jersey_right = max(jersey_left + 1, min(right, jersey_right))

        patch = frame_image[jersey_top:jersey_bottom, jersey_left:jersey_right]
        if patch.size == 0:
            return (127, 127, 127)

        # YOLO image is BGR; convert to RGB average.
        bgr = patch.reshape(-1, 3).astype("float32")
        mean_bgr = bgr.mean(axis=0)
        return (int(mean_bgr[2]), int(mean_bgr[1]), int(mean_bgr[0]))

    def assign_teams(
        detections: list[Dict[str, Any]],
        home_rgb: tuple[int, int, int],
        away_rgb: tuple[int, int, int],
    ) -> list[str]:
        if len(detections) == 0:
            return []

        if len(detections) == 1:
            rgb = detections[0]["jersey_rgb"]
            return ["home" if colour_distance(rgb, home_rgb) <= colour_distance(rgb, away_rgb) else "away"]

        jersey_matrix = np.array([d["jersey_rgb"] for d in detections], dtype=np.float32)
        labels: list[str] = []

        try:
            model = KMeans(n_clusters=2, n_init=10, random_state=42)
            cluster_ids = model.fit_predict(jersey_matrix)
            centres = model.cluster_centers_

            home_cluster = 0
            away_cluster = 1
            dist_c0_home = colour_distance(tuple(int(v) for v in centres[0]), home_rgb)
            dist_c1_home = colour_distance(tuple(int(v) for v in centres[1]), home_rgb)
            if dist_c1_home < dist_c0_home:
                home_cluster = 1
                away_cluster = 0

            for cluster_id in cluster_ids:
                labels.append("home" if int(cluster_id) == home_cluster else "away")

            # Guard against degenerate clustering where both clusters are too similar.
            if home_cluster == away_cluster:
                raise RuntimeError("KMeans cluster mapping collapsed")
        except Exception:
            for detection in detections:
                rgb = detection["jersey_rgb"]
                labels.append(
                    "home" if colour_distance(rgb, home_rgb) <= colour_distance(rgb, away_rgb) else "away"
                )

        return labels

    # --- auth -----------------------------------------------------------
    modal_api_key = os.environ.get("MODAL_API_KEY", "")
    if modal_api_key and body.get("worker_auth") != modal_api_key:
        raise fastapi.HTTPException(status_code=401, detail="Unauthorised")

    # --- validate payload -----------------------------------------------
    video_url: str = body.get("video_url", "")
    preflight_only = bool(body.get("preflight_only"))
    match_id: str = body.get("match_id", "")
    if not video_url or (not preflight_only and not match_id):
        raise fastapi.HTTPException(
            status_code=400, detail="video_url is required, and match_id is required for full analysis"
        )

    home_team_color = clean_secret(body.get("home_team_color")) or "#E11D48"
    away_team_color = clean_secret(body.get("away_team_color")) or "#2563EB"

    # --- supabase client ------------------------------------------------
    supabase_url = clean_secret(body.get("supabase_url")) or clean_secret(
        os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    supabase_key = clean_secret(body.get("supabase_service_role_key")) or clean_secret(
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    if not supabase_url or not supabase_key:
        raise fastapi.HTTPException(
            status_code=500, detail="Supabase credentials missing in worker environment"
        )

    try:
        supabase = create_client(supabase_url, supabase_key)
    except Exception as exc:
        raise fastapi.HTTPException(
            status_code=500, detail=f"Supabase client init failed: {exc}"
        ) from exc

    def iso_now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def is_missing_status_column_error(error_text: str) -> bool:
        return bool(
            re.search(
                r"Could not find the 'analysis_status' column|analysis_started_at|analysis_completed_at|analysis_error",
                error_text,
                re.IGNORECASE,
            )
        )

    def update_match_status(
        status: str,
        *,
        started_at: Optional[str] = None,
        completed_at: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> None:
        payload: Dict[str, Any] = {
            "analysis_status": status,
            "analysis_started_at": started_at,
            "analysis_completed_at": completed_at,
            "analysis_error": error_message,
        }
        try:
            supabase.table("matches").update(payload).eq("id", match_id).execute()
        except Exception as status_error:
            if is_missing_status_column_error(str(status_error)):
                return
            raise

    run_started_at = iso_now()
    if not preflight_only:
        update_match_status(
            "processing",
            started_at=run_started_at,
            completed_at=None,
            error_message=None,
        )

    total_events = 0
    batch: list = []

    def normalize_event_for_db(item: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(item)
        timestamp_value = normalized.get("timestamp_seconds")
        if isinstance(timestamp_value, (int, float)):
            normalized["timestamp_seconds"] = round(float(timestamp_value), 3)

        for key in ("x_coord", "y_coord"):
            value = normalized.get(key)
            if isinstance(value, (int, float)):
                normalized[key] = round(float(value), 3)

        tas_value = normalized.get("tas_score")
        if isinstance(tas_value, (int, float)):
            normalized["tas_score"] = round(float(tas_value), 2)

        title = normalized.get("title")
        if not isinstance(title, str) or not title.strip():
            event_type = str(normalized.get("event_type", "event")).replace("_", " ").strip()
            player_actor = str(normalized.get("player_actor", "system")).strip()
            normalized["title"] = f"{event_type.title()} - {player_actor}"[:120]

        return normalized

    def strip_unsupported_columns(items: list, error_text: str) -> list:
        missing_columns = re.findall(r"Could not find the '([^']+)' column", error_text)
        if not missing_columns:
            return items

        keys_to_remove = set(missing_columns)
        return [
            {key: value for key, value in item.items() if key not in keys_to_remove}
            for item in items
        ]

    def insert_with_schema_fallback(items: list) -> int:
        candidate_items = list(items)
        if not candidate_items:
            return 0

        # Some Supabase environments lag schema updates. Remove missing columns iteratively.
        for _ in range(8):
            try:
                supabase.table("tactical_events").insert(candidate_items).execute()
                return len(candidate_items)
            except Exception as insert_error:
                stripped_items = strip_unsupported_columns(candidate_items, str(insert_error))
                if stripped_items == candidate_items:
                    raise
                candidate_items = stripped_items
                if not candidate_items:
                    return 0

        raise RuntimeError("Unable to insert tactical events after schema fallback retries")

    def is_youtube_source(value: str) -> bool:
        try:
            parsed = urlparse(value)
        except Exception:
            return False

        host = (parsed.hostname or "").lower()
        return host in {
            "youtu.be",
            "youtube.com",
            "www.youtu.be",
            "m.youtube.com",
            "www.youtube.com",
        }

    def is_direct_video_source(value: str) -> bool:
        try:
            parsed = urlparse(value)
        except Exception:
            return False

        if parsed.scheme not in {"http", "https"}:
            return False

        return bool(re.search(r"\.(mp4|mov|m4v|webm)$", parsed.path, re.IGNORECASE))

    def download_direct_video(source_url: str, output_dir: str) -> tuple[Dict[str, Any], str]:
        parsed = urlparse(source_url)
        extension_match = re.search(r"\.(mp4|mov|m4v|webm)$", parsed.path, re.IGNORECASE)
        extension = extension_match.group(1).lower() if extension_match else "mp4"
        output_path = os.path.join(output_dir, f"video.{extension}")

        request = Request(
            source_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            },
        )

        with urlopen(request, timeout=300) as response, open(output_path, "wb") as output_file:
            shutil.copyfileobj(response, output_file)

        return {"fps": DEFAULT_FPS}, output_path

    def with_event_type(items: list, forced_event_type: str) -> list:
        return [{**item, "event_type": forced_event_type} for item in items]

    def try_event_type_candidates(items: list) -> int:
        candidates = ["player_tracking", "tracking", "summary", "event", "analysis"]
        last_error: Optional[Exception] = None

        for event_type in candidates:
            try:
                candidate_items = with_event_type(items, event_type)
                return insert_with_schema_fallback(candidate_items)
            except Exception as candidate_error:
                last_error = candidate_error

        if last_error is not None:
            raise last_error
        raise RuntimeError("Unable to insert tactical events with compatible event_type")

    def flush_batch() -> None:
        nonlocal total_events
        if batch:
            normalized_batch = [normalize_event_for_db(item) for item in batch]
            try:
                total_events += insert_with_schema_fallback(normalized_batch)
            except Exception as insert_error:
                # Some environments enforce a strict event_type constraint.
                # Retry with compatible types while preserving evidence text.
                fallback_batch = []
                for item in normalized_batch:
                    event_type = item.get("event_type", "player_tracking")
                    if event_type in {"player_tracking", "summary"}:
                        fallback_batch.append(item)
                        continue

                    fallback_item = dict(item)
                    fallback_item["event_type"] = "player_tracking"
                    fallback_item["insight_text"] = (
                        f"[{event_type}] {item.get('insight_text', '').strip()}".strip()
                    )
                    fallback_batch.append(fallback_item)

                try:
                    total_events += insert_with_schema_fallback(fallback_batch)
                except Exception as fallback_error:
                    if "tactical_events_event_type_check" in str(fallback_error) or "event_type" in str(fallback_error):
                        total_events += try_event_type_candidates(fallback_batch)
                    else:
                        raise
            batch.clear()

    def average_tas(events: list[Dict[str, Any]], window_start: float, window_end: float) -> Optional[float]:
        values: list[float] = []
        for item in events:
            ts = item.get("timestamp_seconds")
            tas = item.get("tas_score")
            if not isinstance(ts, (int, float)) or not isinstance(tas, (int, float)):
                continue
            if float(window_start) <= float(ts) < float(window_end):
                values.append(float(tas))

        if not values:
            return None
        return sum(values) / len(values)

    def analyse_manual_goal_recovery() -> None:
        nonlocal total_events
        try:
            manual_events_resp = (
                supabase.table("tactical_events")
                .select("timestamp_seconds, team_assignment, player_actor")
                .eq("match_id", match_id)
                .eq("event_type", "manual_goal_event")
                .execute()
            )
        except Exception:
            return

        manual_events = manual_events_resp.data if manual_events_resp and manual_events_resp.data else []
        if not manual_events:
            return

        tracking_resp = (
            supabase.table("tactical_events")
            .select("timestamp_seconds, tas_score, team_assignment")
            .eq("match_id", match_id)
            .eq("event_type", "player_tracking")
            .gte("timestamp_seconds", 0)
            .order("timestamp_seconds", desc=False)
            .execute()
        )
        tracking_events = tracking_resp.data if tracking_resp and tracking_resp.data else []
        if not tracking_events:
            return

        for goal_event in manual_events:
            goal_ts_raw = goal_event.get("timestamp_seconds")
            team_assignment = str(goal_event.get("team_assignment") or "unknown")
            if not isinstance(goal_ts_raw, (int, float)):
                continue

            goal_ts = float(goal_ts_raw)
            baseline_avg = average_tas(tracking_events, max(0.0, goal_ts - 60.0), goal_ts)
            post_60_avg = average_tas(tracking_events, goal_ts, goal_ts + 60.0)

            if baseline_avg is None:
                baseline_avg = average_tas(tracking_events, max(0.0, goal_ts - 30.0), goal_ts)
            if baseline_avg is None:
                continue

            recovery_target = baseline_avg * 0.95
            slump_threshold = baseline_avg * 0.9
            if post_60_avg is None:
                post_60_avg = baseline_avg

            recovery_latency_seconds: Optional[int] = None
            max_probe_seconds = 300
            probe_step = 5
            for offset in range(0, max_probe_seconds + probe_step, probe_step):
                window_avg = average_tas(
                    tracking_events,
                    goal_ts + float(offset),
                    goal_ts + float(offset + probe_step),
                )
                if window_avg is not None and window_avg >= recovery_target:
                    recovery_latency_seconds = offset
                    break

            is_slump = post_60_avg < slump_threshold
            insight_text = (
                f"Recovery Latency assessed after manual goal at {goal_ts:.1f}s. "
                f"Baseline TAS {baseline_avg:.1f}, post-60s TAS {post_60_avg:.1f}, "
                f"recovery latency {recovery_latency_seconds if recovery_latency_seconds is not None else 'not reached'}s."
            )

            recovery_event = normalize_event_for_db(
                {
                    "match_id": match_id,
                    "timestamp_seconds": goal_ts,
                    "player_actor": f"{team_assignment}_unit",
                    "x_coord": 0,
                    "y_coord": 0,
                    "insight_text": insight_text,
                    "tas_score": round(post_60_avg, 2),
                    "event_type": "recovery_latency",
                    "team_assignment": team_assignment,
                    "recovery_latency_seconds": recovery_latency_seconds,
                }
            )

            try:
                total_events += insert_with_schema_fallback([recovery_event])
            except Exception:
                fallback_event = dict(recovery_event)
                fallback_event["event_type"] = "summary"
                fallback_event["insight_text"] = (
                    f"[recovery_latency] {recovery_event.get('insight_text', '')}"
                )
                total_events += insert_with_schema_fallback([fallback_event])

            if is_slump and (
                recovery_latency_seconds is None or recovery_latency_seconds > 120
            ):
                slump_event = normalize_event_for_db(
                    {
                        "match_id": match_id,
                        "timestamp_seconds": goal_ts,
                        "player_actor": "system",
                        "x_coord": 0,
                        "y_coord": 0,
                        "insight_text": "Post-concession psychological slump detected. Tactical resilience index: Low.",
                        "tas_score": round(post_60_avg, 2),
                        "event_type": "summary",
                    }
                )
                supabase.table("tactical_events").insert(slump_event).execute()
                total_events += 1

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            # --- download video -------------------------------------------
            try:
                if is_direct_video_source(video_url) and not is_youtube_source(video_url):
                    info, video_path = download_direct_video(video_url, tmpdir)
                else:
                    output_template = os.path.join(tmpdir, "video.%(ext)s")
                    download_options = {
                        "format": "best",
                        "outtmpl": output_template,
                        "quiet": True,
                        "no_warnings": True,
                        "merge_output_format": "mp4",
                    }

                    with yt_dlp.YoutubeDL(download_options) as ydl:
                        info = ydl.extract_info(video_url, download=True)
                        video_path = ydl.prepare_filename(info)
            except Exception as exc:
                raise fastapi.HTTPException(
                    status_code=422,
                    detail=f"Video download failed: {exc}",
                ) from exc

            if not info or not video_path:
                raise fastapi.HTTPException(
                    status_code=422,
                    detail="Video download failed: No media info returned.",
                )

            raw_fps = info.get("fps") if isinstance(info, dict) else None
            fps = float(raw_fps) if isinstance(raw_fps, (int, float)) and raw_fps > 0 else DEFAULT_FPS
            frame_seconds = 1.0 / fps
            snapshot_interval_frames = max(1, int(round(SNAPSHOT_SECONDS / frame_seconds)))

            if not video_path.endswith(".mp4"):
                mp4_candidate = video_path.rsplit(".", 1)[0] + ".mp4"
                if os.path.exists(mp4_candidate):
                    video_path = mp4_candidate

            # --- run tracker -----------------------------------------------
            model = YOLO("yolov8n.pt")
            home_rgb = hex_to_rgb(home_team_color, (225, 29, 72))
            away_rgb = hex_to_rgb(away_team_color, (37, 99, 235))

            if preflight_only:
                sampled_frames = 0
                frames_with_people = 0
                total_person_detections = 0

                for frame_id, result in enumerate(
                    model.predict(source=video_path, device="cuda", stream=True, verbose=False)
                ):
                    if frame_id % PREFLIGHT_FRAME_STRIDE != 0:
                        continue

                    person_count = 0
                    if result is not None and result.boxes is not None:
                        for box in result.boxes:
                            cls = int(box.cls[0])
                            if cls == 0:
                                person_count += 1

                    sampled_frames += 1
                    total_person_detections += person_count
                    if person_count > 0:
                        frames_with_people += 1

                    if sampled_frames >= PREFLIGHT_MAX_SAMPLES:
                        break

                avg_person_detections = (
                    float(total_person_detections) / float(sampled_frames)
                    if sampled_frames > 0
                    else 0.0
                )
                preflight_passed = (
                    sampled_frames > 0
                    and frames_with_people >= 3
                    and avg_person_detections >= 1.0
                )

                return {
                    "preflight_only": True,
                    "preflight_passed": preflight_passed,
                    "sampled_frames": sampled_frames,
                    "frames_with_people": frames_with_people,
                    "avg_person_detections": round(avg_person_detections, 2),
                    "warning": None
                    if preflight_passed
                    else "Low player visibility in sampled frames. Analysis may fail or produce low-confidence output.",
                }

            snapshot_confidences: list[float] = []
            snapshot_x: list[float] = []
            snapshot_y: list[float] = []
            snapshot_team_counts: dict[str, int] = {"home": 0, "away": 0}

            first_window_y: dict[str, list[float]] = defaultdict(list)
            first_window_defensive_sets: dict[str, dict[int, set[int]]] = defaultdict(dict)
            team_orientation_inverted: dict[str, bool] = {"home": False, "away": False}
            team_unit_thresholds: dict[str, tuple[float, float]] = {
                "home": (0.33, 0.66),
                "away": (0.33, 0.66),
            }
            formation_emitted = False

            current_second: Optional[int] = None
            second_defender_samples: dict[str, dict[int, Dict[str, Any]]] = {
                "home": {},
                "away": {},
            }

            previous_snapshot_tas: Optional[float] = None
            person_detections_total = 0

            def oriented_y(team: str, y_norm: float) -> float:
                return 1.0 - y_norm if team_orientation_inverted.get(team, False) else y_norm

            def infer_unit(team: str, y_norm: float) -> tuple[str, str]:
                low, high = team_unit_thresholds.get(team, (0.33, 0.66))
                oriented = oriented_y(team, y_norm)
                if oriented <= low:
                    return ("Defender", "RearGuard")
                if oriented <= high:
                    return ("Midfielder", "Midfield")
                return ("Forward", "AttackingLine")

            def flush_second_dislocation(second_index: int) -> None:
                for team, tracking_map in second_defender_samples.items():
                    defenders = [item for item in tracking_map.values() if item["unit_type"] == "RearGuard"]
                    if len(defenders) < 3:
                        continue

                    y_values = np.array([item["y"] for item in defenders], dtype=np.float32)
                    stdev = float(np.std(y_values))
                    if stdev <= UNIT_DISLOCATION_STDDEV_THRESHOLD:
                        continue

                    avg_y = float(np.mean(y_values))
                    outlier = max(defenders, key=lambda item: abs(item["y"] - avg_y))
                    batch.append(
                        {
                            "match_id": match_id,
                            "timestamp_seconds": float(second_index),
                            "player_actor": outlier["actor"],
                            "x_coord": outlier["x"],
                            "y_coord": outlier["y"],
                            "insight_text": (
                                "Defensive Line Desynchronisation: "
                                f"{outlier['role']} out of alignment. High risk of vertical penetration."
                            ),
                            "tas_score": round(max(0.0, 100.0 - stdev * 10.0), 2),
                            "event_type": "unit_dislocation",
                            "team_assignment": team,
                            "unit_type": "RearGuard",
                            "player_tracking_id": outlier["track_id"],
                        }
                    )

            for frame_id, result in enumerate(
                model.track(source=video_path, device="cuda", stream=True)
            ):
                if result is None or result.boxes is None:
                    continue

                timestamp_seconds = round(frame_id * frame_seconds, 3)
                second_index = int(timestamp_seconds)
                if current_second is None:
                    current_second = second_index
                elif second_index != current_second:
                    flush_second_dislocation(current_second)
                    second_defender_samples = {"home": {}, "away": {}}
                    current_second = second_index

                frame_height = (
                    float(result.orig_shape[0])
                    if getattr(result, "orig_shape", None) and len(result.orig_shape) > 0
                    else 1.0
                )

                frame_detections: list[Dict[str, Any]] = []
                for box_index, box in enumerate(result.boxes):
                    cls = int(box.cls[0])
                    if cls != 0:
                        continue

                    person_detections_total += 1

                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    x_center = float((x1 + x2) / 2)
                    y_center = float((y1 + y2) / 2)
                    confidence = float(box.conf[0])
                    tracking_id = (
                        int(box.id[0])
                        if getattr(box, "id", None) is not None and len(box.id) > 0
                        else int(box_index)
                    )
                    jersey_rgb = get_jersey_rgb(
                        getattr(result, "orig_img", None),
                        x1,
                        y1,
                        x2,
                        y2,
                    )

                    frame_detections.append(
                        {
                            "tracking_id": tracking_id,
                            "x_center": x_center,
                            "y_center": y_center,
                            "confidence": confidence,
                            "jersey_rgb": jersey_rgb,
                        }
                    )

                team_labels = assign_teams(frame_detections, home_rgb, away_rgb)
                for detection, team_assignment in zip(frame_detections, team_labels):
                    x_center = detection["x_center"]
                    y_center = detection["y_center"]
                    confidence = detection["confidence"]
                    tracking_id = detection["tracking_id"]

                    y_norm = 0.0 if frame_height <= 0 else min(1.0, max(0.0, y_center / frame_height))
                    first_window_y[team_assignment].append(y_norm)
                    if second_index < FORMATION_SAMPLE_SECONDS:
                        team_bucket = first_window_defensive_sets[team_assignment]
                        if second_index not in team_bucket:
                            team_bucket[second_index] = set()
                        if y_norm <= 0.2:
                            team_bucket[second_index].add(tracking_id)

                    if (
                        not formation_emitted
                        and second_index >= FORMATION_SAMPLE_SECONDS
                        and len(first_window_y["home"]) >= 20
                        and len(first_window_y["away"]) >= 20
                    ):
                        for team in ("home", "away"):
                            team_avg = float(np.mean(first_window_y[team]))
                            team_orientation_inverted[team] = team_avg > 0.5
                            oriented = [oriented_y(team, y) for y in first_window_y[team]]
                            low = float(np.quantile(oriented, 0.33))
                            high = float(np.quantile(oriented, 0.66))
                            team_unit_thresholds[team] = (low, high)

                            second_sets = list(first_window_defensive_sets[team].values())
                            avg_defenders = (
                                float(np.mean([len(item) for item in second_sets]))
                                if second_sets
                                else 0.0
                            )
                            if avg_defenders >= 3.5:
                                batch.append(
                                    {
                                        "match_id": match_id,
                                        "timestamp_seconds": float(FORMATION_SAMPLE_SECONDS),
                                        "player_actor": "system",
                                        "x_coord": 0,
                                        "y_coord": 0,
                                        "insight_text": (
                                            f"{team.title()} shape identified as 4-back from opening phase."
                                        ),
                                        "tas_score": 80,
                                        "event_type": "unit_formed",
                                        "team_assignment": team,
                                        "unit_type": "RearGuard",
                                    }
                                )

                        formation_emitted = True

                    role_name, unit_type = infer_unit(team_assignment, y_norm)
                    actor_prefix = "Home" if team_assignment == "home" else "Away"
                    player_actor = f"{actor_prefix}_{role_name}_{tracking_id}"

                    batch.append(
                        {
                            "match_id": match_id,
                            "timestamp_seconds": timestamp_seconds,
                            "player_actor": player_actor,
                            "x_coord": x_center,
                            "y_coord": y_center,
                            "insight_text": (
                                f"Frame {frame_id}: {player_actor} at ({x_center:.1f}, {y_center:.1f}), "
                                f"conf {confidence:.2f}"
                            ),
                            "tas_score": round(50 + 50 * confidence, 2),
                            "event_type": "player_tracking",
                            "team_assignment": team_assignment,
                            "player_tracking_id": str(tracking_id),
                            "unit_type": unit_type,
                        }
                    )

                    second_defender_samples[team_assignment][tracking_id] = {
                        "x": x_center,
                        "y": y_center,
                        "actor": player_actor,
                        "role": role_name,
                        "unit_type": unit_type,
                        "track_id": str(tracking_id),
                    }

                    snapshot_team_counts[team_assignment] += 1

                    snapshot_confidences.append(confidence)
                    snapshot_x.append(x_center)
                    snapshot_y.append(y_center)

                if frame_id > 0 and frame_id % snapshot_interval_frames == 0 and snapshot_confidences:
                    avg_conf = sum(snapshot_confidences) / len(snapshot_confidences)
                    avg_x = sum(snapshot_x) / len(snapshot_x)
                    avg_y = sum(snapshot_y) / len(snapshot_y)
                    snapshot_tas = round(50 + 50 * avg_conf, 2)
                    snapshot_time = round(frame_id * frame_seconds, 3)

                    batch.append(
                        {
                            "match_id": match_id,
                            "timestamp_seconds": snapshot_time,
                            "player_actor": "system",
                            "x_coord": round(avg_x, 3),
                            "y_coord": round(avg_y, 3),
                            "insight_text": (
                                f"Snapshot at {snapshot_time}s: avg conf {avg_conf:.2f} across "
                                f"{len(snapshot_confidences)} tracked detections."
                            ),
                            "tas_score": snapshot_tas,
                            "event_type": "sync_snapshot",
                        }
                    )

                    if (
                        previous_snapshot_tas is not None
                        and previous_snapshot_tas - snapshot_tas >= ANOMALY_DROP_THRESHOLD
                    ):
                        batch.append(
                            {
                                "match_id": match_id,
                                "timestamp_seconds": snapshot_time,
                                "player_actor": "system",
                                "x_coord": round(avg_x, 3),
                                "y_coord": round(avg_y, 3),
                                "insight_text": (
                                    f"Anomaly flag at {snapshot_time}s: TAS dropped from "
                                    f"{previous_snapshot_tas:.2f} to {snapshot_tas:.2f}."
                                ),
                                "tas_score": snapshot_tas,
                                "event_type": "anomaly_flag",
                            }
                        )

                    batch.append(
                        {
                            "match_id": match_id,
                            "timestamp_seconds": snapshot_time,
                            "player_actor": "system",
                            "x_coord": round(avg_x, 3),
                            "y_coord": round(avg_y, 3),
                            "insight_text": (
                                "Colour clustering update: "
                                f"home detections={snapshot_team_counts['home']}, "
                                f"away detections={snapshot_team_counts['away']}."
                            ),
                            "tas_score": snapshot_tas,
                            "event_type": "color_cluster",
                        }
                    )

                    previous_snapshot_tas = snapshot_tas
                    snapshot_confidences.clear()
                    snapshot_x.clear()
                    snapshot_y.clear()
                    snapshot_team_counts = {"home": 0, "away": 0}

                    if len(batch) >= BATCH_SIZE:
                        flush_batch()

            if current_second is not None:
                flush_second_dislocation(current_second)

            # flush remaining events
            flush_batch()

            if person_detections_total == 0:
                no_detection_summary = normalize_event_for_db(
                    {
                        "match_id": match_id,
                        "timestamp_seconds": -1,
                        "player_actor": "system",
                        "x_coord": 0.0,
                        "y_coord": 0.0,
                        "insight_text": "Analysis stopped: no person detections were found in this video. Check camera angle, resolution, or source quality.",
                        "tas_score": 0.0,
                        "event_type": "summary",
                    }
                )
                total_events += insert_with_schema_fallback([no_detection_summary])
                update_match_status(
                    "failed",
                    started_at=run_started_at,
                    completed_at=iso_now(),
                    error_message="No person detections found in video",
                )
                return {
                    "message": "analysis finished with no person detections",
                    "events_written": total_events,
                    "status": "failed",
                }

            # Run resilience analysis if coach marked manual goal events.
            analyse_manual_goal_recovery()

            # summary marker
            supabase.table("tactical_events").insert(
                normalize_event_for_db(
                    {
                    "match_id": match_id,
                    "timestamp_seconds": -1,
                    "player_actor": "system",
                    "x_coord": 0.0,
                    "y_coord": 0.0,
                    "insight_text": "Analysis complete. Defence lines and midfield synchronisation insights recorded.",
                    "tas_score": 0.0,
                    "event_type": "summary",
                    }
                )
            ).execute()
            total_events += 1

        if not preflight_only:
            update_match_status(
                "completed",
                started_at=run_started_at,
                completed_at=iso_now(),
                error_message=None,
            )
        return {"message": "analysis complete", "events_written": total_events}
    except Exception as exc:
        if not preflight_only:
            update_match_status(
                "failed",
                started_at=run_started_at,
                completed_at=iso_now(),
                error_message=str(exc)[:500],
            )
        raise
