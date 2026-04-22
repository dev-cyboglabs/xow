#!/usr/bin/env python3
"""
Quick script to check what contacts are in the database
Run: python check_contacts.py
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os
from pathlib import Path

# Load environment
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

async def check_contacts():
    # Connect to MongoDB
    mongo_url = os.environ['MONGO_URL']
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ['DB_NAME']]
    
    print("=" * 60)
    print("CHECKING IMPORTED CONTACTS IN DATABASE")
    print("=" * 60)
    
    # Get all contact documents
    cursor = db.imported_contacts.find({})
    docs = await cursor.to_list(None)
    
    if not docs:
        print("\n❌ NO CONTACTS FOUND IN DATABASE")
        print("\nPossible reasons:")
        print("1. Data not uploaded yet from Data Encryptor")
        print("2. Upload failed (check backend logs)")
        print("3. Wrong database/collection name")
        print("\nTo fix:")
        print("- Go to /data-encryptor")
        print("- Upload CSV/Excel file")
        print("- Click 'Send Data' button")
        print("- Check backend logs for upload confirmation")
    else:
        print(f"\n✅ FOUND {len(docs)} CONTACT DOCUMENT(S)\n")
        
        for i, doc in enumerate(docs, 1):
            print(f"\n--- Document {i} ---")
            print(f"Session ID: {doc.get('session_id', 'None (Global)')}")
            print(f"User ID: {doc.get('user_id', 'None')}")
            print(f"Contact Count: {doc.get('contact_count', 0)}")
            print(f"Filename: {doc.get('filename', 'Unknown')}")
            print(f"Uploaded At: {doc.get('uploaded_at', 'Unknown')}")
            
            contacts = doc.get('contacts', [])
            if contacts:
                print(f"\nFirst 3 contacts:")
                for j, contact in enumerate(contacts[:3], 1):
                    name = contact.get('name', contact.get('full name', 'Unknown'))
                    email = contact.get('email', 'N/A')
                    phone = contact.get('phone', contact.get('mobile', 'N/A'))
                    print(f"  {j}. {name} - {email} - {phone}")
                
                if len(contacts) > 3:
                    print(f"  ... and {len(contacts) - 3} more")
            else:
                print("  ⚠️  No contacts in array!")
    
    print("\n" + "=" * 60)
    
    # Close connection
    client.close()

if __name__ == "__main__":
    asyncio.run(check_contacts())
