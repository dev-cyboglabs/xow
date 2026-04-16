#!/usr/bin/env python3
"""
Manually trigger merge for recordings with unmerged chunks
"""
import asyncio
import os
import sys
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from dotenv import load_dotenv
from pathlib import Path

# Load environment
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Import the merge function from server
sys.path.insert(0, str(ROOT_DIR))
from server import merge_chunks_and_process

# Create new MongoDB client for this script
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

async def manual_merge(recording_id: str):
    """Manually trigger merge for a recording with unmerged chunks"""
    try:
        # Find the recording
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        
        if not recording:
            print(f"❌ Recording {recording_id} not found")
            return
        
        print(f"✓ Recording found: {recording.get('booth_name', 'Unknown')}")
        
        # Check for chunks
        chunk_refs = await db.video_chunk_refs.find(
            {"recording_id": recording_id}
        ).sort("chunk_index", 1).to_list(100)
        
        if not chunk_refs:
            print(f"❌ No chunks found for this recording")
            return
        
        print(f"✓ Found {len(chunk_refs)} chunks")
        
        # Get metadata from first chunk
        first_ref = chunk_refs[0]
        mime = first_ref.get('mime_type', 'video/mp4')
        ext = first_ref.get('extension', 'mp4')
        
        print(f"  MIME type: {mime}")
        print(f"  Extension: {ext}")
        print(f"\n🔄 Starting merge process...")
        
        # Reset status to processing
        await db.recordings.update_one(
            {"_id": ObjectId(recording_id)},
            {"$set": {"status": "processing", "error": None}}
        )
        
        # Trigger merge
        await merge_chunks_and_process(recording_id, chunk_refs, ext, mime)
        
        # Check result
        updated_recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        
        if updated_recording.get('video_file_id'):
            print(f"\n✅ Merge successful!")
            print(f"   Video File ID: {updated_recording['video_file_id']}")
            print(f"   Status: {updated_recording.get('status', 'unknown')}")
        else:
            print(f"\n❌ Merge failed")
            print(f"   Status: {updated_recording.get('status', 'unknown')}")
            print(f"   Error: {updated_recording.get('error', 'No error message')}")
            
    except Exception as e:
        print(f"\n❌ Error during merge: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python manual_merge.py <recording_id>")
        sys.exit(1)
    
    recording_id = sys.argv[1]
    asyncio.run(manual_merge(recording_id))
