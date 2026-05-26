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
    
    # Check if there are any uncommitted changes to release
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
                # Ignore public/version.json, package.json and dist/ modifications since they are handled dynamically
                if not (filepath.endswith('version.json') or filepath.endswith('package.json') or filepath.startswith('dist')):
                    modified_files.append(filepath)
    except Exception as e:
        print(f"Warning: Git status check failed: {e}")

    # Check if last commit was a release and there are no other modifications
    last_commit_msg = ""
    try:
        log_proc = subprocess.run(["git", "log", "-n", "1", "--format=%s"], capture_output=True, text=True, check=True)
        last_commit_msg = log_proc.stdout.strip()
    except Exception as e:
        print(f"Warning: Git log check failed: {e}")

    if last_commit_msg.startswith("chore: release v") and len(modified_files) == 0:
        print("No new functional commits or local code changes detected since last release.")
        print("Skipping version increment and deployment.")
        sys.exit(0)
        
    # 1. Determine the current Year and ISO Week Number
    now = datetime.now()
    current_year = str(now.year)
    current_week = str(now.isocalendar()[1])
    
    prev_year = ""
    prev_week = ""
    prev_counter = 0
    
    # Try reading public/version.json first
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
            
    # Try package.json fallback
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
            
    # 2. Determine new version
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
    
    # 4. Write version.json (in public/)
    try:
        with open(version_file, 'w', encoding='utf-8') as f:
            json.dump(version_metadata, f, indent=2)
        print(f"Successfully updated version.json to v{new_version} ({full_date_time})")
    except Exception as e:
        print(f"Error: Failed to write version.json: {e}")
        return
        
    # 5. Write to package.json
    if os.path.exists(package_file):
        try:
            with open(package_file, 'r', encoding='utf-8') as f:
                package_data = json.load(f)
            package_data['version'] = new_version
            with open(package_file, 'w', encoding='utf-8') as f:
                json.dump(package_data, f, indent=2)
                f.write('\n')
            print(f"Successfully updated package.json to v{new_version}")
        except Exception as e:
            print(f"Warning: Failed to write to package.json: {e}")
            
    # 6. Execute Production Build
    print("\n--- Running production build... ---")
    try:
        subprocess.run(["npm", "run", "build"], cwd=root_dir, check=True)
        print("Build completed successfully!")
    except Exception as e:
        print(f"Error: Production build failed: {e}")
        sys.exit(1)
        
    # 7. Git Add, Commit and Push
    print("\n--- Git: Staging changes... ---")
    try:
        # Stage everything including source files, version files, and the new build in dist/
        subprocess.run(["git", "add", "."], cwd=root_dir, check=True)
        
        commit_message = f"chore: release v{new_version}"
        print(f"Git: Committing release '{commit_message}'...")
        subprocess.run(["git", "commit", "-m", commit_message], cwd=root_dir, check=True)
        
        print("Git: Pushing code and compiled assets to GitHub main branch...")
        subprocess.run(["git", "push"], cwd=root_dir, check=True)
        
        print("Git: Waiting a moment for synchronization...")
        time.sleep(1.5)
        print("Release completed successfully!")
        print(f"Live site at https://emunozgutier.github.io/archery-phone-tools/ will update immediately!")
    except Exception as e:
        print(f"Error: Git automation failed: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
