#!/usr/bin/env python3
"""
Simple Production Debug Script for Vertex Upload Issues

This script helps diagnose production issues without requiring environment variables.
"""

import requests
import json
from datetime import datetime, timedelta
import sys

def check_recent_uploads():
    """Check recent uploads via public API (if available)"""
    print("🔍 Checking Recent Uploads...")
    
    # Try to access the data page to see if there are any uploads
    try:
        # This would require authentication, so let's try a different approach
        print("📊 To check recent uploads, please:")
        print("   1. Go to your production site")
        print("   2. Navigate to /data page")
        print("   3. Check if files are stuck in 'uploaded' status")
        print("   4. Look for any error messages")
        
    except Exception as e:
        print(f"❌ Error checking uploads: {e}")

def check_inngest_webhook():
    """Test Inngest webhook endpoint"""
    print("\n🔍 Testing Inngest Webhook...")
    
    try:
        webhook_url = "https://vertex-qtkmuk6r4-ben-hawthornes-projects.vercel.app/api/inngest"
        
        # Test with GET request
        response = requests.get(webhook_url, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            print("✅ Inngest webhook is accessible")
            print(f"   Function count: {data.get('function_count', 'unknown')}")
            print(f"   Has event key: {data.get('has_event_key', 'unknown')}")
            print(f"   Has signing key: {data.get('has_signing_key', 'unknown')}")
            print(f"   Mode: {data.get('mode', 'unknown')}")
            return True
        else:
            print(f"❌ Webhook returned status {response.status_code}")
            print(f"   Response: {response.text[:200]}...")
            return False
            
    except Exception as e:
        print(f"❌ Webhook test failed: {e}")
        return False

def check_upload_endpoint():
    """Test upload endpoint"""
    print("\n🔍 Testing Upload Endpoint...")
    
    try:
        upload_url = "https://vertex-qtkmuk6r4-ben-hawthornes-projects.vercel.app/upload"
        
        response = requests.get(upload_url, timeout=10)
        
        if response.status_code == 200:
            print("✅ Upload page is accessible")
            return True
        elif response.status_code == 401:
            print("⚠️  Upload page requires authentication (expected)")
            return True
        else:
            print(f"❌ Upload page returned status {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Upload endpoint test failed: {e}")
        return False

def suggest_debugging_steps():
    """Suggest debugging steps based on current state"""
    print("\n🔧 Debugging Steps:")
    print("=" * 50)
    
    print("\n1. 📊 Check Inngest Cloud Dashboard:")
    print("   - Go to https://app.inngest.com")
    print("   - Look for 'parse-imu-file' function runs")
    print("   - Check if there are any failed executions")
    print("   - Look for error messages in failed runs")
    
    print("\n2. 📊 Check Vercel Function Logs:")
    print("   - Go to https://vercel.com/dashboard")
    print("   - Select your vertex project")
    print("   - Go to 'Functions' tab")
    print("   - Look for /api/inngest logs")
    print("   - Check for any 500 errors or timeouts")
    
    print("\n3. 📊 Check Supabase Logs:")
    print("   - Go to https://supabase.com/dashboard")
    print("   - Select your project")
    print("   - Go to 'Logs' tab")
    print("   - Check for database errors")
    
    print("\n4. 📊 Manual Database Check:")
    print("   - Go to Supabase SQL Editor")
    print("   - Run this query:")
    print("     SELECT * FROM imu_data_files WHERE status = 'uploaded' ORDER BY created_at DESC LIMIT 5;")
    print("   - Check if files are stuck")
    
    print("\n5. 📊 Test Upload Flow:")
    print("   - Go to your production site")
    print("   - Try uploading a small CSV file")
    print("   - Watch the browser network tab for errors")
    print("   - Check if the file appears in /data page")

def check_common_issues():
    """Check for common production issues"""
    print("\n🔍 Common Issues to Check:")
    print("=" * 50)
    
    print("\n1. 🔑 Environment Variables:")
    print("   - INNGEST_EVENT_KEY: Should be set in Vercel")
    print("   - INNGEST_SIGNING_KEY: Should be set in Vercel")
    print("   - SUPABASE_SERVICE_ROLE_KEY: Should be set in Vercel")
    print("   - NEXT_PUBLIC_SUPABASE_URL: Should be set in Vercel")
    print("   - NEXT_PUBLIC_SUPABASE_ANON_KEY: Should be set in Vercel")
    
    print("\n2. 🔧 Function Deployment:")
    print("   - Check if parse-imu function is deployed to Inngest Cloud")
    print("   - Verify function has proper permissions")
    print("   - Check function timeout settings")
    
    print("\n3. 🗄️ Database Permissions:")
    print("   - Service role key should have RLS bypass")
    print("   - Check if RLS policies are correct")
    print("   - Verify storage bucket permissions")
    
    print("\n4. 🌐 Network Issues:")
    print("   - Check if Inngest can reach your Vercel URL")
    print("   - Verify webhook URL is correct")
    print("   - Check for firewall or proxy issues")

def main():
    print("🚀 Vertex Production Debug Tool (Simple)")
    print("=" * 50)
    
    # Check webhook
    webhook_ok = check_inngest_webhook()
    
    # Check upload endpoint
    upload_ok = check_upload_endpoint()
    
    # Check recent uploads
    check_recent_uploads()
    
    # Suggest debugging steps
    suggest_debugging_steps()
    
    # Check common issues
    check_common_issues()
    
    print("\n" + "=" * 50)
    print("🏁 Debug complete. Follow the steps above to identify the issue.")

if __name__ == '__main__':
    main()
