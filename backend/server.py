from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks, Request
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from bson import ObjectId
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta, timezone
import base64
import io
import json
import subprocess
import tempfile
from openai import OpenAI
import resend
import random

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# GridFS for video storage
fs_bucket = AsyncIOMotorGridFSBucket(db)

# OpenAI client - use direct OpenAI API key
openai_api_key = os.environ.get('OPENAI_API_KEY', '')
openai_client = OpenAI(api_key=openai_api_key) if openai_api_key else None

# Whisper client is same as main client now
whisper_client = openai_client

# Resend API configuration for OTP emails
resend_api_key = os.environ.get('RESEND_API_KEY', '')
if resend_api_key:
    resend.api_key = resend_api_key
otp_from_email = os.environ.get('OTP_FROM_EMAIL', 'onboarding@resend.dev')

# Create the main app
app = FastAPI(title="XoW Expo Recording System")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class DeviceCreate(BaseModel):
    device_id: str
    password: str
    name: str

class DeviceLogin(BaseModel):
    device_id: str
    password: str

class RecordingCreate(BaseModel):
    device_id: str
    expo_name: str
    booth_name: str
    start_time: Optional[str] = None  # ISO timestamp from device (actual recording time)
    duration: Optional[float] = None  # Actual recording duration in seconds from device

class BarcodeCreate(BaseModel):
    recording_id: str
    barcode_data: str
    video_timestamp: Optional[float] = None
    frame_code: Optional[int] = None

# Visitor Badge Model
class VisitorBadge(BaseModel):
    badge_id: str
    recording_id: str
    visitor_label: str  # Barcode or auto-generated
    start_time: float  # Seconds from start
    end_time: float
    summary: str  # AI-generated summary of conversation
    topics: List[str]
    questions_asked: List[str]
    sentiment: str
    key_points: List[str]
    is_barcode_linked: bool = False

# Helper function to serialize MongoDB documents
def serialize_value(value):
    """Recursively serialize MongoDB types to JSON-compatible types"""
    if isinstance(value, ObjectId):
        return str(value)
    elif isinstance(value, datetime):
        # Append 'Z' to mark as UTC — without it, JavaScript treats the string
        # as local time, causing the displayed time to be off by the UTC offset
        return value.isoformat() + 'Z'
    elif isinstance(value, dict):
        return {k: serialize_value(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [serialize_value(item) for item in value]
    return value

def serialize_doc(doc):
    if doc is None:
        return None
    result = {}
    for key, value in doc.items():
        if key == '_id':
            result['id'] = str(value)
        else:
            result[key] = serialize_value(value)
    return result

# Extract frames from video for head count detection
async def extract_video_frames(video_data: bytes, video_format: str = "mp4", num_frames: int = 5) -> list:
    """Extract frames from video at regular intervals for AI analysis"""
    try:
        with tempfile.NamedTemporaryFile(suffix=f'.{video_format}', delete=False) as video_file:
            video_file.write(video_data)
            video_path = video_file.name
        
        # Get video duration
        probe_cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video_path]
        probe_result = subprocess.run(probe_cmd, capture_output=True, timeout=30)
        duration = float(probe_result.stdout.decode().strip()) if probe_result.returncode == 0 else 10.0
        
        frames = []
        frame_dir = tempfile.mkdtemp()
        
        # Extract frames at regular intervals
        interval = max(duration / (num_frames + 1), 1)
        for i in range(num_frames):
            timestamp = interval * (i + 1)
            frame_path = os.path.join(frame_dir, f'frame_{i}.jpg')
            
            cmd = [
                'ffmpeg', '-ss', str(timestamp), '-i', video_path,
                '-frames:v', '1', '-q:v', '2', '-y', frame_path
            ]
            subprocess.run(cmd, capture_output=True, timeout=30)
            
            if os.path.exists(frame_path):
                with open(frame_path, 'rb') as f:
                    frame_data = base64.b64encode(f.read()).decode('utf-8')
                    frames.append({
                        'timestamp': timestamp,
                        'data': frame_data
                    })
                os.unlink(frame_path)
        
        # Cleanup
        os.unlink(video_path)
        os.rmdir(frame_dir)
        
        logger.info(f"Extracted {len(frames)} frames from video for head count")
        return frames
    except Exception as e:
        logger.error(f"Frame extraction failed: {e}")
        return []

async def detect_head_count_from_frames(frames: list) -> dict:
    """Use OpenAI Vision to detect and count people in video frames"""
    if not openai_client or not frames:
        return {"max_count": 0, "avg_count": 0, "detections": []}
    
    try:
        detections = []
        
        for frame in frames:
            try:
                response = openai_client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "Count the number of people visible in this image. Only count human faces/heads you can clearly see. Respond with ONLY a JSON object in this exact format: {\"count\": NUMBER, \"confidence\": \"high\"|\"medium\"|\"low\"}. Do not include any other text."
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{frame['data']}",
                                        "detail": "low"
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens=100
                )
                
                result_text = response.choices[0].message.content.strip()
                # Parse the JSON response
                try:
                    result = json.loads(result_text)
                    count = int(result.get('count', 0))
                    confidence = result.get('confidence', 'low')
                except:
                    # Try to extract number from text
                    import re
                    numbers = re.findall(r'\d+', result_text)
                    count = int(numbers[0]) if numbers else 0
                    confidence = 'low'
                
                detections.append({
                    'timestamp': frame['timestamp'],
                    'count': count,
                    'confidence': confidence
                })
                
            except Exception as e:
                logger.warning(f"Head count detection error for frame: {e}")
                detections.append({
                    'timestamp': frame['timestamp'],
                    'count': 0,
                    'confidence': 'error'
                })
        
        # Calculate statistics
        counts = [d['count'] for d in detections if d['confidence'] != 'error']
        max_count = max(counts) if counts else 0
        avg_count = sum(counts) / len(counts) if counts else 0
        
        logger.info(f"Head count detection: max={max_count}, avg={avg_count:.1f}")
        
        return {
            "max_count": max_count,
            "avg_count": round(avg_count, 1),
            "detections": detections
        }
    except Exception as e:
        logger.error(f"Head count detection failed: {e}")
        return {"max_count": 0, "avg_count": 0, "detections": []}

async def extract_visitor_frames_at_interval(video_path: str, interval_seconds: int = 60) -> list:
    """Extract one JPEG frame every interval_seconds from a video file using ffmpeg.
    Falls back to evenly-spaced frames for short videos (< interval_seconds long).
    Returns a list of {timestamp, data} dicts where data is base64-encoded JPEG."""
    frames = []
    frame_dir = None
    try:
        probe_cmd = [
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', video_path
        ]
        probe_result = subprocess.run(probe_cmd, capture_output=True, timeout=60)
        if probe_result.returncode != 0:
            logger.error(f"ffprobe failed for visitor frames: {probe_result.stderr.decode()[:200]}")
            return []

        duration = float(probe_result.stdout.decode().strip() or '0')
        if duration <= 0:
            logger.warning(f"Invalid video duration {duration} for visitor frame extraction")
            return []

        frame_dir = tempfile.mkdtemp()

        # For short videos, space frames evenly; for longer ones, one per minute
        if duration < interval_seconds:
            # Short video: extract up to 5 evenly-spaced frames
            num_frames = min(5, max(1, int(duration)))
            timestamps = [duration * (i + 1) / (num_frames + 1) for i in range(num_frames)]
        else:
            # Extract one frame at t=0, t=60, t=120, ... (cap at 30 frames max)
            timestamps = []
            t = 0.0
            while t < duration and len(timestamps) < 30:
                timestamps.append(t)
                t += interval_seconds

        for idx, ts in enumerate(timestamps):
            frame_path = os.path.join(frame_dir, f'vf_{idx:04d}.jpg')
            cmd = [
                'ffmpeg', '-ss', str(ts), '-i', video_path,
                '-frames:v', '1',
                '-q:v', '2',           # High quality (1=best, 31=worst)
                '-vf', 'scale=960:-1', # Resize width to 960px, keep aspect ratio
                '-y', frame_path
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=60)
            if result.returncode == 0 and os.path.exists(frame_path) and os.path.getsize(frame_path) > 0:
                with open(frame_path, 'rb') as f:
                    frames.append({'timestamp': ts, 'data': base64.b64encode(f.read()).decode('utf-8')})
                os.unlink(frame_path)
            else:
                logger.warning(f"Frame at t={ts:.1f}s could not be extracted: {result.stderr.decode()[:100]}")

        logger.info(f"Extracted {len(frames)} visitor frames from {duration:.1f}s video "
                    f"(interval={interval_seconds}s)")
        return frames

    except Exception as e:
        logger.error(f"extract_visitor_frames_at_interval error: {e}")
        return []
    finally:
        if frame_dir:
            import shutil
            shutil.rmtree(frame_dir, ignore_errors=True)


async def count_unique_visitors_gpt4o(frames: list, recording_id: str = "") -> dict:
    """Send all visitor frames to GPT-4o in one call and count unique individuals.
    Same person in multiple frames is counted only once."""
    if not openai_client:
        logger.warning("OpenAI client not available — skipping unique visitor count")
        return {"unique_visitors": 0, "confidence": "low", "reasoning": "AI not configured"}
    if not frames:
        return {"unique_visitors": 0, "confidence": "low", "reasoning": "No frames available"}

    try:
        image_parts = [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{f['data']}",
                    "detail": "high"   # High detail for better face/clothing recognition
                }
            }
            for f in frames
        ]

        n = len(frames)
        content = [
            {
                "type": "text",
                "text": (
                    f"You are analyzing {n} snapshot(s) captured at 1-minute intervals from an expo "
                    f"booth camera during a recording session.\n\n"
                    f"YOUR TASK: Count the total number of UNIQUE visitors who appeared at this booth.\n\n"
                    f"RULES:\n"
                    f"1. If the SAME person appears in MULTIPLE photos, count them ONLY ONCE.\n"
                    f"2. Use face features, hair, clothing color/style, and body build to identify "
                    f"   whether two people across different frames are the same individual.\n"
                    f"3. Count anyone who is clearly present at or near the booth — standing, talking, "
                    f"   or looking at displays.\n"
                    f"4. Do NOT count booth staff who appear in every frame (they are permanent fixtures).\n"
                    f"5. If you are uncertain whether two people are the same, count them as separate.\n\n"
                    f"Respond with ONLY valid JSON — no markdown, no explanation outside the JSON:\n"
                    f'{{"unique_visitors": <integer>, "confidence": "high"|"medium"|"low", '
                    f'"reasoning": "<one sentence explaining how you identified unique visitors>"}}'
                )
            }
        ] + image_parts

        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": content}],
            max_tokens=300
        )

        result_text = response.choices[0].message.content.strip()
        logger.info(f"GPT-4o visitor count raw response for {recording_id}: {result_text[:300]}")

        import re
        try:
            json_match = re.search(r'\{.*\}', result_text, re.DOTALL)
            result = json.loads(json_match.group() if json_match else result_text)
            return {
                "unique_visitors": max(0, int(result.get("unique_visitors", 0))),
                "confidence": result.get("confidence", "medium"),
                "reasoning": result.get("reasoning", ""),
            }
        except Exception:
            numbers = re.findall(r'\d+', result_text)
            return {
                "unique_visitors": int(numbers[0]) if numbers else 0,
                "confidence": "low",
                "reasoning": result_text[:150],
            }

    except Exception as e:
        logger.error(f"count_unique_visitors_gpt4o error for {recording_id}: {e}")
        return {"unique_visitors": 0, "confidence": "low", "reasoning": str(e)}


# Extract audio from video using ffmpeg
async def extract_audio_from_video(video_data: bytes, video_format: str = "mp4") -> bytes:
    """Extract audio track from video file using ffmpeg"""
    try:
        with tempfile.NamedTemporaryFile(suffix=f'.{video_format}', delete=False) as video_file:
            video_file.write(video_data)
            video_path = video_file.name
        
        audio_path = video_path.replace(f'.{video_format}', '.m4a')
        
        # Use ffmpeg to extract audio
        cmd = [
            'ffmpeg', '-i', video_path,
            '-vn',  # No video
            '-acodec', 'aac',  # AAC audio codec
            '-b:a', '128k',  # Audio bitrate
            '-y',  # Overwrite output
            audio_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, timeout=300)
        
        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr.decode()}")
            return None
        
        with open(audio_path, 'rb') as f:
            audio_data = f.read()
        
        # Cleanup temp files
        os.unlink(video_path)
        os.unlink(audio_path)
        
        logger.info(f"Successfully extracted audio from video ({len(audio_data)} bytes)")
        return audio_data
    except Exception as e:
        logger.error(f"Audio extraction failed: {e}")
        return None

async def remux_video_for_streaming(video_data: bytes, video_format: str = "mp4") -> bytes:
    """Re-mux video with faststart flag for web streaming (enables seeking)"""
    try:
        with tempfile.NamedTemporaryFile(suffix=f'.{video_format}', delete=False) as input_file:
            input_file.write(video_data)
            input_path = input_file.name
        
        output_path = input_path.replace(f'.{video_format}', f'_remux.{video_format}')
        
        # Re-mux with faststart flag for web streaming compatibility
        cmd = [
            'ffmpeg', '-i', input_path,
            '-c', 'copy',  # Copy streams without re-encoding (fast)
            '-movflags', '+faststart',  # Enable seeking in web browsers
            '-y',  # Overwrite output
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, timeout=300)
        
        if result.returncode != 0:
            logger.warning(f"FFmpeg remux warning: {result.stderr.decode()}")
            # Return original data if remuxing fails
            os.unlink(input_path)
            return video_data
        
        with open(output_path, 'rb') as f:
            remuxed_data = f.read()
        
        # Cleanup temp files
        os.unlink(input_path)
        os.unlink(output_path)
        
        logger.info(f"Successfully remuxed video for streaming ({len(remuxed_data)} bytes)")
        return remuxed_data
    except Exception as e:
        logger.error(f"Video remux failed: {e}")
        return video_data  # Return original on error

async def add_video_overlay(video_data: bytes, video_format: str = "mp4", 
                           booth_name: str = "XoW Booth", 
                           recording_time: str = None) -> bytes:
    """Add clean, non-overlapping watermark overlay to video"""
    try:
        with tempfile.NamedTemporaryFile(suffix=f'.{video_format}', delete=False) as input_file:
            input_file.write(video_data)
            input_path = input_file.name
        
        output_path = input_path.replace(f'.{video_format}', f'_overlay.{video_format}')
        
        # Get recording timestamp
        if not recording_time:
            recording_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Parse date and time
        try:
            dt = datetime.strptime(recording_time, "%Y-%m-%d %H:%M:%S")
            date_str = dt.strftime("%Y-%m-%d")
            time_str = dt.strftime("%H\\:%M\\:%S")
        except:
            date_str = recording_time[:10] if len(recording_time) >= 10 else recording_time
            time_str = recording_time[11:19].replace(":", "\\:") if len(recording_time) >= 19 else "00\\:00\\:00"
        
        # Escape special characters for FFmpeg drawtext
        safe_booth = booth_name.replace("'", "").replace(":", " ").replace("\\", "").replace('"', "")
        # Truncate long booth names
        if len(safe_booth) > 25:
            safe_booth = safe_booth[:22] + "..."
        
        # Use DejaVu Sans font
        font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if not os.path.exists(font_path):
            font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        if not os.path.exists(font_path):
            font_path = ""
        
        font_opt = f":fontfile={font_path}" if font_path else ""
        
        # Clean, minimal overlay design - corners only, no overlap
        filter_parts = [
            # === TOP-LEFT: Timestamp Info (compact) ===
            f"drawbox=x=15:y=15:w=180:h=70:color=black@0.6:t=fill",
            f"drawtext=text='{date_str}':fontsize=14:fontcolor=white:x=25:y=25{font_opt}",
            f"drawtext=text='{time_str}':fontsize=14:fontcolor=0x10B981:x=25:y=45{font_opt}",
            f"drawtext=text='%{{pts\\:hms}}':fontsize=14:fontcolor=0xEF4444:x=115:y=45{font_opt}",
            f"drawtext=text='REC':fontsize=12:fontcolor=0xEF4444:x=145:y=25:box=1:boxcolor=0xEF4444@0.3:boxborderw=3{font_opt}",
            
            # === TOP-RIGHT: Frame Counter (compact) ===
            f"drawbox=x=w-100:y=15:w=85:h=30:color=black@0.6:t=fill",
            f"drawtext=text='F\\: %{{frame_num}}':start_number=1:fontsize=12:fontcolor=0xFBBF24:x=w-92:y=22{font_opt}",
            
            # === BOTTOM-LEFT: Booth Name (compact) ===
            f"drawtext=text='{safe_booth}':fontsize=14:fontcolor=white:x=15:y=h-30:box=1:boxcolor=black@0.6:boxborderw=6{font_opt}",
            
            # === BOTTOM-RIGHT: XoW Logo (orange/red theme) ===
            f"drawbox=x=w-55:y=h-35:w=45:h=25:color=0xE54B2A@0.9:t=fill",
            f"drawtext=text='XoW':fontsize=14:fontcolor=white:x=w-50:y=h-31{font_opt}",
        ]
        filter_complex = ','.join(filter_parts)
        
        cmd = [
            'ffmpeg', '-i', input_path,
            '-vf', filter_complex,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-y',
            output_path
        ]
        
        logger.info(f"Running FFmpeg overlay command: booth={safe_booth}, font={font_path}")
        logger.info(f"FFmpeg command: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, timeout=600)
        
        if result.returncode != 0:
            error_msg = result.stderr.decode()[:2000]
            logger.error(f"FFmpeg overlay failed (exit code {result.returncode}): {error_msg}")
            # Clean up input file
            try:
                os.unlink(input_path)
            except:
                pass
            return video_data
        
        # Check if output file exists and has content
        if not os.path.exists(output_path):
            logger.error("FFmpeg overlay: output file not created")
            try:
                os.unlink(input_path)
            except:
                pass
            return video_data
            
        output_size = os.path.getsize(output_path)
        if output_size == 0:
            logger.error("FFmpeg overlay: output file is empty")
            try:
                os.unlink(input_path)
                os.unlink(output_path)
            except:
                pass
            return video_data
        
        with open(output_path, 'rb') as f:
            overlay_data = f.read()
        
        # Clean up temp files
        try:
            os.unlink(input_path)
            os.unlink(output_path)
        except:
            pass
        
        logger.info(f"Video overlay applied successfully: input={len(video_data)} bytes, output={len(overlay_data)} bytes")
        return overlay_data
    except subprocess.TimeoutExpired:
        logger.error("FFmpeg overlay timed out after 600 seconds")
        return video_data
    except Exception as e:
        logger.error(f"Video overlay exception: {type(e).__name__}: {e}")
        return video_data


# ==================== FILE-PATH BASED HELPERS (no in-memory video loading) ====================

async def add_video_overlay_file(input_path: str, video_format: str = "mp4",
                                  booth_name: str = "XoW Booth",
                                  recording_time: str = None) -> str:
    """Add overlay using file paths — avoids loading full video into memory. Returns output path."""
    output_path = input_path + f'_overlay.{video_format}'
    try:
        if not recording_time:
            recording_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            dt = datetime.strptime(recording_time, "%Y-%m-%d %H:%M:%S")
            date_str = dt.strftime("%Y-%m-%d")
            time_str = dt.strftime("%H\\:%M\\:%S")
        except Exception:
            date_str = recording_time[:10] if len(recording_time) >= 10 else recording_time
            time_str = recording_time[11:19].replace(":", "\\:") if len(recording_time) >= 19 else "00\\:00\\:00"

        safe_booth = booth_name.replace("'", "").replace(":", " ").replace("\\", "").replace('"', "")
        if len(safe_booth) > 25:
            safe_booth = safe_booth[:22] + "..."

        font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if not os.path.exists(font_path):
            font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        if not os.path.exists(font_path):
            font_path = ""
        font_opt = f":fontfile={font_path}" if font_path else ""

        filter_parts = [
            f"drawbox=x=15:y=15:w=180:h=70:color=black@0.6:t=fill",
            f"drawtext=text='{date_str}':fontsize=14:fontcolor=white:x=25:y=25{font_opt}",
            f"drawtext=text='{time_str}':fontsize=14:fontcolor=0x10B981:x=25:y=45{font_opt}",
            f"drawtext=text='%{{pts\\:hms}}':fontsize=14:fontcolor=0xEF4444:x=115:y=45{font_opt}",
            f"drawtext=text='REC':fontsize=12:fontcolor=0xEF4444:x=145:y=25:box=1:boxcolor=0xEF4444@0.3:boxborderw=3{font_opt}",
            f"drawbox=x=w-100:y=15:w=85:h=30:color=black@0.6:t=fill",
            f"drawtext=text='F\\: %{{frame_num}}':start_number=1:fontsize=12:fontcolor=0xFBBF24:x=w-92:y=22{font_opt}",
            f"drawtext=text='{safe_booth}':fontsize=14:fontcolor=white:x=15:y=h-30:box=1:boxcolor=black@0.6:boxborderw=6{font_opt}",
            f"drawbox=x=w-55:y=h-35:w=45:h=25:color=0xE54B2A@0.9:t=fill",
            f"drawtext=text='XoW':fontsize=14:fontcolor=white:x=w-50:y=h-31{font_opt}",
        ]
        filter_complex = ','.join(filter_parts)
        cmd = [
            'ffmpeg', '-i', input_path, '-vf', filter_complex,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
            '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
            '-y', output_path
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=86400)  # 24h for very long videos
        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            logger.error(f"FFmpeg overlay (file) failed: {result.stderr.decode()[:500]}")
            return input_path  # fall back to input on failure
        logger.info(f"File overlay applied: {os.path.getsize(output_path)} bytes")
        return output_path
    except Exception as e:
        logger.error(f"Overlay file exception: {e}")
        return input_path


async def remux_video_for_streaming_file(input_path: str, video_format: str = "mp4") -> str:
    """Remux for web streaming using file paths. Returns output path."""
    output_path = input_path + f'_remux.{video_format}'
    try:
        cmd = ['ffmpeg', '-i', input_path, '-c', 'copy', '-movflags', '+faststart', '-y', output_path]
        result = subprocess.run(cmd, capture_output=True, timeout=43200)  # 12h
        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            logger.warning(f"Remux (file) failed, using input: {result.stderr.decode()[:200]}")
            return input_path
        logger.info(f"File remux done: {os.path.getsize(output_path)} bytes")
        return output_path
    except Exception as e:
        logger.error(f"Remux file exception: {e}")
        return input_path


async def extract_video_frames_file(video_path: str, video_format: str = "mp4", num_frames: int = 5) -> list:
    """Extract frames from a video file path for AI analysis — no in-memory video load."""
    try:
        probe_cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                     '-of', 'default=noprint_wrappers=1:nokey=1', video_path]
        probe_result = subprocess.run(probe_cmd, capture_output=True, timeout=60)
        duration = float(probe_result.stdout.decode().strip()) if probe_result.returncode == 0 else 10.0
        frames = []
        frame_dir = tempfile.mkdtemp()
        interval = max(duration / (num_frames + 1), 1)
        for i in range(num_frames):
            timestamp = interval * (i + 1)
            frame_path = os.path.join(frame_dir, f'frame_{i}.jpg')
            cmd = ['ffmpeg', '-ss', str(timestamp), '-i', video_path,
                   '-frames:v', '1', '-q:v', '2', '-y', frame_path]
            subprocess.run(cmd, capture_output=True, timeout=60)
            if os.path.exists(frame_path):
                with open(frame_path, 'rb') as f:
                    frames.append({'timestamp': timestamp, 'data': base64.b64encode(f.read()).decode('utf-8')})
                os.unlink(frame_path)
        os.rmdir(frame_dir)
        logger.info(f"Extracted {len(frames)} frames from file for head count")
        return frames
    except Exception as e:
        logger.error(f"Frame extraction from file failed: {e}")
        return []


async def process_video_audio_file(recording_id: str, video_path: str, video_format: str):
    """Extract audio from video file path and run transcription — no in-memory video load."""
    audio_path = video_path + '.extracted.m4a'
    try:
        logger.info(f"Extracting audio from video file for recording {recording_id}")
        cmd = ['ffmpeg', '-i', video_path, '-vn', '-acodec', 'aac', '-b:a', '128k', '-y', audio_path]
        result = subprocess.run(cmd, capture_output=True, timeout=43200)  # 12h
        if result.returncode != 0:
            logger.error(f"Audio extract (file) failed: {result.stderr.decode()[:500]}")
            await db.recordings.update_one(
                {"_id": ObjectId(recording_id)},
                {"$set": {"status": "uploaded", "error": "Audio extraction failed"}}
            )
            return
        with open(audio_path, 'rb') as f:
            audio_data = f.read()
        if audio_data:
            audio_id = await fs_bucket.upload_from_stream(
                f"audio_{recording_id}.m4a", io.BytesIO(audio_data),
                metadata={"recording_id": recording_id, "type": "audio", "extracted_from_video": True}
            )
            await db.recordings.update_one(
                {"_id": ObjectId(recording_id)},
                {"$set": {"audio_file_id": str(audio_id), "has_audio": True}}
            )
            await process_transcription_with_diarization(recording_id)
            logger.info(f"Audio extracted and transcription started for {recording_id}")
        else:
            logger.error(f"Empty audio for {recording_id}")
    except Exception as e:
        logger.error(f"process_video_audio_file error for {recording_id}: {e}")
    finally:
        if os.path.exists(audio_path):
            try:
                os.unlink(audio_path)
            except Exception:
                pass


async def _run_video_pipeline(recording_id: str, video_path: str,
                               raw_video_id_to_delete: str, ext: str, mime: str, recording: dict):
    """Core pipeline: overlay → remux → upload to GridFS → head count → audio. File-path based."""
    overlay_path = None
    remux_path = None
    try:
        booth_name = recording.get('booth_name', 'XoW Booth')
        utc_start = recording.get('start_time')
        if isinstance(utc_start, datetime):
            local_dt = utc_start.replace(tzinfo=timezone.utc).astimezone(tz=None)
            recording_time = local_dt.strftime("%Y-%m-%d %H:%M:%S")
        else:
            recording_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        logger.info(f"Adding video overlay for recording {recording_id}")
        overlay_path = await add_video_overlay_file(video_path, ext, booth_name, recording_time)

        logger.info(f"Remuxing video for recording {recording_id}")
        remux_path = await remux_video_for_streaming_file(overlay_path, ext)

        # Delete old raw GridFS entry if provided
        if raw_video_id_to_delete:
            try:
                await fs_bucket.delete(ObjectId(raw_video_id_to_delete))
            except Exception as del_err:
                logger.warning(f"Could not delete raw video {raw_video_id_to_delete}: {del_err}")

        # Stream processed video into GridFS — no full read into memory
        with open(remux_path, 'rb') as f:
            processed_video_id = await fs_bucket.upload_from_stream(
                f"video_{recording_id}.{ext}", f,
                metadata={"recording_id": recording_id, "type": "video", "mime_type": mime}
            )

        # Mark video as stored first so the recording is accessible even if AI counting is slow
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {"video_file_id": str(processed_video_id)}}
        )

        # Extract frames at 60-second intervals from the uploaded video using ffmpeg
        logger.info(f"Extracting visitor frames at 60s intervals for recording {recording_id}")
        visitor_frames = await extract_visitor_frames_at_interval(video_path, interval_seconds=60)

        # Count unique visitors using GPT-4o (all frames in one call, deduplication by face/clothing)
        logger.info(f"Counting unique visitors across {len(visitor_frames)} frames for recording {recording_id}")
        visitor_result = await count_unique_visitors_gpt4o(visitor_frames, recording_id)

        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {
                "head_count": visitor_result.get("unique_visitors", 0),
                "visitor_count_confidence": visitor_result.get("confidence", "low"),
                "visitor_count_reasoning": visitor_result.get("reasoning", ""),
                "visitor_frame_count": len(visitor_frames),
            }}
        )
        logger.info(
            f"Visitor count for recording {recording_id}: "
            f"{visitor_result.get('unique_visitors', 0)} unique visitors "
            f"(confidence={visitor_result.get('confidence')}, frames={len(visitor_frames)})"
        )

        logger.info(f"Video processing complete for recording {recording_id}, starting audio extraction")
        await process_video_audio_file(recording_id, video_path, ext)

    finally:
        # Clean up overlay/remux temp files (caller owns video_path)
        for p in [overlay_path, remux_path]:
            if p and p != video_path and os.path.exists(p):
                try:
                    os.unlink(p)
                except Exception:
                    pass


async def merge_chunks_and_process(recording_id: str, chunk_refs: list, ext: str, mime: str):
    """Stream GridFS video chunks into a temp file, then run the processing pipeline."""
    tmp_path = None
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            return

        # Stream all chunks → single temp file (no full memory load)
        with tempfile.NamedTemporaryFile(suffix=f'.{ext}', delete=False) as tmp_file:
            tmp_path = tmp_file.name
            for ref in chunk_refs:
                grid_out = await fs_bucket.open_download_stream(ObjectId(ref['gridfs_id']))
                while True:
                    block = await grid_out.read(1024 * 1024)  # 1MB at a time
                    if not block:
                        break
                    tmp_file.write(block)

        logger.info(f"Merged {len(chunk_refs)} chunks for recording {recording_id}: "
                    f"{os.path.getsize(tmp_path)} bytes")

        # Clean up GridFS chunks and refs
        for ref in chunk_refs:
            try:
                await fs_bucket.delete(ObjectId(ref['gridfs_id']))
            except Exception as e:
                logger.warning(f"Could not delete chunk {ref['gridfs_id']}: {e}")
        await db.video_chunk_refs.delete_many({"recording_id": recording_id})

        await _run_video_pipeline(recording_id, tmp_path, None, ext, mime, recording)

    except Exception as e:
        logger.error(f"Chunk merge error for {recording_id}: {e}")
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {"status": "error", "error": str(e)}}
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


# ==================== HEALTH CHECK ====================

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# ==================== PAIRING CODE HELPERS ====================

import random as _random

PAIRING_CODE_TTL_MINUTES = 5

def _make_pairing_code() -> str:
    """Generate a random 6-digit pairing code."""
    return ''.join([str(_random.randint(0, 9)) for _ in range(6)])

async def _next_booth_name() -> str:
    """Return the next unique Booth-XX name by finding the highest existing number."""
    import re
    devices = await db.devices.find(
        {"name": {"$regex": r"^Booth-\d+$"}},
        {"name": 1}
    ).to_list(None)
    numbers = []
    for d in devices:
        m = re.match(r"^Booth-(\d+)$", d.get("name", ""))
        if m:
            numbers.append(int(m.group(1)))
    next_num = (max(numbers) + 1) if numbers else 1
    return f"Booth-{next_num:02d}"

async def _refresh_pairing_code(device_id: str) -> dict:
    """Generate a new pairing code for a device and persist it. Returns {pairing_code, expires_at}."""
    code = _make_pairing_code()
    expires_at = datetime.utcnow() + timedelta(minutes=PAIRING_CODE_TTL_MINUTES)
    await db.devices.update_one(
        {"device_id": device_id},
        {"$set": {"pairing_code": code, "pairing_expires_at": expires_at}}
    )
    return {"pairing_code": code, "pairing_expires_at": expires_at}

async def get_session_device_ids(session_id: str) -> Optional[list]:
    """Return the list of device_ids linked to a dashboard session, or None if session missing."""
    if not session_id:
        return None
    session = await db.dashboard_sessions.find_one({"session_id": session_id})
    if not session:
        return None
    return session.get("device_ids", [])

async def get_linked_device_ids(user_id: str) -> list:
    """Return device_ids linked to a legacy dashboard user account."""
    try:
        user = await db.dashboard_users.find_one({"_id": ObjectId(user_id)})
        return user.get("devices", []) if user else []
    except Exception:
        return []

# ==================== AUTH ENDPOINTS (Mobile App) ====================

@api_router.post("/auth/register")
async def register_device(device: DeviceCreate):
    """Register a new device and generate its first pairing code."""
    existing = await db.devices.find_one({"device_id": device.device_id})
    if existing:
        raise HTTPException(status_code=400, detail="Device ID already registered")

    # Auto-assign the next unique sequential booth name
    assigned_name = await _next_booth_name()

    code = _make_pairing_code()
    expires_at = datetime.utcnow() + timedelta(minutes=PAIRING_CODE_TTL_MINUTES)
    device_doc = {
        "device_id": device.device_id,
        "password": device.password,
        "name": assigned_name,
        "created_at": datetime.utcnow(),
        "is_active": True,
        "pairing_code": code,
        "pairing_expires_at": expires_at,
        "is_paired": False,
        "dashboard_session_id": None,
    }
    result = await db.devices.insert_one(device_doc)
    device_doc['_id'] = result.inserted_id
    return serialize_doc(device_doc)

@api_router.post("/auth/login")
async def login_device(login: DeviceLogin):
    """Login a device. Refreshes pairing code if expired."""
    device = await db.devices.find_one({
        "device_id": login.device_id,
        "password": login.password
    })
    if not device:
        raise HTTPException(status_code=401, detail="Invalid device ID or password")

    # Ensure pairing code exists and is fresh
    expires_at = device.get("pairing_expires_at")
    if not expires_at or expires_at < datetime.utcnow() or not device.get("pairing_code"):
        code_info = await _refresh_pairing_code(login.device_id)
        device["pairing_code"] = code_info["pairing_code"]
        device["pairing_expires_at"] = code_info["pairing_expires_at"]

    return {
        "success": True,
        "device": serialize_doc(device),
        "message": "Login successful"
    }

@api_router.get("/devices/{device_id}/pairing-code")
async def get_pairing_code(device_id: str, password: str):
    """Return the current pairing code for a device, refreshing it if expired."""
    device = await db.devices.find_one({"device_id": device_id, "password": password})
    if not device:
        raise HTTPException(status_code=401, detail="Invalid device credentials")

    expires_at = device.get("pairing_expires_at")
    needs_refresh = (not expires_at) or (expires_at < datetime.utcnow()) or not device.get("pairing_code")
    if needs_refresh:
        code_info = await _refresh_pairing_code(device_id)
        pairing_code = code_info["pairing_code"]
        pairing_expires_at = code_info["pairing_expires_at"]
    else:
        pairing_code = device["pairing_code"]
        pairing_expires_at = expires_at

    seconds_left = max(0, int((pairing_expires_at - datetime.utcnow()).total_seconds()))
    return {
        "pairing_code": pairing_code,
        "expires_at": pairing_expires_at.isoformat() + "Z",
        "expires_in_seconds": seconds_left,
        "is_paired": device.get("is_paired", False),
    }

@api_router.post("/devices/{device_id}/remove-pairing")
async def remove_device_pairing(device_id: str, password: str):
    """Mobile app restart — resets pairing state so the device must re-pair.
    Does NOT remove the device from the session's device_ids so that historical
    recordings remain visible in the dashboard."""
    device = await db.devices.find_one({"device_id": device_id, "password": password})
    if not device:
        raise HTTPException(status_code=401, detail="Invalid device credentials")

    # Migrate legacy generic names (e.g. "Expo Booth") to unique sequential booth names
    import re
    current_name = device.get("name", "")
    is_generic = not re.match(r"^Booth-\d+$", current_name)
    if is_generic:
        current_name = await _next_booth_name()
        await db.devices.update_one(
            {"device_id": device_id},
            {"$set": {"name": current_name}}
        )

    # Generate a fresh pairing code
    code_info = await _refresh_pairing_code(device_id)

    # Reset pairing state only — leave session membership intact so recordings
    # uploaded under this device_id stay visible in the dashboard.
    await db.devices.update_one(
        {"device_id": device_id},
        {"$set": {"is_paired": False, "dashboard_session_id": None}}
    )

    return {
        "success": True,
        "new_pairing_code": code_info["pairing_code"],
        "expires_in_seconds": PAIRING_CODE_TTL_MINUTES * 60,
        "name": current_name,
        "message": "Pairing reset. New pairing code generated.",
    }

# ==================== DASHBOARD PAIRING ENDPOINTS ====================

@api_router.post("/dashboard/pair")
async def pair_device(pairing_code: str, session_id: Optional[str] = None):
    """
    Dashboard enters the 6-digit pairing code from the mobile app.
    Validates code, expiry, and availability.
    Returns or creates a dashboard session that the browser stores.
    """
    now = datetime.utcnow()
    device = await db.devices.find_one({"pairing_code": pairing_code})
    if not device:
        raise HTTPException(status_code=404, detail="Invalid pairing code")
    if device.get("pairing_expires_at") and device["pairing_expires_at"] < now:
        raise HTTPException(status_code=400, detail="Pairing code has expired. Open the mobile app for a new code.")
    if device.get("is_paired") and device.get("dashboard_session_id") != session_id:
        raise HTTPException(status_code=409, detail="This device is already linked to another dashboard session.")

    device_id = device["device_id"]

    # Get or create dashboard session
    if session_id:
        session = await db.dashboard_sessions.find_one({"session_id": session_id})
    else:
        session = None

    if session:
        # Add device to existing session if not already there
        if device_id not in session.get("device_ids", []):
            await db.dashboard_sessions.update_one(
                {"session_id": session_id},
                {"$addToSet": {"device_ids": device_id}, "$set": {"last_active": now}}
            )
    else:
        # Create new session
        session_id = str(uuid.uuid4())
        await db.dashboard_sessions.insert_one({
            "session_id": session_id,
            "device_ids": [device_id],
            "created_at": now,
            "last_active": now,
        })

    # Mark device as paired
    await db.devices.update_one(
        {"device_id": device_id},
        {"$set": {"is_paired": True, "dashboard_session_id": session_id}}
    )

    return {
        "success": True,
        "session_id": session_id,
        "device_id": device_id,
        "device_name": device.get("name", "Mobile Device"),
        "message": "Device paired successfully.",
    }

@api_router.get("/dashboard/session/{session_id}/devices")
async def get_session_devices(session_id: str):
    """List all devices linked to a dashboard session."""
    session = await db.dashboard_sessions.find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    device_ids = session.get("device_ids", [])
    devices = await db.devices.find({"device_id": {"$in": device_ids}}).to_list(None)

    return {
        "success": True,
        "devices": [
            {
                "device_id": d["device_id"],
                "device_name": d.get("name", "Mobile Device"),
                "is_active": d.get("is_active", True),
                "is_paired": d.get("is_paired", False),
                "paired_at": d.get("paired_at"),
            }
            for d in devices
        ],
        "count": len(devices),
    }

@api_router.delete("/dashboard/session/{session_id}/devices/{device_id}")
async def remove_device_from_session(session_id: str, device_id: str):
    """Remove a device from a dashboard session (dashboard-side disconnect)."""
    await db.dashboard_sessions.update_one(
        {"session_id": session_id},
        {"$pull": {"device_ids": device_id}}
    )
    # Only clear pairing if the device is actually in this session
    device = await db.devices.find_one({"device_id": device_id, "dashboard_session_id": session_id})
    if device:
        code_info = await _refresh_pairing_code(device_id)
        await db.devices.update_one(
            {"device_id": device_id},
            {"$set": {"is_paired": False, "dashboard_session_id": None}}
        )
    return {"success": True, "message": "Device removed from session."}

# ==================== DASHBOARD AUTH MODELS (legacy) ====================

class DashboardUserCreate(BaseModel):
    email: str
    password: str
    name: str

class SignupInitiate(BaseModel):
    email: str
    password: str
    name: str

class LoginInitiate(BaseModel):
    email: str

class VerifyOTP(BaseModel):
    email: str
    otp: str

class ResendOTP(BaseModel):
    email: str

class DashboardUserLogin(BaseModel):
    email: str
    password: str

class DeviceAssociationRequest(BaseModel):
    device_code: str

# ==================== DASHBOARD AUTH ENDPOINTS ====================

@api_router.post("/dashboard/auth/signup")
async def dashboard_signup(user: DashboardUserCreate):
    """Sign up a new dashboard user"""
    import hashlib
    
    existing = await db.dashboard_users.find_one({"email": user.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    password_hash = hashlib.sha256(user.password.encode()).hexdigest()
    
    user_doc = {
        "email": user.email.lower(),
        "password_hash": password_hash,
        "name": user.name,
        "created_at": datetime.utcnow(),
        "devices": [],
        "is_active": True
    }
    result = await db.dashboard_users.insert_one(user_doc)
    user_doc['_id'] = result.inserted_id
    
    response = serialize_doc(user_doc)
    del response['password_hash']
    return {"success": True, "user": response, "message": "Account created successfully"}

@api_router.post("/dashboard/auth/signup/initiate")
async def signup_initiate(user: SignupInitiate):
    """Initiate signup by sending OTP to email"""
    import hashlib
    
    existing = await db.dashboard_users.find_one({"email": user.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    otp = ''.join([str(random.randint(0, 9)) for _ in range(6)])
    otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    password_hash = hashlib.sha256(user.password.encode()).hexdigest()
    
    pending_user = {
        "email": user.email.lower(),
        "password_hash": password_hash,
        "name": user.name,
        "otp": otp,
        "otp_expiry": otp_expiry,
        "created_at": datetime.utcnow()
    }
    
    await db.pending_signups.update_one(
        {"email": user.email.lower()},
        {"$set": pending_user},
        upsert=True
    )
    
    if not resend_api_key:
        raise HTTPException(
            status_code=500, 
            detail="Email service not configured. Please set RESEND_API_KEY in environment variables."
        )
    
    params = {
        "from": otp_from_email,
        "to": [user.email],
        "subject": "Your XoW Signup OTP",
        "html": f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Welcome to XoW!</h2>
            <p>Hi {user.name},</p>
            <p>Thank you for signing up. Your One-Time Password (OTP) is:</p>
            <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                {otp}
            </div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
            <p>Best regards,<br>The XoW Team</p>
        </div>
        """
    }
    
    try:
        email_response = resend.Emails.send(params)
        logger.info(f"OTP email sent to {user.email}, response: {email_response}")
        
        return {
            "success": True,
            "message": "OTP sent to your email. Please check your inbox.",
            "email": user.email.lower()
        }
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Failed to send OTP email: {error_msg}")
        await db.pending_signups.delete_one({"email": user.email.lower()})
        
        if "domain is not verified" in error_msg or "testing emails" in error_msg:
            raise HTTPException(
                status_code=400,
                detail=f"Domain not verified. Please verify your domain at https://resend.com/domains to enable signup functionality."
            )
        else:
            raise HTTPException(status_code=500, detail=f"Failed to send OTP email. Please try again later.")

@api_router.post("/dashboard/auth/signup/verify")
async def signup_verify(verify: VerifyOTP):
    """Verify OTP and complete signup"""
    
    pending = await db.pending_signups.find_one({"email": verify.email.lower()})
    if not pending:
        raise HTTPException(status_code=404, detail="No pending signup found for this email")
    
    if pending.get('otp') != verify.otp:
        raise HTTPException(status_code=401, detail="Invalid OTP")
    
    if pending.get('otp_expiry') and pending['otp_expiry'] < datetime.utcnow():
        raise HTTPException(status_code=401, detail="OTP has expired. Please request a new one.")
    
    user_doc = {
        "email": pending['email'],
        "password_hash": pending['password_hash'],
        "name": pending['name'],
        "created_at": datetime.utcnow(),
        "devices": [],
        "is_active": True
    }
    
    result = await db.dashboard_users.insert_one(user_doc)
    user_doc['_id'] = result.inserted_id
    
    await db.pending_signups.delete_one({"email": verify.email.lower()})
    
    response = serialize_doc(user_doc)
    del response['password_hash']
    return {"success": True, "user": response, "message": "Account created successfully"}

@api_router.post("/dashboard/auth/signup/resend-otp")
async def resend_signup_otp(resend_req: ResendOTP):
    """Resend OTP for pending signup"""
    
    pending = await db.pending_signups.find_one({"email": resend_req.email.lower()})
    if not pending:
        raise HTTPException(status_code=404, detail="No pending signup found for this email")
    
    otp = ''.join([str(random.randint(0, 9)) for _ in range(6)])
    otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    
    await db.pending_signups.update_one(
        {"email": resend_req.email.lower()},
        {"$set": {
            "otp": otp,
            "otp_expiry": otp_expiry
        }}
    )
    
    try:
        params = {
            "from": otp_from_email,
            "to": [resend_req.email],
            "subject": "Your XoW Signup OTP (Resent)",
            "html": f"""
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">XoW OTP Resent</h2>
                <p>Hi {pending['name']},</p>
                <p>You requested a new OTP. Your One-Time Password is:</p>
                <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                    {otp}
                </div>
                <p>This OTP will expire in 10 minutes.</p>
                <p>If you didn't request this, please ignore this email.</p>
                <p>Best regards,<br>The XoW Team</p>
            </div>
            """
        }
        
        email_response = resend.Emails.send(params)
        logger.info(f"OTP resent to {resend_req.email}, response: {email_response}")
        
        return {
            "success": True,
            "message": "New OTP sent to your email."
        }
    except Exception as e:
        logger.error(f"Failed to resend OTP email: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to send OTP email: {str(e)}")

@api_router.post("/dashboard/auth/login/initiate")
async def login_initiate(login: LoginInitiate):
    """Initiate login by sending OTP to email"""
    
    user = await db.dashboard_users.find_one({"email": login.email.lower()})
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email")
    
    otp = ''.join([str(random.randint(0, 9)) for _ in range(6)])
    otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    
    await db.pending_logins.update_one(
        {"email": login.email.lower()},
        {"$set": {
            "email": login.email.lower(),
            "otp": otp,
            "otp_expiry": otp_expiry,
            "created_at": datetime.utcnow()
        }},
        upsert=True
    )
    
    if not resend_api_key:
        raise HTTPException(
            status_code=500, 
            detail="Email service not configured. Please set RESEND_API_KEY in environment variables."
        )
    
    params = {
        "from": otp_from_email,
        "to": [login.email],
        "subject": "Your XoW Login OTP",
        "html": f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">XoW Login Verification</h2>
            <p>Hi {user.get('name', 'there')},</p>
            <p>Someone is trying to log in to your account. Your One-Time Password (OTP) is:</p>
            <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                {otp}
            </div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email and consider changing your password.</p>
            <p>Best regards,<br>The XoW Team</p>
        </div>
        """
    }
    
    try:
        email_response = resend.Emails.send(params)
        logger.info(f"Login OTP email sent to {login.email}, response: {email_response}")
        
        return {
            "success": True,
            "message": "OTP sent to your email. Please check your inbox.",
            "email": login.email.lower()
        }
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Failed to send login OTP email: {error_msg}")
        await db.pending_logins.delete_one({"email": login.email.lower()})
        
        if "domain is not verified" in error_msg or "testing emails" in error_msg:
            raise HTTPException(
                status_code=400,
                detail=f"Domain not verified. Please verify your domain at https://resend.com/domains to enable login functionality."
            )
        else:
            raise HTTPException(status_code=500, detail=f"Failed to send OTP email. Please try again later.")

@api_router.post("/dashboard/auth/login/verify")
async def login_verify(verify: VerifyOTP):
    """Verify OTP and complete login"""
    
    pending = await db.pending_logins.find_one({"email": verify.email.lower()})
    if not pending:
        raise HTTPException(status_code=404, detail="No pending login found for this email")
    
    if pending.get('otp') != verify.otp:
        raise HTTPException(status_code=401, detail="Invalid OTP")
    
    if pending.get('otp_expiry') and pending['otp_expiry'] < datetime.utcnow():
        raise HTTPException(status_code=401, detail="OTP has expired. Please request a new one.")
    
    user = await db.dashboard_users.find_one({"email": verify.email.lower()})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    await db.pending_logins.delete_one({"email": verify.email.lower()})
    
    response = serialize_doc(user)
    del response['password_hash']
    return {"success": True, "user": response, "message": "Login successful"}

@api_router.post("/dashboard/auth/login/resend-otp")
async def resend_login_otp(resend_req: ResendOTP):
    """Resend OTP for pending login"""
    
    pending = await db.pending_logins.find_one({"email": resend_req.email.lower()})
    if not pending:
        raise HTTPException(status_code=404, detail="No pending login found for this email")
    
    user = await db.dashboard_users.find_one({"email": resend_req.email.lower()})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    otp = ''.join([str(random.randint(0, 9)) for _ in range(6)])
    otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    
    await db.pending_logins.update_one(
        {"email": resend_req.email.lower()},
        {"$set": {
            "otp": otp,
            "otp_expiry": otp_expiry
        }}
    )
    
    try:
        params = {
            "from": otp_from_email,
            "to": [resend_req.email],
            "subject": "Your XoW Login OTP (Resent)",
            "html": f"""
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">XoW Login OTP Resent</h2>
                <p>Hi {user.get('name', 'there')},</p>
                <p>You requested a new login OTP. Your One-Time Password is:</p>
                <div style="background-color: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                    {otp}
                </div>
                <p>This OTP will expire in 10 minutes.</p>
                <p>If you didn't request this, please ignore this email.</p>
                <p>Best regards,<br>The XoW Team</p>
            </div>
            """
        }
        
        email_response = resend.Emails.send(params)
        logger.info(f"Login OTP resent to {resend_req.email}, response: {email_response}")
        
        return {
            "success": True,
            "message": "New OTP sent to your email."
        }
    except Exception as e:
        logger.error(f"Failed to resend login OTP email: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to send OTP email: {str(e)}")

@api_router.post("/dashboard/auth/login")
async def dashboard_login(login: DashboardUserLogin):
    """Login a dashboard user"""
    import hashlib
    
    password_hash = hashlib.sha256(login.password.encode()).hexdigest()
    
    user = await db.dashboard_users.find_one({
        "email": login.email.lower(),
        "password_hash": password_hash
    })
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    response = serialize_doc(user)
    del response['password_hash']
    return {"success": True, "user": response, "message": "Login successful"}

@api_router.get("/dashboard/auth/user/{user_id}")
async def get_dashboard_user(user_id: str):
    """Get dashboard user details"""
    try:
        user = await db.dashboard_users.find_one({"_id": ObjectId(user_id)})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        response = serialize_doc(user)
        del response['password_hash']
        return response
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ==================== DEVICE MANAGEMENT ENDPOINTS ====================

@api_router.post("/dashboard/devices/add")
async def add_device_to_dashboard(request: DeviceAssociationRequest, user_id: str):
    """Add a device to dashboard account by generating an OTP"""
    import random
    
    user = await db.dashboard_users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if len(user.get('devices', [])) >= 10:
        raise HTTPException(status_code=400, detail="Maximum 10 devices allowed per account")
    
    device = await db.mobile_devices.find_one({"device_code": request.device_code})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found. Please check the 6-digit code on your app.")
    
    if device.get('dashboard_user_id'):
        raise HTTPException(status_code=400, detail="This device is already associated with another account")
    
    otp = ''.join([str(random.randint(0, 9)) for _ in range(8)])
    otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    
    await db.mobile_devices.update_one(
        {"device_code": request.device_code},
        {"$set": {
            "pending_otp": otp,
            "otp_expiry": otp_expiry,
            "pending_user_id": str(user['_id'])
        }}
    )
    
    return {
        "success": True,
        "otp": otp,
        "device_code": request.device_code,
        "expires_in_minutes": 10,
        "message": "Enter this OTP on your mobile app to complete association"
    }

@api_router.post("/mobile/verify-otp")
async def verify_device_otp(device_code: str, otp: str):
    """Verify OTP from mobile app to complete device association"""
    
    device = await db.mobile_devices.find_one({"device_code": device_code})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    if device.get('pending_otp') != otp:
        raise HTTPException(status_code=401, detail="Invalid OTP")
    
    if device.get('otp_expiry') and device['otp_expiry'] < datetime.utcnow():
        raise HTTPException(status_code=401, detail="OTP has expired. Please request a new one.")
    
    pending_user_id = device.get('pending_user_id')
    if not pending_user_id:
        raise HTTPException(status_code=400, detail="No pending association found")
    
    await db.mobile_devices.update_one(
        {"device_code": device_code},
        {
            "$set": {
                "dashboard_user_id": pending_user_id,
                "associated_at": datetime.utcnow()
            },
            "$unset": {
                "pending_otp": "",
                "otp_expiry": "",
                "pending_user_id": ""
            }
        }
    )
    
    await db.dashboard_users.update_one(
        {"_id": ObjectId(pending_user_id)},
        {"$addToSet": {"devices": device_code}}
    )
    
    return {
        "success": True,
        "message": "Device successfully associated with dashboard account"
    }

@api_router.post("/mobile/register-device")
async def register_mobile_device(device_name: str = "Mobile Device"):
    """Register a new mobile device and get a 6-digit static code"""
    import random
    
    while True:
        device_code = ''.join([str(random.randint(0, 9)) for _ in range(6)])
        existing = await db.mobile_devices.find_one({"device_code": device_code})
        if not existing:
            break
    
    device_doc = {
        "device_code": device_code,
        "device_name": device_name,
        "created_at": datetime.utcnow(),
        "dashboard_user_id": None,
        "is_active": True
    }
    result = await db.mobile_devices.insert_one(device_doc)
    device_doc['_id'] = result.inserted_id
    
    return {
        "success": True,
        "device_code": device_code,
        "message": "Device registered. Use this code to connect to your dashboard account."
    }

@api_router.get("/dashboard/devices/{user_id}")
async def get_user_devices(user_id: str):
    """Get all devices associated with a dashboard user"""
    try:
        user = await db.dashboard_users.find_one({"_id": ObjectId(user_id)})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        device_codes = user.get('devices', [])
        devices = await db.mobile_devices.find({"device_code": {"$in": device_codes}}).to_list(10)
        
        return {
            "success": True,
            "devices": [
                {
                    "device_code": d['device_code'],
                    "device_name": d.get('device_name', 'Unknown'),
                    "associated_at": d.get('associated_at'),
                    "is_active": d.get('is_active', True)
                }
                for d in devices
            ],
            "count": len(devices),
            "max_allowed": 10
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.delete("/dashboard/devices/{user_id}/{device_code}")
async def remove_device_from_dashboard(user_id: str, device_code: str):
    """Remove a device from dashboard account"""
    try:
        await db.dashboard_users.update_one(
            {"_id": ObjectId(user_id)},
            {"$pull": {"devices": device_code}}
        )
        
        await db.mobile_devices.update_one(
            {"device_code": device_code},
            {"$set": {"dashboard_user_id": None, "associated_at": None}}
        )
        
        return {"success": True, "message": "Device removed successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ==================== RECORDING ENDPOINTS ====================

@api_router.post("/recordings")
async def create_recording(recording: RecordingCreate):
    """Start a new recording session"""
    # Use the device's actual recording start time if provided, otherwise fall back to server time
    if recording.start_time:
        try:
            start_time = datetime.fromisoformat(recording.start_time.replace('Z', '+00:00')).replace(tzinfo=None)
        except Exception:
            start_time = datetime.utcnow()
    else:
        start_time = datetime.utcnow()

    recording_doc = {
        "device_id": recording.device_id,
        "expo_name": recording.expo_name,
        "booth_name": recording.booth_name,
        "start_time": start_time,
        "end_time": None,
        "duration": recording.duration or 0,
        "status": "recording",
        "has_video": False,
        "has_audio": False,
        "video_file_id": None,
        "audio_file_id": None,
        "transcript": None,
        "summary": None,
        "highlights": [],
        "barcode_scans": [],
        "visitors": [],  # List of visitor badges
        "top_questions": [],
        "top_topics": [],
        "overall_sentiment": "neutral"
    }
    result = await db.recordings.insert_one(recording_doc)
    recording_doc['_id'] = result.inserted_id
    return serialize_doc(recording_doc)

@api_router.get("/recordings")
async def get_recordings(device_id: Optional[str] = None):
    """Get all recordings, optionally filtered by device"""
    query = {"device_id": device_id} if device_id else {}
    recordings = await db.recordings.find(query).sort("start_time", -1).to_list(100)
    return [serialize_doc(r) for r in recordings]

@api_router.get("/recordings/{recording_id}")
async def get_recording(recording_id: str):
    """Get a specific recording by ID"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")
        return serialize_doc(recording)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/recordings/{recording_id}/upload-frame")
async def upload_visitor_frame(
    recording_id: str,
    frame: UploadFile = File(...),
    frame_index: str = Form("0"),
):
    """Receive a 1-minute periodic visitor snapshot and store it for AI head count."""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")

        frame_data = await frame.read()
        if not frame_data:
            raise HTTPException(status_code=400, detail="Empty frame data")

        frame_id = await fs_bucket.upload_from_stream(
            f"visitor_frame_{recording_id}_{frame_index}.jpg",
            io.BytesIO(frame_data),
            metadata={
                "recording_id": recording_id,
                "type": "visitor_frame",
                "frame_index": int(frame_index),
            }
        )

        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$push": {"visitor_frame_ids": str(frame_id)}}
        )

        logger.info(f"Visitor frame {frame_index} stored for recording {recording_id}")
        return {"success": True, "frame_id": str(frame_id), "frame_index": int(frame_index)}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"upload_visitor_frame error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class RecordingComplete(BaseModel):
    duration: Optional[float] = None  # Actual recording duration in seconds from device

@api_router.put("/recordings/{recording_id}/complete")
async def complete_recording(recording_id: str, body: Optional[RecordingComplete] = None):
    """Mark a recording as completed. Visitor counting runs automatically in the video pipeline."""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")

        end_time = datetime.utcnow()
        # Use device-provided duration if available; otherwise keep existing duration
        # (which was set during create_recording from the device). Only fall back to
        # server-time calculation as a last resort.
        if body and body.duration is not None:
            duration = body.duration
        elif recording.get('duration'):
            duration = recording['duration']
        else:
            duration = (end_time - recording['start_time']).total_seconds()

        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {
                "end_time": end_time,
                "duration": duration,
                "status": "completed"
            }}
        )

        updated = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        return serialize_doc(updated)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.delete("/recordings/{recording_id}")
async def delete_recording(recording_id: str):
    """Delete a recording and its associated files"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")
        
        if recording.get('video_file_id'):
            try:
                await fs_bucket.delete(ObjectId(recording['video_file_id']))
            except Exception as e:
                logger.warning(f"Failed to delete video file: {e}")
        
        if recording.get('audio_file_id'):
            try:
                await fs_bucket.delete(ObjectId(recording['audio_file_id']))
            except Exception as e:
                logger.warning(f"Failed to delete audio file: {e}")
        
        await db.barcode_scans.delete_many({"recording_id": recording_id})
        await db.video_chunks.delete_many({"recording_id": recording_id})
        await db.visitor_badges.delete_many({"recording_id": recording_id})
        await db.recordings.delete_one({"_id": ObjectId(recording_id)})
        
        return {"success": True, "message": "Recording deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/recordings/{recording_id}/reprocess")
async def reprocess_recording(recording_id: str, background_tasks: BackgroundTasks):
    """Re-process a recording that had errors"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")
        
        if not recording.get('audio_file_id'):
            raise HTTPException(status_code=400, detail="No audio file found for this recording")
        
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {"status": "processing"}}
        )
        
        background_tasks.add_task(process_transcription_with_diarization, recording_id)
        
        return {"success": True, "message": "Reprocessing started with speaker diarization", "status": "processing"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class ManualTranscriptRequest(BaseModel):
    transcript: str

@api_router.post("/recordings/{recording_id}/manual-transcript")
async def add_manual_transcript(recording_id: str, request: ManualTranscriptRequest, background_tasks: BackgroundTasks):
    """Add a manual transcript and trigger AI analysis"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")
        
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {
                "transcript": request.transcript,
                "status": "processing"
            }}
        )
        
        background_tasks.add_task(process_diarization_only, recording_id, request.transcript)
        
        return {"success": True, "message": "Transcript added, analysis started"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ==================== VIDEO/AUDIO UPLOAD ====================

@api_router.post("/recordings/{recording_id}/upload-video")
async def upload_video(
    recording_id: str,
    video: UploadFile = File(...),
    chunk_index: int = Form(0),
    total_chunks: int = Form(1),
    background_tasks: BackgroundTasks = None
):
    """Upload video file - stores to GridFS immediately and processes overlay/audio in background"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")

        video_data = await video.read()

        filename = video.filename or "recording.mp4"
        content_type = video.content_type or "video/mp4"

        if "mp4" in content_type or filename.endswith(".mp4"):
            ext = "mp4"
            mime = "video/mp4"
        elif "webm" in content_type or filename.endswith(".webm"):
            ext = "webm"
            mime = "video/webm"
        elif "mov" in content_type or filename.endswith(".mov"):
            ext = "mov"
            mime = "video/quicktime"
        else:
            ext = "mp4"
            mime = "video/mp4"

        if total_chunks == 1:
            # Store raw video to GridFS immediately so we can respond right away
            raw_video_id = await fs_bucket.upload_from_stream(
                f"video_{recording_id}.{ext}",
                io.BytesIO(video_data),
                metadata={"recording_id": recording_id, "type": "video", "mime_type": mime}
            )

            await db.recordings.update_one(
                {"_id": ObjectId(recording_id)},
                {"$set": {
                    "video_file_id": str(raw_video_id),
                    "has_video": True,
                    "video_mime_type": mime,
                    "status": "processing"
                }}
            )

            # All heavy processing (overlay, remux, head count, audio) runs in background
            if background_tasks:
                background_tasks.add_task(
                    process_full_video, recording_id, str(raw_video_id), ext, mime
                )

        else:
            # Chunked upload — store each chunk directly in GridFS (no base64/MongoDB size limit)
            # Support resume: replace chunk if it was already uploaded
            existing_ref = await db.video_chunk_refs.find_one(
                {"recording_id": recording_id, "chunk_index": chunk_index}
            )
            if existing_ref:
                try:
                    await fs_bucket.delete(ObjectId(existing_ref['gridfs_id']))
                except Exception:
                    pass

            chunk_gridfs_id = await fs_bucket.upload_from_stream(
                f"chunk_{recording_id}_{chunk_index:05d}",
                io.BytesIO(video_data),
                metadata={"recording_id": recording_id, "chunk_index": chunk_index, "type": "video_chunk"}
            )

            await db.video_chunk_refs.update_one(
                {"recording_id": recording_id, "chunk_index": chunk_index},
                {"$set": {
                    "gridfs_id": str(chunk_gridfs_id),
                    "total_chunks": total_chunks,
                    "mime_type": mime,
                    "extension": ext,
                    "uploaded_at": datetime.utcnow()
                }},
                upsert=True
            )

            chunks_done = await db.video_chunk_refs.count_documents({"recording_id": recording_id})
            logger.info(f"Chunk {chunk_index + 1}/{total_chunks} received for recording {recording_id}")

            if chunks_done == total_chunks:
                chunk_refs = await db.video_chunk_refs.find(
                    {"recording_id": recording_id}
                ).sort("chunk_index", 1).to_list(total_chunks)

                first_ref = chunk_refs[0] if chunk_refs else {}
                mime = first_ref.get('mime_type', 'video/mp4')
                ext = first_ref.get('extension', 'mp4')

                await db.recordings.update_one(
                    {"_id": ObjectId(recording_id)},
                    {"$set": {
                        "has_video": True,
                        "video_mime_type": mime,
                        "status": "processing"
                    }}
                )

                if background_tasks:
                    background_tasks.add_task(
                        merge_chunks_and_process, recording_id, chunk_refs, ext, mime
                    )

        logger.info(f"Video received for recording {recording_id}: {ext} ({mime}), processing in background")
        return {"success": True, "message": "Video received, processing in background", "format": mime}
    except Exception as e:
        logger.error(f"Video upload error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


async def process_full_video(recording_id: str, raw_video_id: str, ext: str, mime: str):
    """Background task: stream video from GridFS to temp file, then run the processing pipeline."""
    tmp_path = None
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            return

        # Stream from GridFS → temp file (avoids loading entire video into memory)
        with tempfile.NamedTemporaryFile(suffix=f'.{ext}', delete=False) as tmp_file:
            tmp_path = tmp_file.name
            grid_out = await fs_bucket.open_download_stream(ObjectId(raw_video_id))
            while True:
                block = await grid_out.read(1024 * 1024)  # 1MB at a time
                if not block:
                    break
                tmp_file.write(block)

        await _run_video_pipeline(recording_id, tmp_path, raw_video_id, ext, mime, recording)

    except Exception as e:
        logger.error(f"Background video processing error for {recording_id}: {e}")
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {"status": "error", "error": str(e)}}
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

async def process_video_audio(recording_id: str, video_data: bytes, video_format: str):
    """Extract audio from video and process transcription"""
    try:
        logger.info(f"Extracting audio from video for recording {recording_id}")
        
        audio_data = await extract_audio_from_video(video_data, video_format)
        
        if audio_data:
            # Store extracted audio
            audio_id = await fs_bucket.upload_from_stream(
                f"audio_{recording_id}.m4a",
                io.BytesIO(audio_data),
                metadata={"recording_id": recording_id, "type": "audio", "extracted_from_video": True}
            )
            
            await db.recordings.update_one(
                {"_id": ObjectId(recording_id)},
                {"$set": {
                    "audio_file_id": str(audio_id),
                    "has_audio": True
                }}
            )
            
            # Process transcription
            await process_transcription_with_diarization(recording_id)
        else:
            logger.error(f"Failed to extract audio from video for recording {recording_id}")
            await db.recordings.update_one(
                {"_id": ObjectId(recording_id)},
                {"$set": {"status": "uploaded", "error": "Audio extraction failed"}}
            )
    except Exception as e:
        logger.error(f"Error processing video audio: {e}")
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {"status": "error", "error": str(e)}}
        )

@api_router.post("/recordings/{recording_id}/upload-audio")
async def upload_audio(recording_id: str, audio: UploadFile = File(...), background_tasks: BackgroundTasks = None):
    """Upload audio file for a recording and automatically trigger transcription"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")
        
        audio_data = await audio.read()
        
        audio_id = await fs_bucket.upload_from_stream(
            f"audio_{recording_id}.m4a",
            io.BytesIO(audio_data),
            metadata={"recording_id": recording_id, "type": "audio"}
        )
        
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {
                "audio_file_id": str(audio_id),
                "has_audio": True,
                "status": "processing"
            }}
        )
        
        if background_tasks:
            background_tasks.add_task(process_transcription_with_diarization, recording_id)
        
        return {"success": True, "message": "Audio uploaded, transcription started"}
    except Exception as e:
        logger.error(f"Audio upload error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# ==================== TRANSCRIPTION & ANALYSIS ====================

async def process_transcription_with_diarization(recording_id: str):
    """Process audio with Whisper transcription and GPT-powered speaker diarization"""
    try:
        logger.info(f"Starting transcription for recording {recording_id}")
        
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording or not recording.get('audio_file_id'):
            logger.error(f"Recording or audio file not found: {recording_id}")
            return
        
        # Get audio data from GridFS
        grid_out = await fs_bucket.open_download_stream(ObjectId(recording['audio_file_id']))
        audio_data = await grid_out.read()
        
        # Transcribe with Whisper (auto-detects language including Tamil)
        transcript = ""
        detected_language = None
        if whisper_client:
            try:
                audio_file = io.BytesIO(audio_data)
                audio_file.name = "audio.m4a"

                response = whisper_client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="verbose_json"
                )
                transcript = response.text if hasattr(response, 'text') else str(response)
                detected_language = response.language if hasattr(response, 'language') else None
                # Extract per-segment timestamps from Whisper for accurate diarization
                whisper_segments = []
                if hasattr(response, 'segments') and response.segments:
                    whisper_segments = [
                        {"start": float(seg.start), "end": float(seg.end), "text": seg.text.strip()}
                        for seg in response.segments
                        if seg.text.strip()
                    ]
                logger.info(f"Transcription completed: {len(transcript)} chars, {len(whisper_segments)} segments, detected language: {detected_language}")
            except Exception as e:
                logger.error(f"Whisper transcription error: {e}")
                transcript = ""
        
        if transcript:
            update_fields = {"transcript": transcript}
            if detected_language:
                update_fields["detected_language"] = detected_language
            await db.recordings.update_one(
                {"_id": ObjectId(recording_id)},
                {"$set": update_fields}
            )

            # Process with GPT for diarization and visitor extraction
            logger.info(f"Performing speaker diarization for recording {recording_id}")
            await perform_advanced_diarization(recording_id, transcript, recording.get('duration', 0), detected_language, whisper_segments)
        else:
            await db.recordings.update_one(
                {"_id": ObjectId(recording_id)},
                {"$set": {
                    "status": "completed",
                    "summary": "No speech detected in audio",
                    "overall_summary": "No speech detected in audio"
                }}
            )
            
    except Exception as e:
        logger.error(f"Transcription processing error: {e}")
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {"status": "error", "error": str(e)}}
        )

async def process_diarization_only(recording_id: str, transcript: str):
    """Process only the diarization step for manual transcripts"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        duration = recording.get('duration', 0) if recording else 0
        await perform_advanced_diarization(recording_id, transcript, duration)
    except Exception as e:
        logger.error(f"Diarization error: {e}")
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {"status": "error", "error": str(e)}}
        )

async def perform_advanced_diarization(recording_id: str, transcript: str, duration: float, detected_language: str = None, whisper_segments: list = None):
    """Use GPT to perform advanced speaker diarization and create visitor badges"""
    if not openai_client:
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {
                "status": "completed",
                "summary": transcript[:500] if transcript else "No transcript available"
            }}
        )
        return
    
    try:
        # Get any barcode scans for this recording
        barcode_scans = await db.barcode_scans.find({"recording_id": recording_id}).to_list(100)
        barcode_info = ""
        if barcode_scans:
            barcode_list = [f"- {b['barcode_data']} at {b.get('video_timestamp', 0):.1f}s" for b in barcode_scans]
            barcode_info = f"\n\nBarcode scans during recording:\n" + "\n".join(barcode_list)

        # Build language instruction for GPT prompts
        response_language = LANGUAGE_NAMES.get(detected_language, "English") if detected_language else "English"
        lang_instruction = (
            f"The transcript is in {response_language}. "
            f"Write all summaries, topics, questions, and key points in {response_language}."
        ) if detected_language and detected_language != "en" else ""

        # Step 1: Get overall analysis
        analysis_prompt = f"""Analyze this expo booth conversation transcript and provide:
{lang_instruction}

TRANSCRIPT:
{transcript}
{barcode_info}

Provide a JSON response with:
{{
    "overall_summary": "2-3 sentence summary of the entire conversation",
    "top_questions": ["list of most important questions asked by visitors"],
    "top_topics": ["list of main topics discussed"],
    "overall_sentiment": "positive/neutral/negative",
    "key_insights": ["important insights for follow-up"],
    "visitor_count_estimate": number
}}"""

        analysis_response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": analysis_prompt}],
            response_format={"type": "json_object"}
        )
        
        analysis = json.loads(analysis_response.choices[0].message.content)
        
        # Step 2: Get speaker segments and visitor badges
        # Build input for diarization - use Whisper timestamps if available for accuracy
        if whisper_segments and len(whisper_segments) > 0:
            segments_text = "\n".join(
                f"[{seg['start']:.1f}s-{seg['end']:.1f}s] {seg['text']}"
                for seg in whisper_segments
            )
            diarization_prompt = f"""You are analyzing an expo booth conversation. Each line below has the EXACT start and end time (in seconds) from speech recognition — use these times directly, do NOT invent or estimate times.
{lang_instruction}

TIMESTAMPED TRANSCRIPT (start_time - end_time: text):
{segments_text}
{barcode_info}

Total recording duration: {duration:.1f} seconds

Assign each transcript line to a speaker. The HOST is the booth staff who is present throughout. Each distinct visitor is a separate non-host speaker.

Return JSON:
{{
    "speakers": [
        {{
            "speaker_id": "unique_id",
            "is_host": true/false,
            "label": "Host" or visitor name if mentioned or barcode if matched,
            "company": "company name if mentioned or null",
            "role": "role if mentioned or null",
            "sentiment": "positive/interested/neutral/skeptical/negative",
            "topics_discussed": ["topic1", "topic2"],
            "key_points": ["point1", "point2"],
            "questions_asked": ["question1", "question2"],
            "dialogue_segments": [
                {{"content": "exact text from transcript line", "start_time": 0.0, "end_time": 3.5}}
            ]
        }}
    ],
    "conversations": [
        {{
            "title": "Topic discussed",
            "start_time": 45.0,
            "summary": "Brief summary"
        }}
    ]
}}

Rules:
- Use the EXACT start_time and end_time values from the timestamped lines above
- First/recurring speaker throughout is usually the HOST
- Each new visitor arriving is a separate non-host speaker
- Link barcodes to speakers whose time range overlaps the barcode scan time
- Separate adjacent same-speaker lines into individual dialogue_segments"""
        else:
            # Fallback when no Whisper segments: estimate from transcript position
            diarization_prompt = f"""Analyze this expo booth conversation and identify distinct speakers/visitors.
For each visitor interaction, create a visitor badge.
{lang_instruction}

TRANSCRIPT:
{transcript}
{barcode_info}

Recording duration: {duration:.1f} seconds

Create a JSON response:
{{
    "speakers": [
        {{
            "speaker_id": "unique_id",
            "is_host": true/false,
            "label": "Host" or visitor name if mentioned or barcode if provided,
            "company": "company name if mentioned",
            "role": "role if mentioned",
            "sentiment": "positive/interested/neutral/skeptical/negative",
            "topics_discussed": ["topic1", "topic2"],
            "key_points": ["main point 1", "main point 2"],
            "questions_asked": ["question 1", "question 2"],
            "start_percent": 0-100,
            "end_percent": 0-100,
            "dialogue_segments": [
                {{"content": "what they said", "start_percent": 0-100, "end_percent": 0-100}}
            ]
        }}
    ],
    "conversations": [
        {{
            "title": "Topic discussed",
            "start_percent": 0-100,
            "summary": "Brief summary"
        }}
    ]
}}

Rules:
- First speaker is usually the HOST (booth staff)
- Each visitor is a separate speaker
- Link barcodes to speakers if scanned during their segment
- Estimate time percentages based on transcript position"""

        diarization_response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": diarization_prompt}],
            response_format={"type": "json_object"}
        )
        
        diarization = json.loads(diarization_response.choices[0].message.content)
        
        # Step 3: Create visitor badges from non-host speakers
        visitors = []
        visitor_badges = []
        
        for speaker in diarization.get('speakers', []):
            if not speaker.get('is_host', False):
                # Create visitor badge
                badge_id = speaker.get('label', f"Visitor_{len(visitors)+1}")
                
                # Check if barcode was scanned for this visitor
                is_barcode = any(b['barcode_data'] == badge_id for b in barcode_scans)
                
                # Use real timestamps if available (from Whisper segments), else fall back to percent
                if whisper_segments and speaker.get('dialogue_segments'):
                    segs = speaker['dialogue_segments']
                    start_time = segs[0].get('start_time', 0)
                    end_time = segs[-1].get('end_time', duration)
                else:
                    start_time = (speaker.get('start_percent', 0) / 100) * duration
                    end_time = (speaker.get('end_percent', 100) / 100) * duration
                
                visitor_badge = {
                    "badge_id": badge_id,
                    "recording_id": recording_id,
                    "visitor_label": badge_id,
                    "start_time": start_time,
                    "end_time": end_time,
                    "summary": f"Discussed: {', '.join(speaker.get('topics_discussed', [])[:2])}",
                    "topics": speaker.get('topics_discussed', []),
                    "questions_asked": speaker.get('questions_asked', []),
                    "sentiment": speaker.get('sentiment', 'neutral'),
                    "key_points": speaker.get('key_points', []),
                    "is_barcode_linked": is_barcode,
                    "company": speaker.get('company'),
                    "role": speaker.get('role'),
                    "created_at": datetime.utcnow()
                }
                
                visitor_badges.append(visitor_badge)
                visitors.append(visitor_badge)
        
        # Store visitor badges in separate collection
        if visitor_badges:
            await db.visitor_badges.insert_many(visitor_badges)
        
        # Add timestamp information to speakers
        for speaker in diarization.get('speakers', []):
            if whisper_segments:
                # Real timestamps already present in dialogue_segments from GPT
                segs = speaker.get('dialogue_segments', [])
                speaker['start_time'] = segs[0].get('start_time', 0) if segs else 0
                speaker['end_time'] = segs[-1].get('end_time', duration) if segs else duration
                for seg in segs:
                    st = seg.get('start_time', 0)
                    seg['timestamp_label'] = f"{int(st//60)}:{int(st%60):02d}"
            else:
                # Fallback: convert percentages to seconds
                start_pct = speaker.get('start_percent', 0)
                end_pct = speaker.get('end_percent', 100)
                speaker['start_time'] = (start_pct / 100) * duration
                speaker['end_time'] = (end_pct / 100) * duration
                for seg in speaker.get('dialogue_segments', []):
                    seg_start = seg.get('start_percent', 0)
                    seg_end = seg.get('end_percent', 100)
                    seg['start_time'] = (seg_start / 100) * duration
                    seg['end_time'] = (seg_end / 100) * duration
                    seg['timestamp_label'] = f"{int(seg['start_time']//60)}:{int(seg['start_time']%60):02d}"

        # Add timestamp info to conversations
        for conv in diarization.get('conversations', []):
            if whisper_segments:
                # GPT should have given real start_time already; ensure it's a float
                conv['start_time'] = float(conv.get('start_time', 0))
            else:
                start_pct = conv.get('start_percent', 0)
                conv['start_time'] = (start_pct / 100) * duration
        
        # Update recording with all data
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {
                "status": "processed",
                "overall_summary": analysis.get('overall_summary', ''),
                "summary": analysis.get('overall_summary', ''),
                "top_questions": analysis.get('top_questions', []),
                "top_topics": analysis.get('top_topics', []),
                "overall_sentiment": analysis.get('overall_sentiment', 'neutral'),
                "key_insights": analysis.get('key_insights', []),
                "visitor_count": len(visitors),
                "visitors": visitors,
                "speakers": diarization.get('speakers', []),
                "conversations": diarization.get('conversations', []),
                "total_speakers": len(diarization.get('speakers', [])),
                "host_identified": any(s.get('is_host') for s in diarization.get('speakers', []))
            }}
        )
        
        logger.info(f"Transcription with diarization completed for recording {recording_id}")
        
    except Exception as e:
        logger.error(f"Diarization error: {e}")
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {
                "status": "processed",
                "summary": transcript[:500] if transcript else "Analysis failed",
                "error": str(e)
            }}
        )

# ==================== VISITOR BADGE ENDPOINTS ====================

@api_router.get("/visitors")
async def get_all_visitors():
    """Get all visitor badges across all recordings"""
    visitors = await db.visitor_badges.find({}).sort("created_at", -1).to_list(500)
    return [serialize_doc(v) for v in visitors]

@api_router.get("/visitors/recording/{recording_id}")
async def get_recording_visitors(recording_id: str):
    """Get all visitor badges for a specific recording"""
    visitors = await db.visitor_badges.find({"recording_id": recording_id}).to_list(100)
    return [serialize_doc(v) for v in visitors]

@api_router.get("/visitors/{visitor_id}")
async def get_visitor(visitor_id: str):
    """Get a specific visitor badge"""
    try:
        visitor = await db.visitor_badges.find_one({"_id": ObjectId(visitor_id)})
        if not visitor:
            raise HTTPException(status_code=404, detail="Visitor not found")
        return serialize_doc(visitor)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ==================== BARCODE ENDPOINTS ====================

@api_router.post("/barcodes")
async def create_barcode_scan(barcode: BarcodeCreate):
    """Record a barcode scan during recording"""
    barcode_doc = {
        "recording_id": barcode.recording_id,
        "barcode_data": barcode.barcode_data,
        "video_timestamp": barcode.video_timestamp,
        "frame_code": barcode.frame_code,
        "scan_time": datetime.utcnow()
    }
    result = await db.barcode_scans.insert_one(barcode_doc)
    
    # Also update the recording document
    await db.recordings.update_one(
        {"_id": ObjectId(barcode.recording_id)},
        {"$push": {"barcode_scans": barcode_doc}}
    )
    
    barcode_doc['_id'] = result.inserted_id
    return serialize_doc(barcode_doc)

# ==================== DASHBOARD DATA ENDPOINTS ====================

@api_router.get("/dashboard/insights")
async def get_dashboard_insights(session_id: Optional[str] = None, user_id: Optional[str] = None):
    """Get aggregated insights for the dashboard, filtered to session's linked devices."""
    # Resolve device filter: prefer session_id, fall back to legacy user_id
    if session_id:
        device_ids = await get_session_device_ids(session_id)
    elif user_id:
        device_ids = await get_linked_device_ids(user_id)
    else:
        device_ids = None

    rec_query = {"device_id": {"$in": device_ids}} if device_ids is not None else {}
    recordings = await db.recordings.find(rec_query).to_list(1000)

    if device_ids is not None:
        recording_ids = [str(r["_id"]) for r in recordings]
        vis_query = {"recording_id": {"$in": recording_ids}}
    else:
        vis_query = {}
    visitors = await db.visitor_badges.find(vis_query).to_list(1000)
    
    total_recordings = len(recordings)
    total_visitors = len(visitors)
    total_duration = sum(r.get('duration', 0) or 0 for r in recordings)
    
    # Calculate total head count from AI detection
    total_head_count = sum(r.get('head_count', 0) or 0 for r in recordings)
    
    # Use head count if available, otherwise fall back to visitor badges count
    display_visitors = total_head_count if total_head_count > 0 else total_visitors
    
    # Aggregate top topics across all recordings
    all_topics = []
    all_questions = []
    for r in recordings:
        all_topics.extend(r.get('top_topics', []))
        all_questions.extend(r.get('top_questions', []))
    
    # Count topic frequency
    topic_counts = {}
    for topic in all_topics:
        topic_counts[topic] = topic_counts.get(topic, 0) + 1
    top_topics = sorted(topic_counts.keys(), key=lambda x: topic_counts[x], reverse=True)[:10]
    
    # Count question frequency
    question_counts = {}
    for q in all_questions:
        question_counts[q] = question_counts.get(q, 0) + 1
    top_questions = sorted(question_counts.keys(), key=lambda x: question_counts[x], reverse=True)[:5]
    
    recent_activity = []
    for r in sorted(recordings, key=lambda x: x.get('start_time', datetime.min), reverse=True)[:5]:
        recent_activity.append({
            "id": str(r['_id']),
            "booth_name": r.get('booth_name', 'Unknown'),
            "start_time": (r.get('start_time').isoformat() + 'Z') if r.get('start_time') else None,
            "duration": r.get('duration', 0),
            "status": r.get('status', 'unknown'),
            "total_interactions": r.get('head_count', 0) or r.get('visitor_count', len(r.get('visitors', []))),
            "head_count": r.get('head_count', 0),
            "visitor_count_confidence": r.get('visitor_count_confidence', None),
            "visitor_frame_count": r.get('visitor_frame_count', 0),
        })

    return {
        "total_recordings": total_recordings,
        "total_visitors": display_visitors,
        "total_head_count": total_head_count,
        "total_duration_hours": total_duration / 3600,
        "top_topics": top_topics,
        "top_questions": top_questions,
        "recent_activity": recent_activity
    }

@api_router.get("/dashboard/recordings")
async def get_dashboard_recordings(session_id: Optional[str] = None, user_id: Optional[str] = None):
    """Get recordings for the dashboard, filtered to session's linked devices."""
    if session_id:
        device_ids = await get_session_device_ids(session_id)
    elif user_id:
        device_ids = await get_linked_device_ids(user_id)
    else:
        device_ids = None

    query = {"device_id": {"$in": device_ids}} if device_ids is not None else {}
    recordings = await db.recordings.find(query).sort("start_time", -1).to_list(100)
    result = []

    for r in recordings:
        recording_id = str(r['_id'])
        rec_data = serialize_doc(r)
        visitors = await db.visitor_badges.find({"recording_id": recording_id}).to_list(50)
        rec_data['visitor_badges'] = [serialize_doc(v) for v in visitors]
        result.append(rec_data)

    return result

@api_router.get("/dashboard/visitors")
async def get_dashboard_visitors(session_id: Optional[str] = None, user_id: Optional[str] = None):
    """Get all visitors with their recording info, filtered to session's linked devices."""
    if session_id:
        device_ids = await get_session_device_ids(session_id)
    elif user_id:
        device_ids = await get_linked_device_ids(user_id)
    else:
        device_ids = None

    if device_ids is not None:
        recs = await db.recordings.find(
            {"device_id": {"$in": device_ids}}, {"_id": 1}
        ).to_list(None)
        recording_ids = [str(r["_id"]) for r in recs]
        query = {"recording_id": {"$in": recording_ids}}
    else:
        query = {}

    visitors = await db.visitor_badges.find(query).sort("created_at", -1).to_list(500)
    result = []

    for v in visitors:
        visitor_data = serialize_doc(v)
        if v.get('recording_id'):
            recording = await db.recordings.find_one({"_id": ObjectId(v['recording_id'])})
            if recording:
                visitor_data['booth_name'] = recording.get('booth_name')
                st = recording.get('start_time')
                visitor_data['recording_date'] = (st.isoformat() + 'Z') if st else None
        result.append(visitor_data)

    return result

# ==================== MEDIA STREAMING ====================

@api_router.get("/recordings/{recording_id}/video")
async def get_video(recording_id: str, request: Request):
    """Stream video file with range support"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording or not recording.get('video_file_id'):
            raise HTTPException(status_code=404, detail="Video not found")
        
        file_info = await db.fs.files.find_one({"_id": ObjectId(recording['video_file_id'])})
        file_size = file_info.get('length', 0) if file_info else 0
        
        mime_type = recording.get('video_mime_type')
        if not mime_type and file_info:
            mime_type = file_info.get('metadata', {}).get('mime_type', 'video/mp4')
        if not mime_type:
            mime_type = 'video/mp4'
        
        grid_out = await fs_bucket.open_download_stream(ObjectId(recording['video_file_id']))
        
        range_header = request.headers.get('range')
        
        if range_header and file_size > 0:
            range_match = range_header.replace('bytes=', '').split('-')
            start = int(range_match[0]) if range_match[0] else 0
            end = int(range_match[1]) if len(range_match) > 1 and range_match[1] else file_size - 1
            
            start = max(0, min(start, file_size - 1))
            end = max(start, min(end, file_size - 1))
            
            grid_out.seek(start)
            content_length = end - start + 1
            content = await grid_out.read(content_length)
            
            return Response(
                content=content,
                status_code=206,
                media_type=mime_type,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(content_length)
                }
            )
        else:
            content = await grid_out.read()
            return Response(
                content=content,
                media_type=mime_type,
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(file_size)
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Video streaming error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@api_router.get("/recordings/{recording_id}/audio")
async def get_audio(recording_id: str, request: Request):
    """Stream audio file with range support"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording or not recording.get('audio_file_id'):
            raise HTTPException(status_code=404, detail="Audio not found")
        
        file_info = await db.fs.files.find_one({"_id": ObjectId(recording['audio_file_id'])})
        file_size = file_info.get('length', 0) if file_info else 0
        
        grid_out = await fs_bucket.open_download_stream(ObjectId(recording['audio_file_id']))
        
        range_header = request.headers.get('range')
        
        if range_header and file_size > 0:
            range_match = range_header.replace('bytes=', '').split('-')
            start = int(range_match[0]) if range_match[0] else 0
            end = int(range_match[1]) if len(range_match) > 1 and range_match[1] else file_size - 1
            
            start = max(0, min(start, file_size - 1))
            end = max(start, min(end, file_size - 1))
            
            grid_out.seek(start)
            content_length = end - start + 1
            content = await grid_out.read(content_length)
            
            return Response(
                content=content,
                status_code=206,
                media_type="audio/mp4",
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(content_length)
                }
            )
        else:
            content = await grid_out.read()
            return Response(
                content=content,
                media_type="audio/mp4",
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(file_size)
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Audio streaming error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@api_router.get("/recordings/{recording_id}/status")
async def get_recording_status(recording_id: str):
    """Get the current status of a recording"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")
        return {"status": recording.get('status', 'unknown')}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

LANGUAGE_NAMES = {
    "en": "English",
    "ta": "Tamil",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "zh": "Chinese (Simplified)",
    "ja": "Japanese",
    "ko": "Korean",
    "hi": "Hindi",
    "ar": "Arabic",
    "pt": "Portuguese",
    "ru": "Russian",
    "it": "Italian",
}

@api_router.post("/recordings/{recording_id}/translate")
async def translate_transcript(recording_id: str, target_language: str = "en"):
    """Translate a recording's transcript to another language"""
    try:
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        if not recording:
            raise HTTPException(status_code=404, detail="Recording not found")

        transcript = recording.get('transcript')
        if not transcript:
            raise HTTPException(status_code=400, detail="No transcript available")

        if not openai_client:
            raise HTTPException(status_code=500, detail="Translation service not available")

        # Map language code to full name so GPT produces accurate output
        language_name = LANGUAGE_NAMES.get(target_language, target_language)

        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are a professional translator. Translate the user's text into {language_name}. "
                        f"Return ONLY the translated text with no explanations, notes, or original text. "
                        f"Preserve paragraph breaks and punctuation style."
                    )
                },
                {
                    "role": "user",
                    "content": transcript
                }
            ]
        )

        translated = response.choices[0].message.content.strip()

        return {
            "success": True,
            "original_transcript": transcript,
            "translated_transcript": translated,
            "target_language": target_language,
            "language_name": language_name
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ==================== STATIC FILES & ROUTES ====================

# Include the router in the main app
app.include_router(api_router)

# Serve home page
@app.get("/api/home")
async def serve_home():
    return FileResponse(ROOT_DIR / "static" / "index.html")

# Serve dashboard
@app.get("/api/dashboard")
async def serve_dashboard():
    return FileResponse(ROOT_DIR / "static" / "dashboard.html")
