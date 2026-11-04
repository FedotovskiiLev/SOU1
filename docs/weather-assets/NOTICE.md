# CC0 weather media

SOU1's application code remains **AGPL-3.0-only**. The root LICENSE and existing source notices remain applicable. The media listed here are separately available under **CC0-1.0**:
https://creativecommons.org/publicdomain/zero/1.0/

- **Rain** — Snoopy20111, *Rain_Loop.wav*, https://freesound.org/people/Snoopy20111/sounds/399072/
- **Wind** — Nox_Sound, *Ambiance_Wind_Forest_Trees_Loop_01.wav*, https://freesound.org/people/Nox_Sound/sounds/530908/
- **Thunder** — Joseph SARDIN & Axeline T., *Thunder #4*, https://bigsoundbank.com/thunder-4-s3115.html

Each individual page was checked on 2026-11-04 and identifies its recording as CC0. This attribution is retained for provenance even though CC0 does not require credit.

The downloaded inputs were **public lossy MP3 previews**, not the authors' original WAV recordings. These compact mono PCM16 WAV derivatives do not restore detail lost in MP3 encoding. Exact preview URLs, input and output SHA-256 hashes, chosen excerpts, filters, gains, resampling, quantization and measured levels are in `manifest.json`. The raw long previews are deliberately excluded from packaged assets.

Rain and wind have a baked two-second cyclic overlap. Their complete files may wrap during playback. Thunder is a finite event with a short onset fade and a one-second tail fade; it must be scheduled as occasional events, never wrapped. The wind source is tagged with birds and tree ambience. Filtering reduces high frequencies but does not promise isolated wind or remove all birds. Thunder's author describes it as without rain; this is a source description, not an independent isolation guarantee.

Processing is reproducible with the already installed ffmpeg and Python standard library:

```
python3 tools/prepare-weather-assets.py /path/to/accepted-preview-inputs
```

The input directory must contain `rain-public-preview.mp3`, `wind-public-preview.mp3` and `thunder-public-preview.mp3` with the approved hashes. The script downloads nothing. `tools/prepare-weather-assets.py` is AGPL-3.0-only; that code license does not change the recordings' CC0 status.

Numerical checks cover format, hashes, bounded peaks, finite PCM and cyclic boundary steps. A human still needs to assess audible loop repetition and unwanted background sounds. No speech detector or listening approval is claimed by the preparation tool.
