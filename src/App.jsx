import { useState, useRef, useEffect } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import './App.css'

function App() {
  const [loaded, setLoaded] = useState(false)
  const [files, setFiles] = useState([])
  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState([])
  const [progress, setProgress] = useState(0)
  const [currentTask, setCurrentTask] = useState('')
  const ffmpegRef = useRef(new FFmpeg())

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    const baseURL = import.meta.env.BASE_URL
    const ffmpeg = ffmpegRef.current
    ffmpeg.on('log', ({ message }) => {
      console.log(message)
    })
    ffmpeg.on('progress', ({ progress }) => {
      setProgress(Math.round(progress * 100))
    })
    // toBlobURL is used to bypass CORS issues for the worker and core.
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}ffmpeg-core.wasm`, 'application/wasm'),
    })
    setLoaded(true)
  }

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files))
  }

  const processFiles = async () => {
    if (!loaded) return
    setProcessing(true)
    setResults([])
    const ffmpeg = ffmpegRef.current
    const processedResults = []

    try {
      // Write all files to FFmpeg FS
      for (const file of files) {
        await ffmpeg.writeFile(file.name, await fetchFile(file))
      }

      for (let i = 0; i < files.length; i++) {
        const currentFile = files[i]
        const otherFiles = files.filter((_, index) => index !== i)
        const outputName = `processed_${currentFile.name}`

        setCurrentTask(`Processing ${currentFile.name}...`)
        setProgress(0)

        const inputArgs = ['-i', currentFile.name]
        for (const other of otherFiles) {
          inputArgs.push('-i', other.name)
        }

        let filterComplex = `[0:a]pan=mono|c0=0.5*c0+0.5*c1[left]`
        if (otherFiles.length > 0) {
          const otherIndices = otherFiles.map((_, idx) => `[${idx + 1}:a]`).join('')
          filterComplex += `;${otherIndices}amix=inputs=${otherFiles.length}:dropout_transition=0:normalize=0,pan=mono|c0=c0[right]`
        } else {
          filterComplex += `;anullsrc=r=44100:cl=mono[right]`
        }
        filterComplex += `;[left][right]amerge=inputs=2[out]`

        await ffmpeg.exec([
          ...inputArgs,
          '-filter_complex', filterComplex,
          '-map', '[out]',
          '-q:a', '0',
          outputName
        ])

        const data = await ffmpeg.readFile(outputName)
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'audio/mpeg' }))
        processedResults.push({ name: currentFile.name, url })
        setResults([...processedResults])
      }
    } catch (error) {
      console.error(error)
      alert('Error processing files: ' + error.message)
    } finally {
      setProcessing(false)
      setCurrentTask('')
    }
  }

  return (
    <div className="App">
      <h1>Stereo Practice Tracks</h1>
      <p className="description">
        Upload multiple MP3 files to create practice tracks.
        For each file, a new track will be generated where the <strong>Left Channel</strong>
        contains that individual part and the <strong>Right Channel</strong> contains a mix of all other parts.
      </p>

      {!loaded ? (
        <div className="loading">
          <p>Initializing FFmpeg...</p>
          <div className="spinner"></div>
        </div>
      ) : (
        <div className="container">
          <input type="file" multiple accept="audio/mpeg" onChange={handleFileChange} disabled={processing} />
          <button onClick={processFiles} disabled={files.length === 0 || processing}>
            {processing ? 'Processing...' : 'Generate Practice Tracks'}
          </button>

          {processing && (
            <div className="status">
              <p>{currentTask}</p>
              <progress value={progress} max="100" />
              <span>{progress}%</span>
            </div>
          )}

          <div className="results">
            {results.map((result, idx) => (
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
