#!/usr/bin/env python3
"""
Check recording status in database
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

async def check_recording(recording_id: str):
    # Connect to MongoDB
    mongo_url = os.environ['MONGO_URL']
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ['DB_NAME']]
    
    try:
        # Find the recording
        recording = await db.recordings.find_one({"_id": ObjectId(recording_id)})
        
        if not recording:
            print(f"❌ Recording {recording_id} not found in database")
            return
        
        print(f"✓ Recording found: {recording_id}")
        print(f"  Booth Name: {recording.get('booth_name', 'N/A')}")
        print(f"  Duration: {recording.get('duration', 0)}s")
        print(f"  Status: {recording.get('status', 'unknown')}")
        print(f"  Has Video: {recording.get('has_video', False)}")
        print(f"  Has Audio: {recording.get('has_audio', False)}")
        print(f"  Video File ID: {recording.get('video_file_id', 'MISSING')}")
        print(f"  Audio File ID: {recording.get('audio_file_id', 'N/A')}")
        print(f"  Video MIME: {recording.get('video_mime_type', 'N/A')}")
        
        # Check for video chunks
        chunk_count = await db.video_chunk_refs.count_documents({"recording_id": recording_id})
        if chunk_count > 0:
            print(f"\n⚠️  Found {chunk_count} unmerged video chunks!")
            chunks = await db.video_chunk_refs.find({"recording_id": recording_id}).sort("chunk_index", 1).to_list(100)
            for chunk in chunks:
                print(f"    - Chunk {chunk.get('chunk_index', '?')}: GridFS ID {chunk.get('gridfs_id', 'N/A')}")
            
            # Check if we can trigger merge
            first_chunk = chunks[0] if chunks else {}
            print(f"\n💡 You can trigger merge by re-uploading the last chunk or running merge manually")
        
        # Check if video file exists in GridFS
        if recording.get('video_file_id'):
            try:
                file_info = await db.fs.files.find_one({"_id": ObjectId(recording['video_file_id'])})
                if file_info:
                    file_size = file_info.get('length', 0)
                    print(f"\n✓ Video file exists in GridFS: {file_size:,} bytes ({file_size / 1024 / 1024:.2f} MB)")
                else:
                    print(f"\n❌ Video file ID exists but file not found in GridFS!")
            except Exception as e:
                print(f"\n❌ Error checking GridFS: {e}")
        else:
            print(f"\n❌ No video_file_id in recording!")
            
    finally:
        client.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python check_recording.py <recording_id>")
        sys.exit(1)
    
    recording_id = sys.argv[1]
    asyncio.run(check_recording(recording_id))
