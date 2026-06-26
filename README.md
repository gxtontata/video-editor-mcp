# video-editor-mcp

An MCP (Model Context Protocol) server that gives Claude (or any MCP-compatible
client) real video-editing tools, powered by `ffmpeg`. Once connected, you can
ask Claude things like *"trim intro.mp4 to the first 10 seconds, add my logo
in the corner, and export it as a GIF"* and it will call these tools directly.

## Requirements

- **Node.js 18+**
- **ffmpeg** and **ffprobe** installed and available on your system `PATH`
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: [ffmpeg.org/download.html](https://ffmpeg.org/download.html), then add it to PATH

## Install

```bash
cd video-editor-mcp
npm install
```

## Configure where your videos live

Every tool takes file paths. Relative paths are resolved against the
`MEDIA_DIR` environment variable (so Claude doesn't need to know your full
filesystem layout) — set it to the folder containing the videos you want to
edit. Absolute paths are always used as-is. If `MEDIA_DIR` isn't set, it
defaults to the directory you launch the server from.

## Connect it to an MCP client

This is a standard MCP server using the **stdio transport**, so any
MCP-compatible client/host can spawn and talk to it. The host just needs to
launch this process and communicate over stdin/stdout:

- **Command:** `node`
- **Args:** `["/absolute/path/to/video-editor-mcp/src/index.js"]`
- **Env:** `MEDIA_DIR=/absolute/path/to/your/videos`

How you wire that up depends on your host/client's own configuration format
(most MCP-aware hosts use a `command` + `args` + `env` shape similar to the
above).

## Tools exposed

| Tool | What it does |
|---|---|
| `get_media_info` | Duration, resolution, codecs, fps, bitrate, file size |
| `trim_video` | Cut a clip by start time + end time/duration |
| `merge_videos` | Concatenate multiple clips into one (auto-normalizes resolution) |
| `convert_format` | Change container/codec (mp4, mov, webm, mp3, etc.) |
| `extract_audio` | Pull the audio track out as an MP3 |
| `resize_video` | Scale to a target width/height |
| `crop_video` | Crop to a rectangular region |
| `rotate_video` | Rotate 90/180/270° and/or flip horizontally/vertically |
| `change_speed` | Speed up or slow down (pitch-corrected audio) |
| `adjust_volume` | Raise/lower volume, or mute |
| `extract_frame` | Grab a still frame at a timestamp |
| `add_text_overlay` | Burn in a caption/title, optionally timed |
| `add_watermark` | Overlay a logo image at a chosen corner |
| `add_fade` | Fade in/out (video, audio, or both) |
| `compress_video` | Re-encode at a target quality (CRF) to shrink file size |
| `generate_gif` | Convert a video segment into an animated GIF |

Each tool returns the resulting file's path and size, so Claude can chain
operations (e.g. trim → add watermark → compress) by feeding one tool's
output into the next tool's input.

## Testing without Claude

Run the unit tests, which generate a synthetic test video with ffmpeg and
exercise every operation:

```bash
npm test
```

Run a full protocol-level test (spins up the server and a real MCP client,
lists tools, and calls a couple of them):

```bash
node test/e2e-client.js
```

(The e2e test expects `npm test` to have been run first so `test/tmp/v1.mp4`
exists — or generate your own test clip there.)

## Notes & limitations

- All operations re-encode by default for correctness (frame-accurate trims,
  mixed-codec merges, etc.) rather than using fast `-c copy` cuts, so they're
  not the fastest possible, but they're reliable across arbitrary inputs.
- This server runs entirely on your local machine and only touches files you
  point it at — no video data is uploaded anywhere.
- There's no built-in sandboxing beyond the `MEDIA_DIR` convenience for
  relative paths; since the server has the same filesystem permissions as
  whatever process launches it, only connect it to clients you trust.
