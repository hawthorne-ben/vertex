#!/usr/bin/env python3
"""
Production Debugging Script for Vertex Upload Issues

This script helps diagnose common production issues with the IMU upload pipeline.
Run this to check the status of your upload and identify potential problems.
"""

import os
import requests
import json
from datetime import datetime, timedelta
import sys

def check_environment_variables():
    """Check if required environment variables are set"""
    print("🔍 Checking Environment Variables...")
    
    required_vars = [
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY', 
        'SUPABASE_SERVICE_ROLE_KEY',
        'INNGEST_EVENT_KEY',
        'INNGEST_SIGNING_KEY'
    ]
    
    missing_vars = []
    for var in required_vars:
        if not os.getenv(var):
            missing_vars.append(var)
    
    if missing_vars:
        print(f"❌ Missing environment variables: {', '.join(missing_vars)}")
        return False
    else:
        print("✅ All required environment variables are set")
        return True

def check_supabase_connection():
    """Test Supabase connection"""
    print("\n🔍 Testing Supabase Connection...")
    
    try:
        url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        
        if not url or not key:
            print("❌ Supabase credentials not found")
            return False
            
        # Test connection with a simple query
        headers = {
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json'
        }
        
        # Check if we can access the imu_data_files table
        response = requests.get(
            f"{url}/rest/v1/imu_data_files?select=id,status,created_at&limit=1",
            headers=headers
        )
        
        if response.status_code == 200:
            print("✅ Supabase connection successful")
            return True
        else:
            print(f"❌ Supabase connection failed: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Supabase connection error: {e}")
        return False

def check_recent_uploads():
    """Check recent uploads and their status"""
    print("\n🔍 Checking Recent Uploads...")
    
    try:
        url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        
        headers = {
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json'
        }
        
        # Get recent uploads from last 24 hours
        response = requests.get(
            f"{url}/rest/v1/imu_data_files?select=*&created_at=gte.{datetime.now() - timedelta(days=1)}&order=created_at.desc",
            headers=headers
        )
        
        if response.status_code == 200:
            files = response.json()
            print(f"📊 Found {len(files)} uploads in the last 24 hours")
            
            for file in files[:5]:  # Show last 5
                status_emoji = {
                    'uploaded': '⏳',
                    'parsing': '🔄', 
                    'ready': '✅',
                    'error': '❌'
                }.get(file['status'], '❓')
                
                print(f"  {status_emoji} {file['id'][:8]}... - {file['status']} - {file['created_at']}")
                
                if file['status'] == 'error' and file.get('error_message'):
                    print(f"    Error: {file['error_message']}")
                    
            return files
        else:
            print(f"❌ Failed to fetch uploads: {response.status_code}")
            return []
            
    except Exception as e:
        print(f"❌ Error checking uploads: {e}")
        return []

def check_inngest_webhook():
    """Test Inngest webhook endpoint"""
    print("\n🔍 Testing Inngest Webhook...")
    
    try:
        # This would be your production URL
        webhook_url = "https://your-domain.vercel.app/api/inngest"
        
        # Test with a simple GET request (should return 405 Method Not Allowed)
        response = requests.get(webhook_url)
        
        if response.status_code == 405:
            print("✅ Inngest webhook endpoint is accessible")
            return True
        else:
            print(f"⚠️  Unexpected response from webhook: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Webhook test failed: {e}")
        return False

def suggest_fixes(uploads):
    """Suggest fixes based on the current state"""
    print("\n🔧 Suggested Fixes:")
    
    stuck_uploads = [f for f in uploads if f['status'] == 'uploaded']
    error_uploads = [f for f in uploads if f['status'] == 'error']
    
    if stuck_uploads:
        print("📌 Files stuck in 'uploaded' status:")
        print("   1. Check Inngest Cloud dashboard for failed function runs")
        print("   2. Verify INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY in Vercel")
        print("   3. Check if the parse function is deployed and accessible")
        print("   4. Look for environment variable issues in Inngest function")
        
    if error_uploads:
        print("📌 Files with errors:")
        for file in error_uploads:
            print(f"   - {file['id'][:8]}...: {file.get('error_message', 'Unknown error')}")
            
    print("\n🔧 Manual Recovery Steps:")
    print("   1. Check Inngest Cloud dashboard: https://app.inngest.com")
    print("   2. Check Vercel function logs: https://vercel.com/dashboard")
    print("   3. Check Supabase logs: https://supabase.com/dashboard")
    print("   4. Try re-triggering a stuck upload manually")

def main():
    print("🚀 Vertex Production Debug Tool")
    print("=" * 50)
    
    # Check environment
    env_ok = check_environment_variables()
    
    # Check Supabase
    supabase_ok = check_supabase_connection()
    
    # Check recent uploads
    uploads = check_recent_uploads()
    
    # Check webhook (optional)
    # webhook_ok = check_inngest_webhook()
    
    # Suggest fixes
    suggest_fixes(uploads)
    
    print("\n" + "=" * 50)
    print("🏁 Debug complete. Check the suggestions above.")

if __name__ == '__main__':
    main()
