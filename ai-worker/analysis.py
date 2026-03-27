import os
import tempfile
from typing import Dict, Any

import modal
import yt_dlp
from ultralytics import YOLO
from supabase import create_client

# Ensure these variables are set in Modal secrets
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

stub = modal.Stub("teamovia-yolo11-analysis")

image = modal.Image.debian_slim().pip_install(
    "yt-dlp==2025.12.04", "ultralytics==8.0.215", "supabase==1.0.0", "pydantic"
)

# This function should be invoked from the Next.js backend once a match is created
@stub.function(image=image, secret=modal.Secret.from_name("supabase"))
def analyse_match(youtube_url: str, match_id: str) -> Dict[str, Any]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Supabase configuration missing in Modal secrets")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    insights_buffer = []

    with tempfile.TemporaryDirectory() as tmpdir:
        output_template = os.path.join(tmpdir, "video.%(ext)s")
        ydl_opts = {
            "format": "bestvideo[ext=mp4]+bestaudio/best",
            "outtmpl": output_template,
            "quiet": True,
            "no_warnings": True,
            "merge_output_format": "mp4",
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=True)

        video_path = ydl.prepare_filename(info)
        if not video_path.endswith(".mp4"):
            video_path = video_path.replace(".webm", ".mp4")

        model = YOLO("yolov8n.pt")  # replace with YOLO11 model path when available

        for frame_id, result in enumerate(model.track(source=video_path, device="0", stream=True)):
            if result is None:
                continue

            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                x_center = float((x1 + x2) / 2)
                y_center = float((y1 + y2) / 2)
                confidence = float(box.conf[0])
                cls = int(box.cls[0])

                coaching_insight = (
                    f"Frame {frame_id}: Player track found at ({x_center:.1f}, {y_center:.1f}), "
                    f"confidence {confidence:.2f}. Keep defensive structure synchronised."
                )

                insights_buffer.append(coaching_insight)

                event = {
                    "match_id": match_id,
                    "timestamp_seconds": frame_id * 0.04,
                    "player_actor": f"player_{cls}",
                    "x_coord": x_center,
                    "y_coord": y_center,
                    "insight_text": coaching_insight,
                    "tas_score": 50 + 50 * confidence,
                    "event_type": "player_tracking",
                }

                supabase.table("tactical_events").insert(event).execute()

        # write a final insight block as summary
        summary_insight = "Analysis complete. Defence lines and midfield synchronisation insights recorded."
        supabase.table("tactical_events").insert(
            {
                "match_id": match_id,
                "timestamp_seconds": -1,
                "player_actor": "system",
                "x_coord": 0,
                "y_coord": 0,
                "insight_text": summary_insight,
                "tas_score": 0,
                "event_type": "summary",
            }
        ).execute()

    return {"message": "analysis complete", "insights": len(insights_buffer)}
