import { useState, useRef, useEffect } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import './App.css'

function App() {
  const [loaded, setLoaded] = useState(false)
  const [files, setFiles] = useState([])
  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState([])
  const [progress, setProgress] = useState({})
  const [currentTask, setCurrentTask] = useState('')
  const [volumeBalance, setVolumeBalance] = useState(50)
  const ffmpegInstancesRef = useRef([])

  useEffect(() => {
    const init = async () => {
      // Warm up one instance to check if it's ready and to show "loaded" state
      const ffmpeg = new FFmpeg()
      const baseURL = import.meta.env.BASE_URL
      try {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}ffmpeg-core.wasm`, 'application/wasm'),
          workerURL: await toBlobURL(`${baseURL}ffmpeg-core.worker.js`, 'text/javascript'),
        })
        setLoaded(true)
        ffmpeg.terminate()
      } catch (e) {
        console.error("Failed to load FFmpeg", e)
      }
    }
    init()

    return () => {
      // Cleanup: terminate all ffmpeg instances on unmount
      ffmpegInstancesRef.current.forEach(f => f.terminate())
    }
  }, [])

  const createFFmpegInstance = async () => {
    const ffmpeg = new FFmpeg()
    const baseURL = import.meta.env.BASE_URL

    // toBlobURL is used to bypass CORS issues for the worker and core.
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}ffmpeg-core.wasm`, 'application/wasm'),
      workerURL: await toBlobURL(`${baseURL}ffmpeg-core.worker.js`, 'text/javascript'),
    })

    return ffmpeg
  }

  const processFiles = async () => {
    setProcessing(true)
    setResults([])

    // Initialize progress for all files to 0%
    const initialProgress = {}
    files.forEach(file => {
      initialProgress[file.name] = 0
    })
    setProgress(initialProgress)

    setCurrentTask('Initializing parallel workers...')

    const processedResults = []
    const concurrencyLimit = Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 4))
    const queue = [...files]
    const activeTasks = []

    const processFile = async (file, ffmpeg, index) => {
      const progressHandler = ({ progress: p }) => {
        setProgress(prev => ({ ...prev, [file.name]: Math.round(p * 100) }))
      }

      try {
        const otherFiles = files.filter(f => f.name !== file.name)
        const outputName = `processed_${file.name}`

        ffmpeg.on('progress', progressHandler)

        // Write all necessary files to this instance's FS
        await ffmpeg.writeFile(file.name, await fetchFile(file))
        for (const other of otherFiles) {
          await ffmpeg.writeFile(other.name, await fetchFile(other))
        }

        const inputArgs = ['-i', file.name]
        for (const other of otherFiles) {
          inputArgs.push('-i', other.name)
        }

        const leftGain = ((100 - volumeBalance) / 50).toFixed(2)
        const rightGain = (volumeBalance / 50).toFixed(2)

        let filterComplex = `[0:a]pan=mono|c0=0.5*c0+0.5*c1,volume=${leftGain}[left]`
        if (otherFiles.length > 0) {
          const otherIndices = otherFiles.map((_, idx) => `[${idx + 1}:a]`).join('')
          filterComplex += `;${otherIndices}amix=inputs=${otherFiles.length}:dropout_transition=0:normalize=0,pan=mono|c0=c0,volume=${rightGain}[right]`
        } else {
          filterComplex += `;anullsrc=r=44100:cl=mono,volume=${rightGain}[right]`
        }
        filterComplex += `;[left][right]amerge=inputs=2[out]`

        await ffmpeg.exec([
          // '-threads', '0',
          ...inputArgs,
          '-filter_complex', filterComplex,
          '-map', '[out]',
          '-q:a', '0',
          outputName
        ])

        const data = await ffmpeg.readFile(outputName)
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'audio/mpeg' }))
        processedResults.push({ name: file.name, url, index })

        // Cleanup FS
        await ffmpeg.deleteFile(file.name)
        for (const other of otherFiles) {
          await ffmpeg.deleteFile(other.name)
        }
        await ffmpeg.deleteFile(outputName)

      } catch (err) {
        console.error(`Error processing ${file.name}:`, err)
        throw err
      } finally {
        ffmpeg.off('progress', progressHandler)
      }
    }

    const workers = []
    const numWorkers = Math.min(files.length, concurrencyLimit)

    try {
      // Create workers
      for (let i = 0; i < numWorkers; i++) {
        const ffmpeg = await createFFmpegInstance()
        ffmpegInstancesRef.current.push(ffmpeg)
        workers.push(ffmpeg)
      }

      setCurrentTask(`Processing ${files.length} files in parallel...`)

      const runWorker = async (ffmpeg) => {
        while (queue.length > 0) {
          const file = queue.shift()
          const originalIndex = files.indexOf(file)
          await processFile(file, ffmpeg, originalIndex)
        }
      }

      await Promise.all(workers.map(runWorker))

      // Sort results back to original order
      processedResults.sort((a, b) => a.index - b.index)
      setResults(processedResults.map(({ name, url }) => ({ name, url })))

    } catch (error) {
      console.error(error)
      alert('Error processing files: ' + error.message)
    } finally {
      setProcessing(false)
      setCurrentTask('')
      // Terminate and clear workers to free memory
      ffmpegInstancesRef.current.forEach(f => f.terminate())
      ffmpegInstancesRef.current = []
    }
  }

  const downloadAllAsZip = async () => {
    const zip = new JSZip()

    for (const result of results) {
      const response = await fetch(result.url)
      const blob = await response.blob()
      zip.file(`processed_${result.name}`, blob)
    }

    const content = await zip.generateAsync({ type: 'blob' })
    saveAs(content, 'stereo_practice_tracks.zip')
  }

  const handleFileChange = (e) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files))
      setResults([]) // Reset results when new files are selected
    }
  }

  return (
    <div className="App">
      <h1>Stereo Practice Tracks</h1>
      <div className="description">
        Upload multiple MP3 files to create practice tracks.
        For each file, a new track will be generated.
        <div><strong>Left Channel</strong> contains that individual part.</div>
        <div><strong>Right Channel</strong> contains a mix of all other parts.</div>
      </div>

      {!loaded ? (
        <div className="loading">
          <p>Initializing FFmpeg...</p>
          <div className="spinner"></div>
        </div>
      ) : (
        <div className="container">
          <div className="controls">
            <div className="file-input-wrapper">
              <label>Upload MP3 files:</label>
              <input type="file" multiple accept="audio/mpeg" onChange={handleFileChange} disabled={processing} />
            </div>

            <div className="volume-slider-wrapper">
              <div className="slider-labels">
                <span>Part only</span>
                <span>Balanced</span>
                <span>Ensemble only</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={volumeBalance}
                onChange={(e) => setVolumeBalance(Number(e.target.value))}
                disabled={processing}
                className="volume-slider"
              />
            </div>
          </div>

          <button onClick={processFiles} disabled={files.length === 0 || processing}>
            {processing ? 'Processing...' : 'Generate Practice Tracks'}
          </button>

          {processing && (
            <div className="status">
              <p>{currentTask}</p>
              {files.map((file) => (
                <div key={file.name} className="progress-item">
                  <div className="progress-label">{file.name}</div>
                  <progress value={progress[file.name] || 0} max="100" />
                </div>
              ))}
            </div>
          )}

          <div className="results">
            {(!processing && results.length > 0) && (
              <div className="results-header">
                <h3>Processed Files</h3>
                <button onClick={downloadAllAsZip} className="download-all-btn">
                  Download All as ZIP
                </button>
              </div>
            )}
            {(!processing && results.length > 0) && results.map((result, idx) => (
              <div key={idx} className="result-item">
                <span>{result.name}</span>
                <audio controls src={result.url}></audio>
                <a href={result.url} download={result.name}>Download</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
