# Stereo Practice Tracks

> **Note**: This project was developed with the assistance of AI.

This application allows you to generate practice tracks from multiple MP3 files directly in your browser. 

## Project Goal
For each uploaded MP3 file, the application generates a stereo track where:
- The **Left Channel** contains the individual part (mono).
- The **Right Channel** contains a high-quality mix of all other parts (mono).

This setup is ideal for choir or ensemble members who want to hear their own part clearly while still being able to practice with the rest of the ensemble.

## Features
- **In-Browser Processing**: Uses FFmpeg directly in your browser. No files are uploaded to any server.
- **High Quality**: Uses high-quality encoding for the processed audio.
- **Privacy**: All processing happens locally on your machine.

## Usage
1. Open the application.
2. Wait for FFmpeg to initialize (happens automatically).
3. Upload your MP3 tracks.
4. Click **Generate Practice Tracks**.
5. Listen to the results or download them (individually or as a ZIP).

## Development

### Prerequisites
- **Node.js** (v18 or later recommended)
- **npm**

### Local Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Deployment
The project is automatically built and deployed to GitHub Pages via GitHub Actions whenever changes are pushed to the `main` branch.

## Technical Details
The application uses FFmpeg's `filter_complex` to:
1. **Left Channel**: Downmix the current stereo file to mono using `pan=mono|c0=0.5*c0+0.5*c1`.
2. **Right Channel**: Mix all other files using `amix`, then downmix the result to mono.
3. **Merge**: Combine the two mono streams into a single stereo output using `amerge`.
