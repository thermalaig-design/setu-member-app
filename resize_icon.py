from PIL import Image
import os
import sys

# Get the input image file name from command line or use default
if len(sys.argv) > 1:
    input_image = sys.argv[1]
else:
    input_image = 'new_logo.png'  # Default name for the new Maharaja Agrasen logo

# Check if file exists
if not os.path.exists(input_image):
    print(f"❌ Error: Image file '{input_image}' not found!")
    print(f"\nUsage: python resize_icon.py <image_file.png>")
    print(f"Or place your logo image as 'new_logo.png' in the project root")
    sys.exit(1)

print(f"📸 Opening image: {input_image}")

# Open the logo image
img = Image.open(input_image)

# Convert RGBA if needed (Android icons should be PNG with transparency support)
if img.mode != 'RGBA':
    img = img.convert('RGBA')
    print("✓ Converted image to RGBA format")

# Get original dimensions
original_width, original_height = img.size
print(f"📐 Original size: {original_width}x{original_height}")

# Define the icon sizes for different densities
sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192
}

# Create icons for each density
base_path = 'android/app/src/main/res'

# Ensure base directory exists
os.makedirs(base_path, exist_ok=True)

print("\n🔄 Generating Android icons...\n")

for folder, size in sizes.items():
    folder_path = os.path.join(base_path, folder)
    os.makedirs(folder_path, exist_ok=True)
    
    # Resize image to square with the specified size using high-quality resampling
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    
    # Save ic_launcher.png (main icon)
    resized.save(os.path.join(folder_path, 'ic_launcher.png'), 'PNG', optimize=True)
    print(f"✓ Created {folder}/ic_launcher.png ({size}x{size})")
    
    # Save ic_launcher_round.png (rounded icon - same image)
    resized.save(os.path.join(folder_path, 'ic_launcher_round.png'), 'PNG', optimize=True)
    print(f"✓ Created {folder}/ic_launcher_round.png ({size}x{size})")
    
    # Save ic_launcher_foreground.png (foreground icon)
    resized.save(os.path.join(folder_path, 'ic_launcher_foreground.png'), 'PNG', optimize=True)
    print(f"✓ Created {folder}/ic_launcher_foreground.png ({size}x{size})")

# Also update the web logo
web_logo_path = 'src/assets/logo.png'
if os.path.exists(web_logo_path):
    # Create a 512x512 version for web (good size for favicon and PWA)
    web_logo = img.resize((512, 512), Image.Resampling.LANCZOS)
    web_logo.save(web_logo_path, 'PNG', optimize=True)
    print(f"\n✓ Updated web logo: {web_logo_path} (512x512)")

print("\n✅ All Android icons and web logo have been successfully created!")
print("\n📱 Next steps:")
print("   1. Rebuild your Android app to see the new icons")
print("   2. Clear app cache if icons don't update immediately")
