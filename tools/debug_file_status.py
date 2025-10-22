#!/usr/bin/env python3
"""
Debug script to check and fix file processing status
"""

import os
import requests
import json
from datetime import datetime, timedelta

def get_supabase_client():
    """Get Supabase client configuration"""
    url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    if not url or not key:
        print("❌ Missing Supabase environment variables")
        print("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        return None, None
    
    return url, key

def check_recent_files():
    """Check status of recent file uploads"""
    url, key = get_supabase_client()
    if not url:
        return
    
    headers = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json'
    }
    
    # Get files from last 24 hours
    twenty_four_hours_ago = (datetime.now() - timedelta(hours=24)).isoformat()
    
    params = {
        'select': 'id,filename,file_size_bytes,status,uploaded_at,error_message,sample_count',
        'order': 'uploaded_at.desc',
        'uploaded_at': f'gte.{twenty_four_hours_ago}'
    }
    
    try:
        response = requests.get(f"{url}/rest/v1/imu_data_files", headers=headers, params=params)
        response.raise_for_status()
        
        files = response.json()
        
        print("📊 Recent File Upload Status (Last 24 hours):")
        print("=" * 80)
        
        stuck_files = []
        
        for file in files:
            status_emoji = {
                'ready': '✅',
                'parsing': '🔄', 
                'uploaded': '⏳',
                'failed': '❌'
            }.get(file['status'], '❓')
            
            size_mb = file['file_size_bytes'] / 1024 / 1024 if file['file_size_bytes'] else 0
            uploaded_time = datetime.fromisoformat(file['uploaded_at'].replace('Z', '+00:00'))
            time_since = datetime.now() - uploaded_time.replace(tzinfo=None)
            
            print(f"{status_emoji} {file['filename']}")
            print(f"   ID: {file['id']}")
            print(f"   Status: {file['status']}")
            print(f"   Size: {size_mb:.1f}MB")
            print(f"   Uploaded: {uploaded_time.strftime('%H:%M:%S')} ({time_since.total_seconds()/60:.1f}m ago)")
            
            if file['status'] == 'ready' and file['sample_count']:
                print(f"   Samples: {file['sample_count']:,}")
            elif file['status'] == 'failed' and file['error_message']:
                print(f"   Error: {file['error_message']}")
            elif file['status'] in ['uploaded', 'parsing'] and time_since.total_seconds() > 300:  # 5 minutes
                print(f"   ⚠️  STUCK - Processing for {time_since.total_seconds()/60:.1f} minutes")
                stuck_files.append(file)
            
            print()
        
        if stuck_files:
            print(f"🚨 Found {len(stuck_files)} stuck files!")
            print("Run: python tools/debug_file_status.py --fix-stuck")
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Error querying database: {e}")

def fix_stuck_files():
    """Mark stuck files as error status"""
    url, key = get_supabase_client()
    if not url:
        return
    
    headers = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json'
    }
    
    # Get stuck files (uploaded/parsing for >5 minutes)
    five_minutes_ago = (datetime.now() - timedelta(minutes=5)).isoformat()
    
    params = {
        'select': 'id,filename,status,uploaded_at',
        'or': f'(status.eq.uploaded,status.eq.parsing)',
        'uploaded_at': f'lt.{five_minutes_ago}'
    }
    
    try:
        response = requests.get(f"{url}/rest/v1/imu_data_files", headers=headers, params=params)
        response.raise_for_status()
        
        stuck_files = response.json()
        
        if not stuck_files:
            print("✅ No stuck files found")
            return
        
        print(f"🔧 Fixing {len(stuck_files)} stuck files...")
        
        for file in stuck_files:
            print(f"   Marking {file['filename']} as error...")
            
            update_data = {
                'status': 'failed',
                'error_message': 'Processing timeout - marked as failed by debug script'
            }
            
            update_response = requests.patch(
                f"{url}/rest/v1/imu_data_files?id=eq.{file['id']}",
                headers=headers,
                json=update_data
            )
            
            if update_response.status_code == 200:
                print(f"   ✅ Fixed {file['filename']}")
            else:
                print(f"   ❌ Failed to fix {file['filename']}: {update_response.text}")
        
        print("✅ All stuck files processed")
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Error fixing stuck files: {e}")

def main():
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == '--fix-stuck':
        fix_stuck_files()
    else:
        check_recent_files()

if __name__ == "__main__":
    main()
