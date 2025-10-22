#!/usr/bin/env python3
"""
Quick script to check file processing status in Supabase
"""

import os
import requests
import json
from datetime import datetime

def check_file_status():
    """Check the status of recent file uploads"""
    
    # Get Supabase URL and key from environment
    supabase_url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not supabase_url or not supabase_key:
        print("❌ Missing Supabase environment variables")
        print("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        return
    
    # Query recent files
    url = f"{supabase_url}/rest/v1/imu_data_files"
    headers = {
        'apikey': supabase_key,
        'Authorization': f'Bearer {supabase_key}',
        'Content-Type': 'application/json'
    }
    
    params = {
        'select': 'id,filename,file_size_bytes,status,uploaded_at,error_message,sample_count',
        'order': 'uploaded_at.desc',
        'limit': '10'
    }
    
    try:
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        
        files = response.json()
        
        print("📊 Recent File Upload Status:")
        print("=" * 80)
        
        for file in files:
            status_emoji = {
                'ready': '✅',
                'parsing': '🔄', 
                'uploaded': '⏳',
                'error': '❌'
            }.get(file['status'], '❓')
            
            size_mb = file['file_size_bytes'] / 1024 / 1024 if file['file_size_bytes'] else 0
            
            print(f"{status_emoji} {file['filename']}")
            print(f"   Status: {file['status']}")
            print(f"   Size: {size_mb:.1f}MB")
            print(f"   Uploaded: {file['uploaded_at']}")
            
            if file['status'] == 'ready' and file['sample_count']:
                print(f"   Samples: {file['sample_count']:,}")
            elif file['status'] == 'error' and file['error_message']:
                print(f"   Error: {file['error_message']}")
            
            print()
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Error querying database: {e}")

if __name__ == "__main__":
    check_file_status()
