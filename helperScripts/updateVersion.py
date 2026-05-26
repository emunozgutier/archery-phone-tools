import os
import json
from datetime import datetime
import subprocess
import time
import sys

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(script_dir)
    
    public_dir = os.path.join(root_dir, 'public')
    version_file = os.path.join(public_dir, 'version.json')
    package_file = os.path.join(root_dir, 'package.json')
    
    # Ensure public dir exists
    os.makedirs(public_dir, exist_ok=True)
    
    # Check if we should skip the version bump because no new changes occurred (npm run deploy twice in a row)
    last_commit_msg = ""
    try:
        log_proc = subprocess.run(["git", "log", "-n", "1", "--format=%s"], capture_output=True, text=True, check=True)
        last_commit_msg = log_proc.stdout.strip()
    except Exception as e:
        print(f"Warning: Git log check failed: {e}")
        
    modified_files = []
    try:
        status_proc = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, check=True)
        for line in status_proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split(None, 1)
            if len(parts) == 2:
                status_code, filepath = parts[0], parts[1]
                filepath = os.path.normpath(filepath)
                # Ignore public/version.json and package.json modifications
                if not (filepath.endswith('version.json') or filepath.endswith('package.json')):
                    modified_files.append(filepath)
    except Exception as e:
        print(f"Warning: Git status check failed: {e}")

    if last_commit_msg.startswith("chore: release v") and len(modified_files) == 0:
        print("No new functional commits or local code changes detected since last release.")
        print("Skipping version increment and Git push (Vite production build will still proceed).")
        sys.exit(0)
        
    # 1. Determine the current Year and ISO Week Number
    now = datetime.now()
    current_year = str(now.year)
    current_week = str(now.isocalendar()[1])
    
    # Default fallback starting version if no previous history is found
    prev_year = ""
    prev_week = ""
    prev_counter = 0
    
    # Try reading public/version.json first (highest priority)
    if os.path.exists(version_file):
        try:
            with open(version_file, 'r', encoding='utf-8') as f:
                version_data = json.load(f)
                version_str = version_data.get('version', '')
                parts = version_str.split('.')
                if len(parts) == 3:
                    prev_year, prev_week, prev_counter = parts[0], parts[1], int(parts[2])
        except Exception as e:
            print(f"Warning: Failed to parse version.json: {e}")
            
    # If not found in version.json, try reading package.json as fallback
    if not prev_year and os.path.exists(package_file):
        try:
            with open(package_file, 'r', encoding='utf-8') as f:
                package_data = json.load(f)
                version_str = package_data.get('version', '')
                parts = version_str.split('.')
                if len(parts) == 3:
                    prev_year, prev_week, prev_counter = parts[0], parts[1], int(parts[2])
        except Exception as e:
            print(f"Warning: Failed to parse package.json: {e}")
            
    # 2. Determine the new version number
    # If it is the same year and week as the previous build, increment the build counter.
    # Otherwise (new week, new year, or no history), reset the counter to 1.
    if current_year == prev_year and current_week == prev_week:
        new_counter = prev_counter + 1
    else:
        new_counter = 1
        
    new_version = f"{current_year}.{current_week}.{new_counter}"
    
    # 3. Create version metadata
    date_time_str = now.strftime('%Y-%m-%d %H:%M:%S')
    tz_name = datetime.now().astimezone().tzname() or "UTC"
    full_date_time = f"{date_time_str} {tz_name}"
    
    version_metadata = {
        "version": new_version,
        "dateTime": full_date_time,
        "timestamp": int(now.timestamp() * 1000)
    }
    
    # 4. Write version.json
    try:
        with open(version_file, 'w', encoding='utf-8') as f:
            json.dump(version_metadata, f, indent=2)
        print(f"Successfully updated version.json to v{new_version} ({full_date_time})")
    except Exception as e:
        print(f"Error: Failed to write version.json: {e}")
        return
        
    # 5. Write back to package.json
    if os.path.exists(package_file):
        try:
            with open(package_file, 'r', encoding='utf-8') as f:
                package_data = json.load(f)
            package_data['version'] = new_version
            with open(package_file, 'w', encoding='utf-8') as f:
                json.dump(package_data, f, indent=2)
                f.write('\n') # trailing newline
            print(f"Successfully updated package.json to v{new_version}")
        except Exception as e:
            print(f"Warning: Failed to write to package.json: {e}")

    # 6. Automate Git Commit & Push
    try:
        print("Git: Staging version files...")
        subprocess.run(["git", "add", version_file, package_file], check=True)
        
        commit_message = f"chore: release v{new_version}"
        print(f"Git: Committing version bump '{commit_message}'...")
        subprocess.run(["git", "commit", "-m", commit_message], check=True)
        
        print("Git: Pushing bump to GitHub...")
        subprocess.run(["git", "push"], check=True)
        
        print("Git: Waiting a second for synchronizations...")
        time.sleep(1.5)
        print("Git: Complete.")
    except Exception as e:
        print(f"Warning: Git auto-commit skipped/failed: {e}")

if __name__ == '__main__':
    main()
