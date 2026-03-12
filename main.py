import sys
import json
import yt_dlp
import time
import os

def download_video(url):
    # Generar un nombre único para evitar conflictos
    timestamp = int(time.time())
    filename = f"video_{timestamp}.mp4"

    ydl_opts = {
        # Intentar formato MP4 directo de hasta 720p (muy compatible con WA)
        'format': 'best[ext=mp4][height<=720]/best[ext=mp4]/best',
        'outtmpl': filename,
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Extraer info primero
            info = ydl.extract_info(url, download=True)

            # Verificar si el archivo realmente se creó
            if os.path.exists(filename):
                result = {
                    "status": "success",
                    "title": info.get('title', 'Video'),
                    "filename": filename
                }
            else:
                # Si yt-dlp cambió el nombre (a veces pasa con extensiones)
                actual_filename = info.get('requested_downloads')[0].get('filepath', filename)
                result = {
                    "status": "success",
                    "title": info.get('title', 'Video'),
                    "filename": actual_filename
                }
            print(json.dumps(result))

    except Exception as e:
        # Aseguramos que el error también sea un JSON válido
        error_res = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_res))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        download_video(sys.argv[1])