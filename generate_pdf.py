from playwright.sync_api import sync_playwright
import os

def export_cv_to_pdf():
    print("Starting browser...")
    with sync_playwright() as p:
        # Launch the invisible browser
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # Find your local index.html file
        file_path = f"file:///{os.path.abspath('index.html').replace(chr(92), '/')}"
        
        print(f"Opening {file_path}...")
        page.goto(file_path)
        
        # Print it to PDF
        print("Generating Ayan_Ashraf_CV.pdf...")
        page.pdf(
            path="Ayan_Ashraf_CV.pdf",
            format="A4",
            print_background=False, # Ensures our white background print CSS works
            margin={"top": "0.5in", "right": "0.5in", "bottom": "0.5in", "left": "0.5in"}
        )
        
        browser.close()
        print("Success! Your CV PDF has been updated.")

if __name__ == "__main__":
    export_cv_to_pdf()