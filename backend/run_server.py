#!/usr/bin/env python3
"""
XoW Backend Server Startup Script
Run this to start the backend server on all network interfaces
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",  # Listen on all network interfaces (allows phone to connect)
        port=8000,
        reload=True,     # Auto-reload on code changes
        log_level="info"
    )
