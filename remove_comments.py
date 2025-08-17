import os
import re
from pathlib import Path

def remove_comments_from_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original_length = len(content)
        
        # Remove single-line comments
        content = re.sub(r'//.*?$', '', content, flags=re.MULTILINE)
        
        # Remove multi-line comments
        content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        
        # Remove empty lines left after comment removal
        content = '\n'.join([line for line in content.splitlines() if line.strip()])
        
        if content != original_length:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        return False
        
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return False

def main():
    project_root = Path('/home/anish/sprint-vault')
    extensions = ('.rs', '.ts')
    exclude_dirs = {'node_modules', 'target', '.git'}
    
    modified_files = 0
    
    for ext in extensions:
        for file_path in project_root.rglob(f'*{ext}'):
            # Skip excluded directories
            if any(part in exclude_dirs for part in file_path.parts):
                continue
                
            if remove_comments_from_file(file_path):
                print(f"Processed: {file_path}")
                modified_files += 1
    
    print(f"\nDone! Processed {modified_files} files.")

if __name__ == "__main__":
    main()
